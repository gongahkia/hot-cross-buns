import { CoreStore, CoreStoreError } from '@shared/core/CoreStore';
import { payloadIsValid, requestSchema } from '@shared/ipc/coreValidation';
import { conflictError, internalError, ok, validationError } from '@shared/result';
import { getStartupTimings, markStartupTiming } from '@shared/core/startupTiming';
import { loadSqlite, WasmDatabase } from './sqliteDatabase';
import { commitSnapshot, openWorkspaceStorage, readSnapshot, WORKSPACE_LOCK, type DurableSnapshot } from './indexedDb';
import { verifySqliteCompatibility } from './compatibility';

const googleUnavailable = 'Google connection and sync are not available in this browser version yet. Continue using your local lists and calendar; Google support will be added separately.';
const startedAt = performance.now();
const writerId = crypto.randomUUID();
let storage: IDBDatabase;
let database: WasmDatabase;
let core: CoreStore;
let durable: DurableSnapshot | undefined;
let failNextPersistence = false;
let fatal: string | undefined;
const metrics = { strategy: 'SQLite snapshot in IndexedDB', revision: 0, bytes: 0, exportMs: 0, persistMs: 0, loadMs: 0, commits: 0 };
const changes = new BroadcastChannel('hot-cross-buns-workspace-changes');

function capabilities() {
  return {
    platform: 'web', supportsOAuthLoopback: false, globalShortcuts: false, tray: false, deepLinks: false,
    trayStatus: { state: 'unsupported', message: 'Desktop tray controls are not available in a browser.' },
    notificationsStatus: { permission: 'unsupported', scheduledCount: 0, state: 'unsupported', message: 'Background notifications are not available in this browser version.' },
    deepLinkStatus: { scheme: 'hotcrossbuns', registered: false, state: 'unsupported', message: 'Use the planner in this browser tab.' },
    updaterStatus: { state: 'unsupported', message: 'Reload the site to use the latest deployed version.' },
    mcpStatus: { state: 'disabled', message: 'MCP is not available in the browser.' },
    capabilityReport: { platform: 'web', adapterId: 'browser-indexeddb', packageFormat: 'web', flags: {}, paths: [], capabilities: [], diagnostics: [] },
    deferredStartup: { state: 'complete' },
  };
}

async function replaceDatabase(snapshot: DurableSnapshot | undefined): Promise<void> {
  core?.close();
  const sqlite = await loadSqlite();
  database = new WasmDatabase(sqlite, snapshot?.bytes);
  try {
    core = new CoreStore(database, { platform: 'web' });
    core.attachNativeBridge({
      capabilities,
      listFontFamilies: () => ({ platform: 'web', families: [] }),
      requestNotificationPermission: () => ({ state: 'unsupported' }),
      openExternalUrl: () => ({ opened: false }),
    });
  } catch (error) { database.close(); throw error; }
  durable = snapshot;
  metrics.revision = snapshot?.revision ?? 0;
  metrics.bytes = snapshot?.bytes.byteLength ?? 0;
}

