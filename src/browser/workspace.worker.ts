import { CoreStore, CoreStoreError } from '@shared/core/CoreStore';
import { payloadIsValid, requestSchema } from '@shared/ipc/coreValidation';
import { conflictError, internalError, ok, validationError } from '@shared/result';
import { getStartupTimings, markStartupTiming } from '@shared/core/startupTiming';
import { loadSqlite, WasmDatabase } from './sqliteDatabase';
import { commitSnapshot, openWorkspaceStorage, readSnapshot, readRevision, WORKSPACE_LOCK, type DurableSnapshot } from './indexedDb';
import { verifySqliteCompatibility } from './compatibility';
import { stageWorkspaceImport, type StagedImport } from './workspaceTransfer';
import { BrowserGoogleSync } from './googleSync';
import { BrowserGoogleSessions } from './googleSyncSessions';
import { SyncPersistenceError } from '@shared/google/types';
import { IPC_CHANNELS } from '@shared/ipc';
import { recordTiming, timedAsync } from '@shared/core/performance';
import type { AutomaticSyncReason } from './syncSchedule';

const googleSessions = new BrowserGoogleSessions();
let googleSync: BrowserGoogleSync;
let visible = true;
let automaticSyncPaused = false;
let mutationSyncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLocalSync() {
  const mode = core.dispatch('settings', 'get').syncMode;
  if (mutationSyncTimer) clearTimeout(mutationSyncTimer);
  if (mode === 'manual') { mutationSyncTimer = undefined; return; }
  mutationSyncTimer = setTimeout(() => {
    mutationSyncTimer = undefined;
    queueAutomaticSync('local-mutation');
  }, mode === 'near-real-time' ? 150 : 500);
}
const startedAt = performance.now();
const writerId = crypto.randomUUID();
let storage: IDBDatabase;
let database: WasmDatabase;
let core: CoreStore;
let durable: DurableSnapshot | undefined;
let persistedChanges = 0;
let persistedSchema = 0;
let reopenedChanges = false;
let failNextPersistence = false;
let pauseNextPersistence = false;
let stagedImport: StagedImport | undefined;
let fatal: string | undefined;
const metrics = { strategy: 'SQLite snapshot in IndexedDB', revision: 0, bytes: 0, exportMs: 0, persistMs: 0, loadMs: 0, commits: 0 };
const changes = new BroadcastChannel('hot-cross-buns-workspace-changes');

async function withWorkspaceLock<T>(action: () => Promise<T>): Promise<T> {
  const waitingAt = performance.now();
  return await navigator.locks.request(WORKSPACE_LOCK, { mode: 'exclusive' }, () => {
    recordTiming({ name: 'workspace.lock.wait', kind: 'worker', durationMs: performance.now() - waitingAt });
    return action();
  });
}

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
  const initialChanges = database.totalChanges;
  try {
    core = new CoreStore(database, { platform: 'web' });
    reopenedChanges = database.totalChanges !== initialChanges;
    googleSync = new BrowserGoogleSync(core, googleSessions, async () => {
      // An unchanged state is already durable. In particular, Drive chunks do
      // not require re-exporting the same database after their intent is saved.
      if (reopenedChanges || database.totalChanges !== persistedChanges || database.pragma('schema_version', { simple: true }) !== persistedSchema) await save();
    });
    googleSync.service.onStatus(status => postMessage({ type: 'event', channel: IPC_CHANNELS.core.syncStatus, payload: status }));
    core.attachNativeBridge({
      capabilities,
      listFontFamilies: () => ({ platform: 'web', families: [] }),
      requestNotificationPermission: () => ({ state: 'unsupported' }),
      openExternalUrl: () => ({ opened: false }),
    });
  } catch (error) { database.close(); throw error; }
  durable = snapshot;
  if (database?.raw.pointer) {
    persistedChanges = database.totalChanges;
    persistedSchema = database.pragma('schema_version', { simple: true });
  }
  metrics.revision = snapshot?.revision ?? 0;
  metrics.bytes = snapshot?.bytes.byteLength ?? 0;
}

