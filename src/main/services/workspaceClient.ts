import { Worker } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { safeStorage, shell } from "electron";
import type { CoreNativeBridge, CoreStore } from "./coreStore";
import { CoreStoreError } from "./coreStoreError";
import type { GoogleOAuthController } from "./googleOAuth";
import type { GoogleSyncService } from "./googleSync";
import type { LocalBackupService } from "./localBackups";
import type { HostCall, NativeWorkspaceSnapshot, RuntimeReply, RuntimeTarget } from "./workspaceProtocol";

type RemoteMethods<T> = { [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };

export class WorkspaceClient {
  readonly ready: Promise<void>;
  readonly core: Pick<RemoteMethods<CoreStore>, "dispatch" | "restoreLocalNotes">;
  readonly googleOAuth: Omit<RemoteMethods<GoogleOAuthController>, "isReconfiguring"> & { isReconfiguring: () => boolean };
  readonly googleSync: Omit<RemoteMethods<GoogleSyncService>, "onStatus"> & { onStatus: (listener: (status: any) => void) => () => void };
  readonly backups: Pick<RemoteMethods<LocalBackupService>, "create" | "start" | "stop"> & { directory: string };
  snapshot!: NativeWorkspaceSnapshot;
  private native: CoreNativeBridge | null = null;
  private reconfiguring = false;
  private readonly worker: Worker;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private nextId = 0;
  private failed: Error | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private settingsSignature = "";

  constructor(userDataDirectory: string) {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Handle an early startup failure even before an IPC request awaits readiness.
    void this.ready.catch(() => undefined);
    this.worker = new Worker(join(__dirname, "workspaceWorker.js"), { workerData: { userDataDirectory } });
    const remote = (target: RuntimeTarget, local: Record<string, unknown> = {}) => new Proxy(local, {
      get: (object, key: string) => key in object ? object[key] : (...args: unknown[]) => this.call(target, key, args)
    });
    this.core = remote("core") as typeof this.core;
    this.googleOAuth = remote("googleOAuth", { isReconfiguring: () => this.reconfiguring }) as typeof this.googleOAuth;
    this.googleSync = remote("googleSync", { onStatus: (listener: (status: any) => void) => {
      this.events.on("syncStatus", listener);
      return () => this.events.off("syncStatus", listener);
    } }) as typeof this.googleSync;
    this.backups = remote("backups", { directory: join(userDataDirectory, "backups") }) as typeof this.backups;
    const fail = (error: Error) => {
      this.failed = error;
      rejectReady(error);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.events.emit("syncStatus", { state: "error", pendingMutationCount: 0, summary: error.message, lastErrorCode: "WORKER_STOPPED" });
    };
    this.worker.on("error", fail);
    this.worker.on("exit", () => { fail(new Error(this.closing ? "Hot Cross Buns is closing." : "The workspace worker stopped. Restart Hot Cross Buns to reopen your local data.")); });
    this.worker.on("message", (message: any) => {
      if (message.kind === "ready" || message.kind === "snapshot") {
        this.snapshot = message.snapshot;
        if (message.kind === "ready") resolveReady();
        this.applyNativeSettings(this.snapshot.settings);
        this.native?.refreshData?.();
        this.publishNativeCapabilities();
      } else if (message.kind === "reply") {
        const reply = message as RuntimeReply;
        const request = this.pending.get(reply.id);
        this.pending.delete(reply.id);
        if (reply.error) request?.reject(reply.error.name === "CoreStoreError" ? new CoreStoreError(reply.error.message) : new Error(reply.error.message));
        else request?.resolve(reply.result);
      } else if (message.kind === "syncStatus") this.events.emit("syncStatus", message.status);
      else if (message.kind === "settings") {
        if (this.snapshot) this.snapshot = { ...this.snapshot, settings: message.settings };
        this.applyNativeSettings(message.settings);
        this.publishNativeCapabilities();
      } else if (message.kind === "oauthState") this.reconfiguring = message.reconfiguring;
      else if (message.kind === "host") void this.handleHost(message);
      else if (message.kind === "fatal") fail(new Error(message.error));
      else if (message.kind === "closed") this.events.emit("closed");
    });
  }

  attachNativeBridge(native: CoreNativeBridge): void {
    this.native = native;
    this.settingsSignature = "";
    if (this.snapshot) this.applyNativeSettings(this.snapshot.settings);
    this.publishNativeCapabilities();
  }

  private applyNativeSettings(settings: Record<string, any>): void {
    if (!this.native) return;
    const signature = JSON.stringify(settings);
    if (signature === this.settingsSignature) return;
    this.settingsSignature = signature;
    this.native.applySettings?.(settings);
  }

  private publishNativeCapabilities(): void {
    if (this.native && !this.failed && !this.closing) this.worker.postMessage({ kind: "nativeCapabilities", value: this.native.capabilities() });
  }

  private async call(target: RuntimeTarget, method: string, args: unknown[]): Promise<any> {
    if (this.closing) throw new CoreStoreError("Hot Cross Buns is closing.");
    await this.ready;
    if (this.closing) throw new CoreStoreError("Hot Cross Buns is closing.");
    if (this.failed) throw this.failed;
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ kind: "call", id, target, method, args }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  private async handleHost(message: HostCall): Promise<void> {
    try {
      let result: unknown;
      if (message.method === "credentials.available") result = safeStorage.isEncryptionAvailable();
      else if (message.method === "credentials.encrypt") result = safeStorage.encryptString(String(message.args[0]));
      else if (message.method === "credentials.decrypt") result = safeStorage.decryptString(Buffer.from(message.args[0] as Uint8Array));
      else if (message.method === "oauth.openExternal") {
        const url = new URL(String(message.args[0]));
        if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") throw new Error("Unsupported OAuth authorization URL.");
        await shell.openExternal(url.toString());
      } else {
        const handlers: Record<string, (() => unknown) | undefined> = {
          "native.listFontFamilies": this.native?.listFontFamilies,
          "native.requestNotificationPermission": this.native?.requestNotificationPermission,
          "native.checkForUpdates": this.native?.checkForUpdates,
          "native.rescheduleNotifications": this.native?.rescheduleNotifications,
          "native.openExternalUrl": () => this.native?.openExternalUrl(message.args[0] as { url: string })
        };
        if (!handlers[message.method]) throw new Error("The native service is still starting.");
        result = await handlers[message.method]!();
        this.publishNativeCapabilities();
      }
      this.worker.postMessage({ kind: "hostReply", id: message.id, result });
    } catch (error) {
      this.worker.postMessage({ kind: "hostReply", id: message.id, error: error instanceof Error ? error.message : "Native operation failed." });
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      if (!this.failed) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); this.events.off("closed", done); resolve(); };
        const timer = setTimeout(done, 2000);
        this.events.once("closed", done);
        // A close sent during startup is queued until the worker installs its handler.
        try { this.worker.postMessage({ kind: "close" }); } catch { done(); }
      });
      await this.worker.terminate();
    })();
    return this.closePromise;
  }
}
