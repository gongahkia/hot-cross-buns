import { localStore } from "@/data/localStore";
import type { SyncProgress } from "@/features/useWorkspace";

export interface DiagnosticsSnapshot {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly app: { readonly version: string; readonly staticPwa: true };
  readonly browser: { readonly userAgent: string; readonly online: boolean; readonly capabilities: Readonly<Record<string, boolean>> };
  readonly sync: { readonly phase: SyncProgress["phase"]; readonly active: boolean; readonly pendingPages: number; readonly savedRecords: number };
  readonly storage: { readonly usage?: number; readonly quota?: number };
  readonly cache: Awaited<ReturnType<typeof localStore.diagnosticsCounts>>;
}

export async function buildDiagnostics(subject: string, sync: SyncProgress): Promise<DiagnosticsSnapshot> {
  const [storage, cache] = await Promise.all([localStore.storageEstimate(), localStore.diagnosticsCounts(subject)]);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { version: __APP_VERSION__, staticPwa: true },
    browser: {
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      capabilities: {
        indexedDb: typeof indexedDB !== "undefined",
        notifications: "Notification" in window,
        serviceWorker: "serviceWorker" in navigator,
        appBadge: "setAppBadge" in navigator,
        protocolHandler: "registerProtocolHandler" in navigator,
        fileSystemAccess: "launchQueue" in window,
        webShare: "share" in navigator
      }
    },
    sync: { phase: sync.phase, active: sync.active, pendingPages: sync.pagesSaved, savedRecords: sync.recordsSaved },
    storage,
    cache
  };
}

declare const __APP_VERSION__: string;