async function save(bytes?: Uint8Array<ArrayBuffer>, notify = true): Promise<void> {
  const start = performance.now();
  const exported = bytes ?? database.export();
  metrics.exportMs = performance.now() - start;
  recordTiming({ name: 'workspace.snapshot.export', kind: 'storage', durationMs: metrics.exportMs });
  const snapshot: DurableSnapshot = { format: 1, revision: (durable?.revision ?? 0) + 1, bytes: exported, savedAt: new Date().toISOString() };
  const fail = failNextPersistence;
  failNextPersistence = false;
  if (import.meta.env.MODE === 'test' && pauseNextPersistence) {
    pauseNextPersistence = false;
    postMessage({ type: 'test:persistence-paused' });
    await new Promise<void>(() => { /* Test closes this worker at the save boundary. */ });
  }
  const beforeCommit = performance.now();
  await timedAsync('workspace.snapshot.persist', 'storage', () => commitSnapshot(storage, snapshot, durable?.revision ?? 0, fail));
  metrics.persistMs = performance.now() - beforeCommit;
  reopenedChanges = false;
  durable = snapshot;
  if (database?.raw.pointer) {
    persistedChanges = database.totalChanges;
    persistedSchema = database.pragma('schema_version', { simple: true });
  }
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
  if (core && !fatal && !reopenedChanges && await readRevision(storage) === durable?.revision) {
    metrics.loadMs = performance.now() - start;
    return;
  }
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
  // Recovery can mark an interrupted remote create as uncertain. Make that
  // recovery state durable before serving a later successful request.
  if (reopenedChanges) {
    try { await save(); }
    catch (error) {
      fatal = 'Interrupted-operation recovery could not be saved. Reload to retry; the original saved snapshot is preserved.';
      throw error;
    }
  }
  metrics.loadMs = performance.now() - start;
}

function browserSyncStatus() {
  const status = core.dispatch('sync', 'status');
  if (status.state === 'syncing' && !core.googleAccounts().some(account => googleSessions.has(account.accountId, account.googleAccountId))) {
    return { ...status, state: status.pendingMutationCount ? 'pending' : 'idle', stale: true,
      message: 'The previous sync stopped when its tab closed. Reconnect Google to continue; queued changes are preserved.' };
  }
  return status;
}

function browserResult(namespace: string, action: string, value: any): any {
  if (namespace === 'bootstrap') { value.googleStatus = googleSync.status(); value.syncStatus = browserSyncStatus(); }
  if (namespace === 'sync' && action === 'status') return browserSyncStatus();
  if (namespace === 'google' && action === 'status') return googleSync.status();
  return value;
}

function updateGoogleSession(action: string, payload: Record<string, any>) {
  if (action === 'attachSession') {
    const { session, expectedAccountId } = payload;
    if (!session?.account?.id || typeof session.accessToken !== 'string' || !Array.isArray(session.scopes) || !session.scopes.every((scope: unknown) => typeof scope === 'string')) throw new CoreStoreError('Invalid Google session. Reconnect.');
    if (expectedAccountId) {
      const expected = core.googleAccount(expectedAccountId);
      if (!expected || expected.googleAccountId !== session.account.id) throw new CoreStoreError('A different Google account was selected. Reconnect the intended account, or add this account separately.');
    }
    const account = core.upsertGoogleAccount({ googleAccountId: session.account.id, email: session.account.email,
      displayName: session.account.name, avatarUrl: session.account.picture, grantedScopes: session.scopes, connectionState: 'connected' });
    googleSessions.set(account.accountId, { accessToken: session.accessToken, expiresAt: session.expiresAt, subject: session.account.id, scopes: session.scopes });
    return googleSync.status();
  }
  const account = core.googleAccount(payload.accountId);
  if (!account || account.accountId === 'local') throw new CoreStoreError('Choose an existing Google account.');
  if (payload.reason === 'expired' && (googleSessions.metadata(account.accountId)?.expiresAt ?? 0) > Date.now()) return googleSync.status();
  googleSessions.delete(account.accountId);
  // Expiry belongs to this worker's credential, not the shared account. Other
  // tabs may still have valid sessions. status() projects reauth_required here.
  // Explicit disconnect still fences every worker through the durable account.
  if (payload.reason !== 'expired') core.updateGoogleAccountState(account.accountId, 'disconnected', 'Disconnected from this workspace.');
  return googleSync.status();
}

