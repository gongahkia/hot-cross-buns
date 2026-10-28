import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserBridge } from "./bridge";
import { readPanePreference } from "../renderer/src/features/shell/panePreferences";

class WorkerDouble extends EventTarget {
  static instance: WorkerDouble;
  postMessage = vi.fn();
  constructor() {
    super();
    WorkerDouble.instance = this;
  }
  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class BroadcastDouble extends EventTarget {
  static instance: BroadcastDouble;
  constructor(name: string) { super(); if (name === "hot-cross-buns-workspace-changes") BroadcastDouble.instance = this; }
}

beforeEach(() => { delete window.hcb; vi.stubGlobal("Worker", WorkerDouble); vi.stubGlobal("BroadcastChannel", BroadcastDouble); });
afterEach(() => { vi.unstubAllGlobals(); delete window.hcb; });

describe("browser workspace bridge", () => {
  it("hydrates durable view preferences before startup completes", async () => {
    const startup = installBrowserBridge();
    WorkerDouble.instance.reply({ type: "ready", writerId: "own-worker" });
    await Promise.resolve();
    expect(WorkerDouble.instance.postMessage).toHaveBeenCalledWith({ id: 1, namespace: "workspace", action: "getPreferences", payload: {} });
    WorkerDouble.instance.reply({ id: 1, result: { ok: true, data: { default: { "tasks.presentation": "board" } } } });
    await startup;
    expect(readPanePreference("default", "tasks.presentation", "list")).toBe("board");
  });

  it("notifies subscribers of other writers while ignoring its own worker", () => {
    void installBrowserBridge(false);
    WorkerDouble.instance.reply({ type: "ready", writerId: "own-worker" });
    const listener = vi.fn();
    const unsubscribe = window.hcb!.workspace.subscribeChanges(listener);
    BroadcastDouble.instance.dispatchEvent(new MessageEvent("message", { data: { writerId: "own-worker", revision: 2 } }));
    expect(listener).not.toHaveBeenCalled();
    BroadcastDouble.instance.dispatchEvent(new MessageEvent("message", { data: { writerId: "other-worker", revision: 3 } }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    BroadcastDouble.instance.dispatchEvent(new MessageEvent("message", { data: { writerId: "other-worker", revision: 4 } }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("installs immediately and waits for database initialization before dispatching", async () => {
    void installBrowserBridge(false);
    const response = window.hcb!.bootstrap.get({ mode: "light" });
    await Promise.resolve();
    expect(WorkerDouble.instance.postMessage).not.toHaveBeenCalled();
    WorkerDouble.instance.reply({ type: "ready" });
    await Promise.resolve();
    expect(WorkerDouble.instance.postMessage).toHaveBeenCalledWith({
      id: 1, namespace: "bootstrap", action: "get", payload: { mode: "light" }
    });
    const snapshot = { tasks: [{ id: "real-task" }], settings: { theme: "dark" } };
    WorkerDouble.instance.reply({ id: 1, result: { ok: true, data: snapshot } });
    expect(await response).toEqual({ ok: true, data: snapshot });
  });

  it("preserves persistence failure envelopes instead of reporting a saved mutation", async () => {
    void installBrowserBridge(false);
    WorkerDouble.instance.reply({ type: "ready" });
    const response = window.hcb!.tasks.create({ title: "Task" });
    await Promise.resolve();
    const result = { ok: false, error: { code: "INTERNAL_ERROR", message: "IndexedDB transaction aborted", recoverable: true } };
    WorkerDouble.instance.reply({ id: 1, result });
    expect(await response).toEqual(result);
  });

  it("surfaces initialization failure to queued and later requests", async () => {
    void installBrowserBridge(false);
    const first = window.hcb!.bootstrap.get({});
    WorkerDouble.instance.reply({ type: "initialization-error", message: "Database migration failed; saved data retained." });
    expect(await first).toMatchObject({ ok: false, error: { message: "Database migration failed; saved data retained." } });
    expect(await window.hcb!.settings.get()).toMatchObject({ ok: false });
    expect(WorkerDouble.instance.postMessage).not.toHaveBeenCalled();
  });

  it("settles pending requests when the worker crashes", async () => {
    void installBrowserBridge(false);
    WorkerDouble.instance.reply({ type: "ready" });
    const response = window.hcb!.tasks.create({ title: "Task" });
    await Promise.resolve();
    WorkerDouble.instance.dispatchEvent(new ErrorEvent("error", { message: "Worker crashed" }));
    expect(await response).toMatchObject({ ok: false, error: { message: "Worker crashed" } });
  });
});