async function save(bytes?: Uint8Array<ArrayBuffer>, notify = true): Promise<void> {
  const start = performance.now();
  const exported = bytes ?? database.export();
  metrics.exportMs = performance.now() - start;
  const snapshot: DurableSnapshot = { format: 1, revision: (durable?.revision ?? 0) + 1, bytes: exported, savedAt: new Date().toISOString() };
  const fail = failNextPersistence;
  failNextPersistence = false;
  const beforeCommit = performance.now();
  await commitSnapshot(storage, snapshot, durable?.revision ?? 0, fail);
  metrics.persistMs = performance.now() - beforeCommit;
  durable = snapshot;
  metrics.revision = snapshot.revision;
  metrics.bytes = exported.byteLength;
  metrics.commits++;
  if (notify) changes.postMessage({ revision: snapshot.revision, writerId });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function refresh(): Promise<void> {
  const start = performance.now();
  const snapshot = await readSnapshot(storage);
  if (snapshot !== undefined && (!snapshot || typeof snapshot !== 'object' || snapshot.format !== 1 || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || !(snapshot.bytes instanceof Uint8Array) || snapshot.bytes.byteLength < 100)) {
    throw new Error('The IndexedDB workspace format is not supported. Saved data has been preserved.');
  }
  if (!core || snapshot?.revision !== durable?.revision) {
    // An existing active workspace disappearing is not a new workspace.
    if (core && durable && !snapshot) throw new Error('Workspace storage was removed in another tab. Reload before continuing.');
    try {
      await replaceDatabase(snapshot);
      const bytes = database.export();
      if (!snapshot || !sameBytes(snapshot.bytes, bytes)) await save(bytes);
    } catch (error) {
      // A failed migration commit must never leave a usable but unpersisted
      // upgraded connection. Preserve IndexedDB and require a clean retry.
      database?.close();
      fatal = `The workspace could not finish initialization. Reload to retry; its saved data has been preserved. ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }
  metrics.loadMs = performance.now() - start;
}

function browserResult(namespace: string, action: string, value: any): any {
  if (namespace === 'bootstrap') {
    value.googleStatus = { ...value.googleStatus, available: false, message: googleUnavailable };
    value.syncStatus = { ...value.syncStatus, available: false, message: googleUnavailable };
  } else if ((namespace === 'google' || namespace === 'sync') && action === 'status') {
    value = { ...value, available: false, message: googleUnavailable };
  }
  return value;
}

async function handle(request: { id: number; namespace: string; action: string; payload: Record<string, any> }) {
  const { namespace, action, payload = {} } = request;
  if (fatal) return internalError(fatal);
  if (namespace === '__test' && import.meta.env.MODE === 'test') {
    if (action === 'failNextPersistence') { failNextPersistence = true; return ok({ armed: true }); }
    if (action === 'compatibility') return ok(await verifySqliteCompatibility());
  } else if (namespace === 'workspace') {
    if (!['getPreferences', 'setPreference'].includes(action) ||
        (action === 'setPreference' && (![payload.pane, payload.key].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(value)) || JSON.stringify(payload.value ?? null).length > 100_000))) {
      return validationError('Invalid workspace preference.');
    }
  } else if (!(namespace === 'diagnostics' && ['storage', 'health', 'markShellVisible'].includes(action))) {
    if (!requestSchema.safeParse({ namespace, action, payload }).success || !payloadIsValid(namespace, action, payload)) {
      return validationError('Unsupported or malformed application request.');
    }
  }
  if ((namespace === 'google' && action !== 'status') || (namespace === 'sync' && action !== 'status') ||
      (namespace === 'calendar' && action === 'freeBusy') ||
      (namespace === 'diagnostics' && ['retryPendingMutation', 'resolveMutation', 'previewMutationResolution'].includes(action)) ||
      (namespace === 'settings' && action === 'recoveryAction' && ['refresh', 'forceFullResync'].includes(payload.action))) {
    return conflictError(googleUnavailable);
  }
  try {
    return await navigator.locks.request(WORKSPACE_LOCK, { mode: 'exclusive' }, async () => {
      await refresh();
      if (namespace === 'diagnostics' && action === 'storage') return ok({ ...metrics, savedAt: durable?.savedAt });
      if (namespace === 'diagnostics' && action === 'health') return ok({ status: 'ok', version: '5.0.1', environment: import.meta.env.MODE === 'test' ? 'test' : import.meta.env.PROD ? 'production' : 'development', timestamp: new Date().toISOString(), uptimeMs: performance.now() - startedAt, startup: getStartupTimings() });
      const previousChanges = database.totalChanges;
      const previousSchema = database.pragma('schema_version', { simple: true });
      try {
        const value = database.transaction(() => {
          if (namespace === '__test' && action === 'seedDatabase' && import.meta.env.MODE === 'test') {
            for (const { sql, values } of payload.statements ?? []) {
              if (values) { const statement = database.prepare(sql); try { statement.run(...values); } finally { statement.finalize?.(); } }
              else database.exec(sql);
            }
            return { seeded: true };
          }
          if (namespace === 'workspace') {
            const preferences = core.dispatch('settings', 'get', {}).panePreferences ?? {};
            if (action === 'getPreferences') return preferences;
            const pane = { ...(preferences[payload.pane] ?? {}) };
            delete pane[payload.key];
            pane[payload.key] = payload.value ?? null;
            const next = { ...preferences };
            delete next[payload.pane];
            next[payload.pane] = Object.fromEntries(Object.entries(pane).slice(-48));
            const bounded = Object.fromEntries(Object.entries(next).slice(-16));
            core.dispatch('settings', 'update', { panePreferences: bounded });
            return bounded;
          }
          return core.dispatch(namespace, action, payload);
        })();
        if (database.totalChanges !== previousChanges || database.pragma('schema_version', { simple: true }) !== previousSchema) {
          await save(undefined, namespace !== 'diagnostics');
        }
        return ok(browserResult(namespace, action, value));
      } catch (error) {
        // SQL may already have committed when IndexedDB fails. Restore the
        // entire last durable DB (including FTS, outbox and undo) and all caches.
        try { const previous = await readSnapshot(storage);
          if (durable && !previous) throw new Error('The saved workspace was removed; refusing to replace it with an empty database.');
          await replaceDatabase(previous); }
        catch (restoreError) { fatal = `The workspace could not be restored after a failed request. Reload to retry. ${String(restoreError)}`; }
        if (error instanceof CoreStoreError) return conflictError(error.message);
        return internalError(`Your change was not saved. The previous saved workspace has been preserved. ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    return internalError(`The saved workspace could not be accessed. Reload to retry; saved data has not been reset. ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Requests in one worker must also be ordered; async message listeners alone
// would overlap while waiting for the same IndexedDB transaction.
let requests = Promise.resolve();
self.onmessage = ({ data }) => {
  requests = requests.then(async () => {
    try { postMessage({ id: data.id, result: await handle(data) }); }
    catch (error) { postMessage({ id: data.id, result: internalError(String(error)) }); }
  });
};

async function start() {
  if (!navigator.locks) throw new Error('This browser requires Web Locks support. Use a current browser on HTTPS or localhost.');
  storage = await openWorkspaceStorage();
  await navigator.locks.request(WORKSPACE_LOCK, { mode: 'exclusive' }, refresh);
  markStartupTiming('appReadyMs');
  postMessage({ type: 'ready', writerId });
}
void start().catch(error => postMessage({ type: 'initialization-error', message: `The workspace could not open. Its saved data has not been erased. ${String(error)}` }));