async function handle(request: { id: number; namespace: string; action: string; payload: Record<string, any> }) {
  const { namespace, action, payload = {} } = request;
  if (namespace === 'workspace' && ['exportArchive', 'stageImport', 'confirmImport'].includes(action)) {
    try {
      if (!storage) throw new Error('Browser storage is unavailable. Allow site storage and reload before importing.');
      return await withWorkspaceLock(async () => {
        const current = await readSnapshot(storage);
        if (action === 'exportArchive') {
          if (!current?.bytes) throw new Error('There is no saved workspace to export.');
          return ok({ bytes: current.bytes, filename: `hot-cross-buns-${new Date().toISOString().slice(0, 10)}.sqlite` });
        }
        if (action === 'stageImport') {
          stagedImport = undefined;
          stagedImport = await stageWorkspaceImport(payload.bytes, current?.revision ?? 0);
          return ok(stagedImport.review);
        }
        if (!stagedImport || payload.reviewId !== stagedImport.review.reviewId || payload.confirmation !== 'REPLACE_WORKSPACE') {
          throw new Error('Review a workspace backup and explicitly confirm replacement first.');
        }
        if (stagedImport.expiresAt < Date.now() || stagedImport.revision !== (current?.revision ?? 0)) {
          stagedImport = undefined;
          throw new Error('The review expired or this workspace changed. Review the backup again before replacing it.');
        }
        const candidate = stagedImport;
        const activeDurable = durable;
        durable = current;
        // The reviewed candidate has already migrated and passed integrity checks.
        // Save it atomically before discarding any active workspace connection.
        try { await save(candidate.bytes); }
        catch (error) {
          // Staging reads the latest durable revision without replacing this
          // tab's active DB. A failed import must not falsely advance its
          // active revision and hide a different tab's committed edits.
          durable = activeDurable;
          throw error;
        }
        stagedImport = undefined;
        googleSessions.clear();
        fatal = undefined;
        try { await replaceDatabase(durable); }
        catch {
          fatal = 'The reviewed backup was saved successfully, but could not open in this tab. Reload to open the restored workspace.';
          return ok({ replaced: true, reloadRequired: true });
        }
        return ok({ replaced: true });
      });
    } catch (error) { return conflictError(error instanceof Error ? error.message : String(error)); }
  }
  if (fatal) return internalError(fatal);
  if (namespace === '__test' && import.meta.env.MODE === 'test') {
    if (action === 'pauseNextPersistence') { pauseNextPersistence = true; return ok({ armed: true }); }
    if (action === 'failNextPersistence') { failNextPersistence = true; return ok({ armed: true }); }
    if (action === 'compatibility') return ok(await verifySqliteCompatibility());
  } else if (namespace === '__google' && ['attachSession', 'removeSession'].includes(action)) {
    // Tokens cross this private in-process boundary only; never domain dispatch.
  } else if (namespace === 'google' && action === 'uploadDriveFile' && payload.file instanceof Blob) {
    // File objects are picked on the window, then read/uploaded in this worker.
  } else if (namespace === '__automatic' && action === 'sync') {
    // Internal timer shares the exact same queue and writer lock.
  } else if (namespace === 'workspace') {
    if (!['getPreferences', 'setPreference'].includes(action) ||
        (action === 'setPreference' && (![payload.pane, payload.key].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(value)) || JSON.stringify(payload.value ?? null).length > 100_000))) {
      return validationError('Invalid workspace preference.');
    }
  } else if (!(namespace === 'diagnostics' && ['storage', 'health', 'markShellVisible', 'reminderSnapshot'].includes(action))) {
    if (!requestSchema.safeParse({ namespace, action, payload }).success || !payloadIsValid(namespace, action, payload)) {
      return validationError('Unsupported or malformed application request.');
    }
  }
  try {
    return await withWorkspaceLock(async () => {
      await refresh();
      if (namespace === 'diagnostics' && action === 'storage') return ok({ ...metrics, savedAt: durable?.savedAt, wasmHeapBytes: database.sqlite.wasm.heap8u().byteLength });
      if (namespace === 'diagnostics' && action === 'reminderSnapshot') return ok({ settings: core.dispatch('settings', 'get'), planning: core.dispatch('native', 'planningData') });
      if (namespace === 'diagnostics' && action === 'health') return ok({ status: 'ok', version: '5.0.1', environment: import.meta.env.MODE === 'test' ? 'test' : import.meta.env.PROD ? 'production' : 'development', timestamp: new Date().toISOString(), uptimeMs: performance.now() - startedAt, startup: getStartupTimings() });
      if (namespace === '__automatic') {
        if (automaticSyncPaused || !navigator.onLine) return ok({ skipped: true });
      }
      try {
        // Async Google work must not hold a SQLite savepoint across an await.
        // The Web Lock and this worker queue remain held; each remote boundary
        // checkpoints through save() before the service can continue.
        if (namespace === 'sync' && action === 'runNow') automaticSyncPaused = false;
        let remote = { handled: false } as { handled: boolean; value?: any };
        if (namespace === '__automatic') remote = { handled: true, value: await googleSync.runAutomatic(payload.reason ?? 'interval', visible) };
        else if (namespace === 'settings' && action === 'recoveryAction' && ['refresh', 'forceFullResync'].includes(payload.action)) {
          remote = await googleSync.dispatch('sync', payload.action === 'refresh' ? 'runNow' : 'forceFullResync', payload);
        } else remote = await googleSync.dispatch(namespace, action, payload);
        const value = remote.handled ? remote.value : database.transaction(() => {
          if (namespace === '__google') return updateGoogleSession(action, payload);
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
        const changed = database.totalChanges !== persistedChanges;
        if (database.totalChanges !== persistedChanges || database.pragma('schema_version', { simple: true }) !== persistedSchema) {
          await save(undefined, namespace !== 'diagnostics');
        }
        if (changed && (['tasks', 'calendar', 'undo'].includes(namespace) ||
            namespace === 'google' && ['captureGmailMessage', 'copyAccountData'].includes(action))) scheduleLocalSync();
        if (changed && namespace === 'settings' && action === 'update') queueAutomaticSync('foreground');
        // Drain the next bounded batch without waiting for the polling interval.
        // A deferred/blocked queue is not ready; a failed pull has a shared cooldown.
        if (remote.handled && ['sync', '__automatic'].includes(namespace) && !value?.skipped && core.pendingSyncMutations(1).length) scheduleLocalSync();
        return ok(browserResult(namespace, action, value));
      } catch (error) {
        // SQL may already have committed when IndexedDB fails. Restore the
        // entire last durable DB (including FTS, outbox and undo) and all caches.
        try { const previous = await readSnapshot(storage);
          if (durable && !previous) throw new Error('The saved workspace was removed; refusing to replace it with an empty database.');
          await replaceDatabase(previous); }
        catch (restoreError) { fatal = `The workspace could not be restored after a failed request. Reload to retry. ${String(restoreError)}`; }
        if (error instanceof SyncPersistenceError) {
          automaticSyncPaused = true;
          return conflictError('Google sync stopped because a durable checkpoint could not be saved. The last saved workspace was restored. Google may already have accepted a request; review pending changes in Diagnostics before explicitly retrying sync.');
        }
        if (error instanceof CoreStoreError) return conflictError(error.message);
        if (['google', 'sync', '__automatic'].includes(namespace)) return conflictError(`Google operation stopped. Progress saved at earlier checkpoints is preserved. ${error instanceof Error ? error.message : 'Reconnect and retry when online.'}`);
        return internalError(`Your change was not saved. The previous saved workspace has been preserved. ${error instanceof Error && error.name === 'QuotaExceededError' ? 'Browser storage is full. Export a backup, free disk space or allow more site storage, then retry.' : error instanceof Error ? error.message : String(error)}`);
      }
    });
  } catch (error) {
    return internalError(`The saved workspace could not be accessed. Reload to retry; saved data has not been reset. ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Requests in one worker must also be ordered; async message listeners alone
// would overlap while waiting for the same IndexedDB transaction.
let requests = Promise.resolve();
let automaticQueued = false;
let automaticReason: AutomaticSyncReason | undefined;
const reasonPriority: Record<AutomaticSyncReason, number> = { 'workspace-change': 0, 'local-mutation': 1, interval: 2, foreground: 3, online: 4 };
function queueAutomaticSync(reason: AutomaticSyncReason) {
  if (!automaticReason || reasonPriority[reason] > reasonPriority[automaticReason]) automaticReason = reason;
  if (automaticQueued) return;
  automaticQueued = true;
  const queuedAt = performance.now();
  requests = requests.then(async () => {
    const pending = automaticReason;
    automaticReason = undefined;
    recordTiming({ name: 'workspace.queue.wait', kind: 'worker', durationMs: performance.now() - queuedAt });
    await handle({ id: 0, namespace: '__automatic', action: 'sync', payload: { reason: pending } });
  }).catch(() => undefined).finally(() => {
    automaticQueued = false;
    if (automaticReason) queueAutomaticSync(automaticReason);
  });
}

changes.addEventListener('message', ({ data }) => {
  if (typeof data?.writerId === 'string' && data.writerId !== writerId && Number.isSafeInteger(data.revision)) queueAutomaticSync('workspace-change');
});
// Browsers may suspend timers; there is deliberately no closed-app sync claim.
setInterval(() => queueAutomaticSync('interval'), 30_000);
self.onmessage = ({ data }) => {
  // Visibility must take effect even while a network operation owns the queue.
  if (data?.type === 'sync-lifecycle' && typeof data.visible === 'boolean') {
    visible = data.visible;
    if (data.reason === 'foreground' || data.reason === 'online') queueAutomaticSync(data.reason);
    return;
  }
  const queuedAt = performance.now();
  requests = requests.then(async () => {
    recordTiming({ name: 'workspace.queue.wait', kind: 'worker', durationMs: performance.now() - queuedAt });
    try { postMessage({ id: data.id, result: await handle(data) }); }
    catch (error) { postMessage({ id: data.id, result: internalError(String(error)) }); }
  });
};

async function start() {
  if (!navigator.locks) throw new Error('This browser requires Web Locks support. Use a current browser on HTTPS or localhost.');
  storage = await openWorkspaceStorage();
  await withWorkspaceLock(refresh);
  markStartupTiming('appReadyMs');
  postMessage({ type: 'ready', writerId });
}
void start().catch(error => { fatal = String(error); postMessage({ type: 'initialization-error', message: `The workspace could not open. Its saved data has not been erased. ${String(error)}` }); });
