import { createHcbApi } from "../preload/bridge";
import { IPC_CHANNELS } from "../shared/ipc";
import { ipcError, ok, validationError, type HcbResult } from "../shared/result";
import { hydratePanePreferences } from "../renderer/src/features/shell/panePreferences";

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
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  let worker: Worker;

  function fail(message: string): void {
    failure = ipcError(message);
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
      fail(event.message || "The workspace service stopped. Reload to reopen your saved workspace.");
    });
    worker.addEventListener("messageerror", () => {
      fail("The workspace service returned an unreadable message. Reload to retry.");
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "This browser could not start the workspace service.");
  }

  async function request(namespace: string, action: string, payload: Record<string, unknown> = {}): Promise<HcbResult<unknown>> {
    await ready;
    if (failure) return failure;
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

  const api = createHcbApi({
    invoke: async (channel, payload) => {
      if (channel === IPC_CHANNELS.core.invoke) {
        const input = payload as Request;
        // User-gesture APIs stay on the window; all SQL stays in the worker.
        if (input.namespace === "native" && input.action === "writeClipboardText") {
          if (typeof input.payload.text !== "string") return validationError("Clipboard text is required.");
          try {
            await navigator.clipboard.writeText(input.payload.text);
            return ok({ written: true });
          } catch {
            return ipcError("Clipboard access was denied. Allow clipboard access for this site and retry.");
          }
        }
        if (input.namespace === "native" && input.action === "openExternalUrl") {
          try {
            const url = new URL(String(input.payload.url));
            if (!["https:", "http:", "mailto:"].includes(url.protocol)) return validationError("Only web and email links can be opened.");
            window.open(url.href, "_blank", "noopener,noreferrer");
            return ok({ opened: true });
          } catch {
            return validationError("Enter a valid web or email link.");
          }
        }
        return request(input.namespace, input.action, input.payload);
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
    getPreferences: () => request("workspace", "getPreferences"),
    setPreference: (payload: Record<string, unknown>) => request("workspace", "setPreference", payload),
    subscribeChanges: (listener: () => void) => {
      workspaceListeners.add(listener);
      return () => { workspaceListeners.delete(listener); };
    }
  } });
  if (import.meta.env.MODE === "test") {
    Object.assign(api, { __testing: {
      failNextPersistence: () => request("__test", "failNextPersistence"),
      compatibility: () => request("__test", "compatibility"),
      seedDatabase: (payload: Record<string, unknown>) => request("__test", "seedDatabase", payload)
    } });
  }
  // The shared constructor still declares its legacy type, but populates every
  // core namespace used by the current renderer.
  window.hcb = api as unknown as NonNullable<typeof window.hcb>;
  return hydratePreferences ? request("workspace", "getPreferences").then((result) => {
    hydratePanePreferences(result.ok ? result.data as Record<string, Record<string, unknown>> : {});
    if (!result.ok) fail(result.error.message);
  }) : Promise.resolve();
}
