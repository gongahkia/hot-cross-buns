import { parentPort, workerData } from "node:worker_threads";
import { createServiceContainer } from "./serviceContainer";
import { CoreStoreError } from "./coreStore";
import type { CoreNativeBridge } from "./coreStore";
import type { GoogleOAuthPlatform } from "./googleOAuth";
import type { RuntimeCall, HostReply, NativeWorkspaceSnapshot } from "./workspaceProtocol";

const port = parentPort!;
let nextHostId = 0;
const hostRequests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
function host<T>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++nextHostId;
    hostRequests.set(id, { resolve, reject });
    port.postMessage({ kind: "host", id, method, args });
  });
}

const platform: GoogleOAuthPlatform = {
  isEncryptionAvailable: () => host<boolean>("credentials.available"),
  encryptString: (value) => host<Uint8Array>("credentials.encrypt", value),
  decryptString: (value) => host<string>("credentials.decrypt", value),
  openExternal: (url) => host<void>("oauth.openExternal", url)
};

async function start(): Promise<void> {
  const services = await createServiceContainer(workerData.userDataDirectory, platform);
  let nativeCapabilities = services.core.dispatch("native", "capabilities", {});
  let snapshotTimer: NodeJS.Timeout | null = null;
  let closing = false;
  const snapshot = (): NativeWorkspaceSnapshot => {
    const settings = services.core.dispatch("settings", "get", {});
    const planning = services.core.dispatch("native", "planningData", {}) as import("@shared/nativePlanning").NativePlanningData;
    const searchCounts: Record<string, number> = {};
    for (const view of (settings.savedSearchViews ?? []).filter((view: any) => settings.pinnedSavedSearchViewIds.includes(view.id)).slice(0, 6)) {
      searchCounts[view.query] = services.core.dispatch("search", "count", { query: view.query }).count;
    }
    return {
      settings,
      account: services.core.googleAccounts().find((account) => account.accountId !== "local") ?? null,
      tasks: planning.tasks,
      notificationTasks: planning.notificationTasks,
      events: planning.events,
      planningCounts: planning.counts,
      searchCounts
    };
  };
  const publishSnapshot = () => {
    snapshotTimer = null;
    port.postMessage({ kind: "snapshot", snapshot: snapshot() });
  };
  const clockTimer = setInterval(() => { if (!closing) scheduleSnapshot(); }, 60_000);
  clockTimer.unref();
  const scheduleSnapshot = () => {
    if (!closing && !snapshotTimer) snapshotTimer = setTimeout(publishSnapshot, 250);
  };
  const bridge: CoreNativeBridge = {
    capabilities: () => nativeCapabilities,
    listFontFamilies: () => host("native.listFontFamilies"),
    requestNotificationPermission: () => host("native.requestNotificationPermission"),
    openExternalUrl: (request) => host("native.openExternalUrl", request),
    checkForUpdates: () => host("native.checkForUpdates"),
    // The OS schedules from a compact cached snapshot in the main thread.
    rescheduleNotifications: () => host("native.rescheduleNotifications") as any,
    applySettings: (settings) => { port.postMessage({ kind: "settings", settings }); scheduleSnapshot(); }
  };
  services.core.attachNativeBridge(bridge);
  services.googleSync.onStatus((status) => {
    port.postMessage({ kind: "syncStatus", status });
    if (status.state !== "syncing") scheduleSnapshot();
  });

  const allowed: Record<string, Set<string>> = {
    core: new Set(["dispatch", "restoreLocalNotes"]),
    googleOAuth: new Set(["saveClient", "status", "begin", "reconfigureOptionalAccess", "cancel", "disconnect"]),
    googleSync: new Set(["startBackgroundSync", "stopBackgroundSync", "scheduleAfterLocalMutation", "runNow", "runAutomatic", "forceFullResync", "queryFreeBusy", "searchDriveFiles", "uploadLocalDriveFile", "searchGmailMessages", "captureGmailMessage"]),
    backups: new Set(["create", "start", "stop"])
  };
  port.on("message", async (message: RuntimeCall | HostReply | { kind: "nativeCapabilities"; value: any } | { kind: "close" }) => {
    if (message.kind === "hostReply") {
      const pending = hostRequests.get(message.id);
      hostRequests.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error));
      else pending?.resolve(message.result);
      return;
    }
    if (message.kind === "nativeCapabilities") { nativeCapabilities = message.value; return; }
    if (message.kind === "close") {
      closing = true;
      clearInterval(clockTimer);
      if (snapshotTimer) clearTimeout(snapshotTimer);
      await Promise.all([services.googleSync.shutdown(), services.backups.shutdown()]);
      services.core.close();
      port.postMessage({ kind: "closed" });
      return;
    }
    try {
      if (closing) throw new CoreStoreError("Hot Cross Buns is closing.");
      if (!allowed[message.target]?.has(message.method)) throw new CoreStoreError("Unsupported workspace worker operation.");
      if (message.target === "core" && message.method === "dispatch" && services.googleOAuth.isReconfiguring() && ["tasks", "calendar"].includes(String(message.args[0])) && !["list", "get", "board", "context", "forCalendarRange", "listTaskLists", "listCalendars", "listEvents"].includes(String(message.args[1]))) {
        throw new CoreStoreError("Google access is being reconfigured. Try again after authorization opens.");
      }
      const target = services[message.target] as any;
      const operation = target[message.method](...message.args);
      port.postMessage({ kind: "oauthState", reconfiguring: services.googleOAuth.isReconfiguring() });
      const result = await operation;
      port.postMessage({ kind: "reply", id: message.id, result });
      if (message.target !== "core" || !["list", "board", "context", "resolveLinks", "forCalendarRange", "get", "query", "summary", "logs", "status", "listTaskLists", "listCalendars", "listEvents", "listScheduledTaskBlocks", "recordTiming", "markCachedDataRendered"].includes(String(message.args[1]))) scheduleSnapshot();
    } catch (error) {
      port.postMessage({ kind: "reply", id: message.id, error: { name: error instanceof CoreStoreError ? "CoreStoreError" : "Error", message: error instanceof Error ? error.message : "Workspace operation failed." } });
    } finally {
      port.postMessage({ kind: "oauthState", reconfiguring: services.googleOAuth.isReconfiguring() });
    }
  });
  port.postMessage({ kind: "ready", snapshot: snapshot() });
}

void start().catch((error) => { port.postMessage({ kind: "fatal", error: error instanceof Error ? error.message : "The workspace could not start." }); });
