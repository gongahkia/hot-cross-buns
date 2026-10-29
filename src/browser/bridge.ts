import type { GoogleStatusResponse } from "../shared/ipc/contracts";
import { createHcbApi } from "../preload/bridge";
import { IPC_CHANNELS } from "../shared/ipc";
import { ipcError, ok, validationError, type HcbResult } from "../shared/result";
import { hydratePanePreferences } from "../renderer/src/features/shell/panePreferences";

import { createBrowserNotifications } from "./notifications";
import { createBrowserGoogleAuth } from "./googleAuth";
import { createBrowserGoogleClientConfiguration, googleClientIdStorageKey } from "./googleClientConfiguration";
import { browserStorageInfo, downloadFile, pickFile } from "./files";
import { observeSyncLifecycle } from "./syncLifecycle";

type Request = { namespace: string; action: string; payload: Record<string, unknown> };

/** Installs the real service before React mounts; requests wait for database recovery. */
export function installBrowserBridge(hydratePreferences = true): Promise<void> {
  const pending = new Map<number, (result: HcbResult<unknown>) => void>();
  const subscribers = new Map<string, Set<(payload: unknown) => void>>();
  let nextId = 0;
  let writerId: string | undefined;
  const workspaceListeners = new Set<() => void>();
  const changes = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("hot-cross-buns-workspace-changes")
    : undefined;
  changes?.addEventListener("message", ({ data }) => {
    if (writerId && typeof data?.writerId === "string" && data.writerId !== writerId && Number.isSafeInteger(data.revision)) {
      for (const listener of workspaceListeners) listener();
    }
  });
  let failure: HcbResult<never> | undefined;
  let workerUnavailable = false;
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  let worker: Worker;
  let stopSyncLifecycle: (() => void) | undefined;

  function fail(message: string, stopped = false): void {
    failure = ipcError(message);
    workerUnavailable ||= stopped;
    stopSyncLifecycle?.();
    stopSyncLifecycle = undefined;
    readyResolve();
    for (const resolve of pending.values()) resolve(failure);
    pending.clear();
  }

  try {
    worker = new Worker(new URL("./workspace.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "ready") {
        writerId = data.writerId;
        readyResolve();
      } else if (data.type === "initialization-error") {
        fail(data.message || "The workspace could not open. Reload to retry; your saved data has not been reset.");
      } else if (data.type === "event") {
        for (const listener of subscribers.get(data.channel) ?? []) listener(data.payload);
      } else if (typeof data.id === "number") {
        pending.get(data.id)?.(data.result);
        pending.delete(data.id);
      }
    });
    worker.addEventListener("error", (event) => {
      fail(event.message || "The workspace service stopped. Reload to reopen your saved workspace.", true);
    });
    worker.addEventListener("messageerror", () => {
      fail("The workspace service returned an unreadable message. Reload to retry.", true);
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "This browser could not start the workspace service.", true);
  }

  async function request(namespace: string, action: string, payload: Record<string, unknown> = {}): Promise<HcbResult<unknown>> {
    await ready;
    if (failure && (workerUnavailable || !(namespace === "workspace" && ["exportArchive", "stageImport", "confirmImport"].includes(action)))) return failure;
    return new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      try {
        worker.postMessage({ id, namespace, action, payload });
      } catch (error) {
        pending.delete(id);
        resolve(ipcError(error instanceof Error ? error.message : "The workspace request could not be sent."));
      }
    });
  }

  const notifications = createBrowserNotifications(request, action => {
    for (const listener of subscribers.get("hcb:native-action") ?? []) listener(action);
  });
  function browserCapabilities(value: any) {
    return { ...value, notifications: typeof Notification === "function", notificationsStatus: notifications.status(),
      capabilityReport: { ...value.capabilityReport, flags: { ...value.capabilityReport?.flags, supportsNotifications: typeof Notification === "function" } } };
  }
  const googleClientConfiguration = createBrowserGoogleClientConfiguration(import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const makeGoogleAuth = (clientId?: string): ReturnType<typeof createBrowserGoogleAuth> => createBrowserGoogleAuth({
    clientId,
    clientConfiguration: clientId === undefined ? googleClientConfiguration : undefined,
    onToken: async (session, expectedAccountId): Promise<HcbResult<GoogleStatusResponse>> => {
      const result = await request("__google", "attachSession", { session, expectedAccountId }) as HcbResult<GoogleStatusResponse>;
      if (result.ok) void request("sync", "runNow", { reason: "user-connection" });
      return result.ok ? ok({ ...result.data, ...googleAuth.status() }) : result;
    },
    onDisconnect: (accountId, reason) => request("__google", "removeSession", { accountId, reason }) as Promise<HcbResult<GoogleStatusResponse>>,
  });
  let googleAuth = makeGoogleAuth();
  void googleAuth.preload().catch(() => { /* Profile exposes the actionable load error. */ });
  window.addEventListener("storage", (event) => {
    if (event.key !== googleClientIdStorageKey && event.key !== null) return;
    void googleAuth.preload().catch(() => undefined);
    window.dispatchEvent(new Event("hcb:core-data-invalidated"));
  });

  const api = createHcbApi({
    invoke: async (channel, payload) => {
      if (channel === IPC_CHANNELS.core.invoke) {
        const input = payload as Request;
        if (input.namespace === "native" && input.action === "requestNotificationPermission") {
          try { return ok(await notifications.requestPermission()); }
          catch { return ipcError("Notification permission could not be requested. Check this site's browser settings."); }
        }
        if (input.namespace === "diagnostics" && input.action === "rescheduleNotifications") return ok(await notifications.refresh());
        if (input.namespace === "google") {
          if (input.action === "beginOAuth") { const result = await googleAuth.beginOAuth(input.payload); return result.ok ? ok({ ...result.data, ...googleAuth.status() }) : result; }
          if (input.action === "reconfigureOptionalAccess") { const result = await googleAuth.reconfigureOptionalAccess(input.payload as any); return result.ok ? ok({ ...result.data, ...googleAuth.status() }) : result; }
          if (input.action === "disconnect") { const result = await googleAuth.disconnect(input.payload as { accountId: string }); return result.ok ? ok({ ...result.data, ...googleAuth.status() }) : result; }
          if (input.action === "cancelOAuth") {
            const cancelled = await googleAuth.cancelOAuth();
            if (!cancelled.ok) return cancelled;
            const status = await request("google", "status");
            return status.ok ? ok({ ...status.data as object, ...googleAuth.status() }) : status;
          }
          if (input.action === "saveOAuthClient") {
            const saved = googleAuth.saveOAuthClient(input.payload);
            if (!saved.ok) return saved;
            const status = await request("google", "status");
            return status.ok ? ok({ ...status.data as object, ...googleAuth.status() }) : status;
          }
          if (input.action === "pickAndUploadDriveFile") {
            const file = await pickFile("");
            if (!file) return ok({ cancelled: true });
            const result = await request("google", "uploadDriveFile", { ...input.payload, name: file.name, file });
            return result.ok ? ok({ cancelled: false, item: result.data }) : result;
          }
        }
        if (input.namespace === "diagnostics" && input.action === "exportBundle") {
          const summary = await request("diagnostics", "summary");
          if (!summary.ok) return summary;
          const logs = await request("diagnostics", "logs");
          if (!logs.ok) return logs;
          downloadFile(JSON.stringify({ generatedAt: new Date().toISOString(), summary: summary.data, logs: logs.data }, null, 2), "hot-cross-buns-diagnostics.json", "application/json");
          return ok({ exported: true, message: "Diagnostic download started." });
        }
        // User-gesture APIs stay on the window; all SQL stays in the worker.
        if (input.namespace === "native" && input.action === "writeClipboardText") {
          if (typeof input.payload.text !== "string") return validationError("Clipboard text is required.");
          try {
            await navigator.clipboard.writeText(input.payload.text);
            return ok({ copied: true });
          } catch {
            return ipcError("Clipboard access was denied. Allow clipboard access for this site and retry.");
          }
        }
        if (input.namespace === "native" && input.action === "openExternalUrl") {
          try {
            const url = new URL(String(input.payload.url));
            if (!["https:", "http:", "mailto:"].includes(url.protocol)) return validationError("Only web and email links can be opened.");
            // Open synchronously while user activation is still available.
            const popup = window.open("about:blank", "_blank");
            if (!popup) return ipcError("The browser blocked this link. Allow popups for this site and retry.");
            popup.opener = null;
            popup.location.replace(url.href);
            return ok({ opened: true });
          } catch {
            return validationError("Enter a valid web or email link.");
          }
        }
        const result = await request(input.namespace, input.action, input.payload);
        if (result.ok && input.namespace === "google" && input.action === "status") return ok({ ...result.data as object, ...googleAuth.status() });
        if (result.ok && input.namespace === "bootstrap") {
          const data = result.data as any;
          data.googleStatus = { ...data.googleStatus, ...googleAuth.status() };
          data.native = browserCapabilities(data.native);
        }
        if (result.ok && input.namespace === "native" && input.action === "capabilities") return ok(browserCapabilities(result.data));
        if (result.ok && input.namespace === "diagnostics" && input.action === "summary") {
          const data = result.data as any;
          data.native = { ...data.native, flags: { ...data.native?.flags, supportsNotifications: typeof Notification === "function" } };
        }
        if (result.ok && ["tasks", "calendar", "settings"].includes(input.namespace) && !["get", "list", "listEvents", "listCalendars", "listTaskLists", "forCalendarRange", "board", "context"].includes(input.action)) void notifications.refresh();
        return result;
      }
      const legacy = Object.entries(IPC_CHANNELS).flatMap(([namespace, actions]) =>
        Object.entries(actions).map(([action, name]) => ({ namespace, action, name }))
      ).find((entry) => entry.name === channel);
      return legacy
        ? request(legacy.namespace, legacy.action, payload as Record<string, unknown>)
        : validationError("Unknown workspace operation.");
    },
    subscribe: (channel, listener) => {
      const listeners = subscribers.get(channel) ?? new Set();
      listeners.add(listener);
      subscribers.set(channel, listeners);
      return () => { listeners.delete(listener); };
    }
  });
  Object.assign(api.diagnostics, { storage: () => request("diagnostics", "storage") });
  Object.assign(api, { workspace: {
    exportArchive: async () => {
      const result = await request("workspace", "exportArchive");
      if (!result.ok) return result;
      const { bytes, filename } = result.data as { bytes: Uint8Array<ArrayBuffer>; filename: string };
      downloadFile(bytes, filename, "application/vnd.sqlite3");
      return ok({ exported: true, message: "Workspace backup download started." });
    },
    stageImport: async () => {
      const file = await pickFile();
      if (!file) return ok({ cancelled: true });
      if (file.size > 128 * 1024 * 1024) return validationError("This backup exceeds the 128 MiB import limit.");
      return request("workspace", "stageImport", { bytes: new Uint8Array(await file.arrayBuffer()) });
    },
    confirmImport: (payload: Record<string, unknown>) => request("workspace", "confirmImport", payload),
    storageInfo: async () => {
      try { return ok(await browserStorageInfo()); }
      catch { return ipcError("The browser could not report storage usage. Export a backup before clearing site data."); }
    },
    requestPersistence: async () => {
      try {
        const granted = await navigator.storage?.persist?.() ?? false;
        return ok({ ...await browserStorageInfo(), granted });
      } catch { return ipcError("Persistent storage could not be granted. Your workspace still needs regular exports."); }
    },
    getPreferences: () => request("workspace", "getPreferences"),
    setPreference: (payload: Record<string, unknown>) => request("workspace", "setPreference", payload),
    subscribeChanges: (listener: () => void) => {
      workspaceListeners.add(listener);
      return () => { workspaceListeners.delete(listener); };
    }
  } });
  if (import.meta.env.MODE === "test") {
    Object.assign(api, { __testing: {
      configureGoogleAuth: async (clientId: string) => { googleAuth = makeGoogleAuth(clientId); await googleAuth.preload(); },
      failNextPersistence: () => request("__test", "failNextPersistence"),
      compatibility: () => request("__test", "compatibility"),
      seedDatabase: (payload: Record<string, unknown>) => request("__test", "seedDatabase", payload),
      exportArchive: () => request("workspace", "exportArchive"),
      stageImport: (bytes: Uint8Array) => request("workspace", "stageImport", { bytes })
    } });
  }
  // The shared constructor still declares its legacy type, but populates every
  // core namespace used by the current renderer.
  window.hcb = api as unknown as NonNullable<typeof window.hcb>;
  return hydratePreferences ? request("workspace", "getPreferences").then((result) => {
    hydratePanePreferences(result.ok ? result.data as Record<string, Record<string, unknown>> : {});
    if (!result.ok) fail(result.error.message);
    else {
      void notifications.refresh();
      setInterval(() => void notifications.refresh(), 60_000);
      stopSyncLifecycle = observeSyncLifecycle(event => {
        if (!workerUnavailable) worker.postMessage(event);
      });
    }
  }) : Promise.resolve();
}
