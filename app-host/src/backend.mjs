import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { validateFrame } from "./policy.mjs";

// Each instance owns one chat runtime. No HTTP listener, browser credential storage,
// alternate agent loop, or renderer-side subprocess execution is involved.
export class Backend extends EventEmitter {
  state;
  failure = "";
  closed = false;
  #child;
  #buffer = "";
  #diagnostics = "";
  #updateNonce;

  constructor(binary, cwd, env = process.env, args = ["ui-backend", "", ""]) {
    super();
    this.#child = spawn(binary, args, { cwd, env: { ...env, HOT_CROSS_BUNS_UI_BACKEND: "1" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.#child.stderr.on("data", (chunk) => { this.#diagnostics = (this.#diagnostics + chunk.toString()).slice(-4000); });
    this.#child.stdin.on("error", () => {});
    this.#child.on("error", (error) => { this.failure = error.message; });
    this.#child.on("close", (code) => {
      this.closed = true;
      this.failure ||= this.#diagnostics.trim() || (code === 0 ? "Hot Cross Buns session closed." : `Hot Cross Buns exited (${code ?? "signal"}).`);
      this.emit("closed", this.failure);
    });
  }

  #consume(chunk) {
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer) > 16 * 1024 * 1024) { this.failure = "Hot Cross Buns sent an oversized state frame."; this.stop(); return; }
    let newline;
    while ((newline = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      try {
        const frame = JSON.parse(line);
        if (frame.version === 1 && frame.type === "action_applied") { this.emit("action-applied", frame.nonce); continue; }
        if (frame.version === 1 && frame.type === "update_ready") {
          if (frame.nonce === this.#updateNonce) this.emit("update-ready", frame);
          continue;
        }
        if (frame.version !== 1 || frame.type !== "state" || !frame.state || typeof frame.state !== "object") throw new Error("Invalid state frame");
        this.state = frame.state;
        this.emit("state", this.state);
      } catch {
        this.failure = "Hot Cross Buns's UI connection failed. Restart the session to reconnect.";
        this.stop();
        return;
      }
    }
  }

  send(frame) {
    const checked = validateFrame(frame);
    if (this.closed || !this.#child.stdin.writable) throw new Error(this.failure || "Hot Cross Buns is disconnected");
    this.#write(checked);
  }

  finishExternal(error = "") {
    this.#write({ version: 1, type: "external_done", error });
  }

  refreshPreferences() { return this.#apply({ version: 1, type: "refresh_preferences" }); }

  configureDialogue(dialogue_host) { this.#write({ version: 1, type: "dialogue_host", dialogue_host }); }
  async bootstrapDialogue(parent, turn) {
    await this.#apply({ version: 1, type: "dialogue_bootstrap", dialogue_parent: parent, dialogue_turn: turn });
    const result = this.state?.dialogue_bootstrap_result;
    if (result?.turn_id !== turn || result?.child_id !== this.state?.conversation_id) throw new Error("The task owner did not confirm the original admission. Inspect its retained state.");
    if (result.error) throw new Error(result.error);
  }
  async controlDialogue(dialogue_control) {
    await this.#apply({ version: 1, type: "dialogue_control", dialogue_control });
    const result = this.state?.dialogue_control_result;
    if (result?.request_id !== dialogue_control.request_id) throw new Error("The task control was not confirmed. Inspect the original task before trying again.");
    if (result.error) throw new Error(result.error);
    return result;
  }
  finishDialogue(dialogue_result) { return this.#apply({ version: 1, type: "dialogue_result", dialogue_result }); }

  apply(frame) {
    return this.#apply(validateFrame(frame));
  }

  // Host-owned handoffs deliberately stay outside the renderer frame policy.
  prepareComposerEditor(text) {
    validateFrame({ type: "submit", text });
    return this.#apply({ version: 1, type: "key", key: "ctrl+g", text });
  }

  completeExternal(error = "") {
    if (!this.state?.external) return Promise.reject(new Error("The external step is no longer current."));
    return this.#apply({ version: 1, type: "external_done", error });
  }

  #apply(frame) {
    const nonce = randomUUID();
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error(this.failure || "Hot Cross Buns is disconnected.")); return; }
      const finish = error => { clearTimeout(timer); this.off("action-applied", applied); this.off("closed", closed); error ? reject(new Error(error)) : resolve(); };
      const applied = id => { if (id === nonce) finish(); };
      const closed = () => finish("Hot Cross Buns disconnected before confirming this action.");
      const timer = setTimeout(() => finish("This action was not confirmed. Check the current view before trying again."), 15000);
      this.on("action-applied", applied); this.once("closed", closed);
      this.#write({ ...frame, nonce });
    });
  }

  ready() { return this.#waitForState(() => true, () => {}, 15000); }

  async personalMemory(action) {
    await this.#waitForState(state => state.personal_memory_result?.request_id === action.request_id,
      () => this.#write({ version: 1, type: "personal_memory", personal_memory: action }), 15000);
    return this.state.personal_memory_result;
  }

  async reviewQueue(action) {
    await this.#waitForState(state => state.review_queue_result?.request_id === action.request_id,
      () => this.#write({ version: 1, type: "review_queue", review_queue: action }), 30000);
    return this.state.review_queue_result;
  }

  async catalog(action) {
    const field = action.action === 'query' ? 'native_catalog_query_result' : 'native_catalog_action_result';
    await this.#waitForState(state => state[field]?.request_id === action.request_id,
      () => this.#write({ version: 1, type: 'native_catalog', native_catalog: action }), 15000);
    return this.state[field];
  }

  async workspace(action) {
    await this.#waitForState(state => state.native_workspace_result?.request_id === action.request_id,
      () => this.#write({ version: 1, type: 'native_workspace', native_workspace: action }), 15000);
    return this.state.native_workspace_result;
  }

  async inspectContext(action) {
    await this.#waitForState(state => state.context_inspect_result?.request_id === action.request_id,
      () => this.#write({ version: 1, type: 'context_inspect', context_inspect: action }), 15000);
    return this.state.context_inspect_result;
  }

  async check(action) {
    await this.#waitForState(state => state.check_result?.request_id === action.request_id,
      () => this.send({ type: "check", check: action }), 15000);
    return this.state.check_result;
  }

  async recovery(frame) {
    const name = frame.type === 'receipt' ? 'receipt' : 'request_recovery';
    if (frame.type !== name) throw new Error('Unsupported recovery action.');
    await this.#waitForState(state => state[name + '_result']?.request_id === frame[name]?.request_id,
      () => this.send(frame), 30000);
    return this.state[name + '_result'];
  }

  async nativeProvider(action) {
    await this.#waitForState(state => state.native_provider_result?.request_id === action.request_id,
      () => this.#write({ version: 1, type: "native_provider", native_provider: action }), 15000);
    return this.state.native_provider_result;
  }

  focus(foreground) {
    const accepted = state => state.foreground === foreground && !state.session_request;
    if (this.state && accepted(this.state)) return Promise.resolve();
    return this.#waitForState(accepted, () => this.#write({ version: 1, type: "focus_session", foreground }), 5000);
  }

  #waitForState(accepted, send, timeout) {
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error(this.failure || "Hot Cross Buns is disconnected.")); return; }
      const finish = error => { clearTimeout(timer); this.off("state", changed); this.off("closed", closed); error ? reject(new Error(error)) : resolve(); };
      const changed = state => { if (accepted(state)) finish(); };
      const closed = () => finish(this.failure || "Hot Cross Buns disconnected while opening this chat.");
      const timer = setTimeout(() => finish("Hot Cross Buns did not confirm this chat. Try opening it again."), timeout);
      this.on("state", changed); this.once("closed", closed);
      try { send(); if (this.state) changed(this.state); } catch (error) { finish(error.message); }
    });
  }

  submitUpload(frame) {
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer); this.off("state", changed); this.off("closed", closed);
        error ? reject(new Error(error)) : resolve();
      };
      const changed = (state) => { if (state.upload_result?.request_id === frame.upload.request_id) finish(state.upload_result.error); };
      const closed = () => finish("Hot Cross Buns disconnected before confirming the message. Your draft is kept.");
      const timer = setTimeout(() => finish("Hot Cross Buns has not confirmed this message. Check the conversation before sending again."), 20000);
      this.on("state", changed); this.once("closed", closed);
      try { this.send(frame); } catch (error) { finish(error.message); }
    });
  }

  prepareUpdate() {
    if (this.closed || this.#updateNonce) return Promise.reject(new Error("Hot Cross Buns cannot prepare to restart right now."));
    return new Promise((resolve, reject) => {
      const nonce = randomUUID();
      this.#updateNonce = nonce;
      let accepted = false;
      const finish = (error) => {
        clearTimeout(timer); this.off("update-ready", ready); this.off("closed", closed); this.#updateNonce = undefined;
        error ? reject(error) : resolve();
      };
      const ready = (frame) => { if (frame.ready === true) accepted = true; else finish(new Error(frame.reason || "Finish the current work first.")); };
      const closed = () => finish(accepted ? undefined : new Error("Hot Cross Buns disconnected before update preparation completed."));
      const timer = setTimeout(() => finish(new Error("Hot Cross Buns did not confirm an idle session. No work was forcibly stopped.")), 8000);
      this.on("update-ready", ready); this.once("closed", closed);
      this.#write({ version: 1, type: "prepare_update", nonce });
    });
  }

  #write(frame) {
    if (!this.closed && this.#child.stdin.writable) this.#child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  stop() {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => this.#child.kill("SIGTERM"), 2500);
      const force = setTimeout(() => this.#child.kill("SIGKILL"), 5000);
      this.#child.once("close", () => { clearTimeout(timeout); clearTimeout(force); resolve(); });
      this.#write({ version: 1, type: "exit" });
      this.#child.stdin.end();
    });
  }
}
