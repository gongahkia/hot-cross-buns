import Database from 'better-sqlite3';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreStore } from '@shared/core/CoreStore';
import { SyncPersistenceError, type SyncCheckpoint } from '@shared/google/types';
import { BrowserGoogleSync } from './googleSync';
import { BrowserGoogleSessions } from './googleSyncSessions';
import { syncScheduleKey } from './syncSchedule';

const databases: Database.Database[] = [];
const tasksScope = 'https://www.googleapis.com/auth/tasks';
const calendarScope = 'https://www.googleapis.com/auth/calendar';
const driveScope = 'https://www.googleapis.com/auth/drive.file';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  for (const database of databases.splice(0)) if (database.open) database.close();
});
function database(bytes?: Buffer) {
  const db = new Database(bytes ?? ':memory:'); databases.push(db); return db;
}
function fixture(scopes = [tasksScope, calendarScope, driveScope]) {
  const db = database(), store = new CoreStore(db);
  const account = store.upsertGoogleAccount({ googleAccountId: 'verified-subject', email: 'person@example.com', connectionState: 'connected', grantedScopes: scopes });
  const list = store.upsertGoogleTaskList({ id: 'remote-list', title: 'Google list' }, account.accountId);
  store.dispatch('settings', 'update', { syncCalendarEventsEnabled: false });
  const remoteTasks: any[] = [];
  const writes: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/users/@me/lists')) return Response.json({ items: [{ id: 'remote-list', title: 'Google list' }] });
    if (url.pathname.endsWith('/tasks') && init?.method === 'POST') {
      writes.push('task.create');
      const task = { ...JSON.parse(String(init.body)), id: `remote-task-${remoteTasks.length + 1}`, etag: 'accepted', updated: new Date().toISOString() };
      remoteTasks.push(task);
      return Response.json(task);
    }
    if (url.pathname.endsWith('/tasks')) return Response.json({ items: remoteTasks });
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [] });
    throw new Error(`Unexpected Google request ${url}`);
  });
  const sessions = new BrowserGoogleSessions(fetcher);
  sessions.set(account.accountId, { accessToken: 'memory-only-secret', subject: 'verified-subject', expiresAt: Date.now() + 3_600_000, scopes });
  return { db, store, account, list, fetcher, sessions, writes };
}

describe('browser automatic sync coordination', () => {
  it('shares successful scheduling across workers and skips unauthorized accounts', async () => {
    const f = fixture();
    const first = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    await first.runAutomatic('foreground', true);
    const calls = f.fetcher.mock.calls.length;
    const other = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    expect(await other.runAutomatic('foreground', true)).toEqual({ skipped: true });
    expect(await other.runAutomatic('interval', true)).toEqual({ skipped: true });
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
    const missingSession = f.store.upsertGoogleAccount({ googleAccountId: 'another-subject', connectionState: 'connected' });
    await other.dispatch('sync', 'runNow');
    expect(f.store.googleOperationRecord(missingSession.accountId, syncScheduleKey)).toBeNull();
    expect(f.store.googleOperationRecord(f.account.accountId, syncScheduleKey)).toMatchObject({ failures: 0, retryAfter: 0 });
  });

  it('delivers queued edits from a hidden authorized worker but respects manual mode', async () => {
    const f = fixture();
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    expect(await sync.runAutomatic('interval', false)).toEqual({ skipped: true });
    f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Saved in another tab' });
    f.store.dispatch('settings', 'update', { syncMode: 'manual' });
    expect(await sync.runAutomatic('workspace-change', false)).toEqual({ skipped: true });
    expect(f.fetcher).not.toHaveBeenCalled();
    f.store.dispatch('settings', 'update', { syncMode: 'balanced' });
    await sync.runAutomatic('workspace-change', false);
    expect(f.writes).toEqual(['task.create']);
    expect(await sync.runAutomatic('workspace-change', false)).toEqual({ skipped: true });
  });

  it('persists failed-pull cooldown across workers and lets an explicit retry recover', async () => {
    const f = fixture();
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    f.fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(sync.runAutomatic('foreground', true)).rejects.toThrow();
    expect(f.store.googleOperationRecord(f.account.accountId, syncScheduleKey)).toMatchObject({ failures: 1 });
    const other = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    expect(await other.runAutomatic('online', true)).toEqual({ skipped: true });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await other.dispatch('sync', 'runNow');
    expect(f.store.googleOperationRecord(f.account.accountId, syncScheduleKey)).toMatchObject({ failures: 0, retryAfter: 0 });
  });

  it('does not make a request if the scheduling claim cannot be made durable', async () => {
    const f = fixture();
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => { throw new Error('Quota'); });
    await expect(sync.runAutomatic('foreground', true)).rejects.toBeInstanceOf(SyncPersistenceError);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe('browser sync durable boundaries', () => {
  it('keeps the lease released until the complete HTTP response body arrives', async () => {
    const f = fixture();
    let stream!: ReadableStreamDefaultController<Uint8Array>, unlocked = false;
    f.fetcher.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })));
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {}, async wait => {
      unlocked = true;
      try { return await wait(); } finally { unlocked = false; }
    });
    const pending = sync.service.runNow();
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
    expect(unlocked).toBe(true);
    f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Edited during the body download' });
    stream.enqueue(new TextEncoder().encode(JSON.stringify({ items: [{ id: 'remote-list', title: 'Google list' }] }))); stream.close();
    await pending;
    expect(unlocked).toBe(false);
    expect(f.writes).toEqual(['task.create']);
  });

  it('does not send a remote creation before its IndexedDB-equivalent checkpoint succeeds', async () => {
    const f = fixture();
    f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Never sent' });
    const sync = new BrowserGoogleSync(f.store, f.sessions, async checkpoint => {
      if (checkpoint.stage === 'before-remote-write') throw new Error('Disk full');
    });
    await expect(sync.service.runNow()).rejects.toBeInstanceOf(SyncPersistenceError);
    expect(f.writes).toEqual([]);
  });

  it('persists creation intent before HTTP, and remote identity plus delivered outbox atomically after receipt', async () => {
    const f = fixture();
    const task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Durable remote task' });
    const snapshots: Array<{ checkpoint: SyncCheckpoint; bytes: Buffer }> = [];
    const sync = new BrowserGoogleSync(f.store, f.sessions, async checkpoint => { snapshots.push({ checkpoint, bytes: f.db.serialize() }); });
    await sync.service.runNow();
    expect(f.writes).toEqual(['task.create']);
    const before = database(snapshots.find(item => item.checkpoint.stage === 'before-remote-write')!.bytes);
    expect(before.prepare('SELECT creation_started AS started,state FROM outbox WHERE entity_id=?').get(task.id)).toEqual({ started: 1, state: 'pending' });
    const receipt = database(snapshots.find(item => item.checkpoint.stage === 'mutation-receipt')!.bytes);
    expect(receipt.prepare('SELECT google_id AS id FROM tasks WHERE id=?').get(task.id)).toEqual({ id: 'remote-task-1' });
    expect(receipt.prepare('SELECT creation_started AS started,state FROM outbox WHERE entity_id=?').get(task.id)).toEqual({ started: 0, state: 'delivered' });
    expect(receipt.serialize().includes(Buffer.from('memory-only-secret'))).toBe(false);
  });

  it('never creates again after receipt persistence fails and the last durable snapshot reopens', async () => {
    const f = fixture();
    const task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Ambiguous accepted task' });
    let durable = f.db.serialize();
    const sync = new BrowserGoogleSync(f.store, f.sessions, async checkpoint => {
      if (checkpoint.stage === 'mutation-receipt') throw new Error('IndexedDB aborted');
      durable = f.db.serialize();
    });
    await expect(sync.service.runNow()).rejects.toBeInstanceOf(SyncPersistenceError);
    expect(f.writes).toEqual(['task.create']);
    const reopenedDatabase = database(durable), reopened = new CoreStore(reopenedDatabase);
    expect(reopenedDatabase.prepare('SELECT state,payload_json AS payload FROM outbox WHERE entity_id=?').get(task.id)).toMatchObject({ state: 'conflict' });
    expect(JSON.parse((reopenedDatabase.prepare('SELECT payload_json AS payload FROM outbox WHERE entity_id=?').get(task.id) as any).payload).__hcbUncertainCreation).toBe(true);
    await new BrowserGoogleSync(reopened, f.sessions, async () => {}).service.runNow();
    expect(f.writes).toEqual(['task.create']);
  });

  it('syncs granted Calendar access without calling denied Tasks APIs or dropping pending tasks', async () => {
    const f = fixture([calendarScope]);
    f.store.dispatch('settings', 'update', { syncCalendarEventsEnabled: true });
    f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Needs Tasks permission' });
    const status = await new BrowserGoogleSync(f.store, f.sessions, async () => {}).service.runNow();
    expect(status.missingServices).toContain('Tasks');
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('tasks.googleapis.com'))).toBe(false);
    expect(f.fetcher.mock.calls.some(([url]) => String(url).includes('calendarList'))).toBe(true);
    expect(f.store.pendingSyncMutations(100, f.account.accountId)).toHaveLength(1);
  });

  it('blocks a retained other-tab session when the durable account is disconnected', async () => {
    const f = fixture();
    f.store.removeGoogleAccount(f.account.accountId);
    await expect(new BrowserGoogleSync(f.store, f.sessions, async () => {}).service.searchDriveFiles({ accountId: f.account.accountId })).rejects.toThrow(/not connected/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('caps automatic mutation delivery at eight failures and preserves the item for manual review', () => {
    const f = fixture();
    const task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Bounded retry' });
    const mutation = f.store.pendingSyncMutations(100, f.account.accountId)[0];
    for (let attempt = 1; attempt <= 8; attempt++) {
      f.store.deferSyncMutation(mutation.id, 'Google unavailable', true);
      expect(f.db.prepare('SELECT state,attempts FROM outbox WHERE id=?').get(mutation.id)).toEqual({ state: attempt < 8 ? 'pending' : 'conflict', attempts: attempt });
    }
    expect(f.store.pendingSyncMutations(100, f.account.accountId)).toEqual([]);
    expect(f.store.dispatch('tasks', 'get', { id: task.id }).title).toBe('Bounded retry');
    expect((f.db.prepare('SELECT last_error AS message FROM outbox WHERE id=?').get(mutation.id) as any).message).toMatch(/8 failed attempts.*Diagnostics/);
  });

  it('reports missing access without claiming successful sync when no planner service is granted', async () => {
    const f = fixture([driveScope]);
    f.store.dispatch('settings', 'update', { syncCalendarEventsEnabled: true });
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    const status = await sync.service.runNow();
    expect(status).toMatchObject({ state: 'error', lastErrorCode: 'AUTH_SCOPE_REQUIRED', missingServices: ['Tasks', 'Calendar'] });
    expect(status.lastCompletedAt).toBeUndefined();
    expect(sync.status().accounts[0].missingScopes).toEqual([tasksScope, calendarScope]);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([1, 2])('stops series compensation immediately when durable checkpoint %s fails', async failingCheckpoint => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => new Response(null, { status: 204 }));
    let checkpoints = 0;
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {
      if (++checkpoints === failingCheckpoint) throw new Error('No durable save');
    });
    await expect((sync.service as any).compensateGoogleSeriesSplit({
      accountId: f.account.accountId,
      collection: 'https://www.googleapis.com/calendar/v3/calendars/calendar/events',
      originalMaster: { id: 'original', title: 'Series', startsAt: '2027-01-01T09:00:00Z', endsAt: '2027-01-01T10:00:00Z' },
      updatedParent: { id: 'parent', etag: 'parent-etag' },
      createdSuccessor: { id: 'successor', etag: 'successor-etag' },
    })).rejects.toBeInstanceOf(SyncPersistenceError);
    expect(checkpoints).toBe(failingCheckpoint);
    expect(f.fetcher).toHaveBeenCalledTimes(failingCheckpoint - 1);
  });
});

describe('ephemeral Google sessions', () => {
  it.each([204, 205, 304])('handles a bodyless %i even if the transport exposes an empty stream', async status => {
    const f = fixture();
    const response = new Response('');
    Object.defineProperty(response, 'status', { value: status });
    f.fetcher.mockResolvedValueOnce(response);
    const result = await f.sessions.googleFetch(f.account.accountId, 'https://tasks.googleapis.com/tasks/v1/lists/list/tasks/task', { method: 'DELETE' });
    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
  });

  it('expires one account without affecting another or exposing access tokens in metadata', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const sessions = new BrowserGoogleSessions(fetcher);
    sessions.set('a', { accessToken: 'first-secret', expiresAt: Date.now() + 20_000, subject: 'sub-a', scopes: [] });
    sessions.set('b', { accessToken: 'second-secret', expiresAt: Date.now() + 100_000, subject: 'sub-b', scopes: [] });
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(sessions.googleFetch('a', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists')).rejects.toThrow(/expired/);
    await sessions.googleFetch('b', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(sessions.metadata('b'))).not.toContain('secret');
    expect(sessions.has('b', 'wrong-subject')).toBe(false);
  });

  it('does not resend a rejected mutation and invalidates only its account', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const sessions = new BrowserGoogleSessions(fetcher);
    for (const id of ['a', 'b']) sessions.set(id, { accessToken: `${id}-secret`, expiresAt: Date.now() + 100_000, subject: id, scopes: [] });
    expect((await sessions.googleFetch('a', 'https://tasks.googleapis.com/tasks/v1/lists/list/tasks', { method: 'POST' })).status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(sessions.has('a')).toBe(false); expect(sessions.has('b')).toBe(true);
  });

  it('rejects unexpected upload destinations before attaching credentials', async () => {
    const fetcher = vi.fn();
    const sessions = new BrowserGoogleSessions(fetcher);
    sessions.set('a', { accessToken: 'secret', expiresAt: Date.now() + 100_000, subject: 'a', scopes: [] });
    await expect(sessions.googleFetch('a', 'https://attacker.example/upload')).rejects.toThrow(/unexpected destination/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('aborts a hung request instead of holding the workspace writer lock forever', async () => {
    vi.useFakeTimers();
    const sessions = new BrowserGoogleSessions(vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    sessions.set('a', { accessToken: 'secret', expiresAt: Date.now() + 100_000, subject: 'a', scopes: [] });
    const response = sessions.googleFetch('a', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    const rejected = expect(response).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
  });

  it('keeps the request deadline active while a response body is stalled', async () => {
    vi.useFakeTimers();
    const sessions = new BrowserGoogleSessions(vi.fn(async (_url, init) => new Response(new ReadableStream({
      start(stream) { init?.signal?.addEventListener('abort', () => stream.error(init.signal!.reason), { once: true }); },
    }))));
    sessions.set('a', { accessToken: 'secret', expiresAt: Date.now() + 100_000, subject: 'a', scopes: [] });
    const response = await sessions.googleFetch('a', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists');
    const rejected = expect(response.json()).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
  });
});

describe('Drive upload durable identity', () => {
  it('uses the acknowledged byte range and bounds stalled upload retries', async () => {
    const f = fixture();
    const sync = new BrowserGoogleSync(f.store, f.sessions, async () => {});
    const responses = [
      new Response(null, { status: 308, headers: { range: 'bytes=0-1' } }),
      Response.json({ id: 'uploaded' }),
    ];
    const ranges: string[] = [];
    (sync.service as any).googleResponse = async (_account: string, _url: string, init: RequestInit) => {
      ranges.push(new Headers(init.headers).get('content-range')!);
      return responses.shift();
    };
    const source = { name: 'brief.txt', size: 5, read: async (offset: number, length: number) => new TextEncoder().encode('hello').slice(offset, offset + length) };
    await expect((sync.service as any).finishResumableDriveUpload(f.account.accountId, 'https://www.googleapis.com/upload', source, 5, 'text/plain')).resolves.toEqual({ id: 'uploaded' });
    expect(ranges).toEqual(['bytes 0-4/5', 'bytes 2-4/5']);
    let attempts = 0;
    (sync.service as any).googleResponse = async () => { attempts++; return new Response(null, { status: 308 }); };
    await expect((sync.service as any).finishResumableDriveUpload(f.account.accountId, 'https://www.googleapis.com/upload', source, 5, 'text/plain')).rejects.toThrow(/not accepting upload data/);
    expect(attempts).toBe(3);
  });

  it.each(['folder', 'file'])('reconciles an accepted %s after receipt persistence fails without creating duplicates', async failurePoint => {
    const f = fixture();
    const remote = new Map<string, any>();
    let reserved = 0, folderPosts = 0, filePosts = 0, uploads = 0;
    let lastCreated = '';
    let uploadId = '';
    let durable = f.db.serialize();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/files/generateIds')) return Response.json({ ids: [`reserved-${++reserved}`] });
      if (url.pathname === '/drive/v3/files' && !init?.method) return Response.json({ files: [] });
      if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(database(durable).prepare("SELECT value FROM sync_meta WHERE key LIKE 'google-operation:%:drive-folder'").get()).toMatchObject({ value: expect.stringContaining(body.id) });
        folderPosts++; lastCreated = 'folder';
        remote.set(body.id, { ...body, trashed: false });
        return Response.json({ id: body.id });
      }
      if (url.pathname === '/upload/drive/v3/files' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(database(durable).prepare("SELECT value FROM sync_meta WHERE key LIKE 'google-operation:%:drive-upload:%'").get()).toMatchObject({ value: expect.stringContaining(body.id) });
        uploadId = body.id; filePosts++;
        return new Response(null, { headers: { location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${uploadId}` } });
      }
      if (url.pathname === '/upload/drive/v3/files' && init?.method === 'PUT') {
        expect(new Headers(init.headers).has('content-length')).toBe(false);
        expect(new Headers(init.headers).get('content-range')).toBe('bytes 0-4/5');
        uploads++; lastCreated = 'file';
        const file = { id: uploadId, name: 'brief.txt', mimeType: 'text/plain', size: '5', trashed: false, webViewLink: `https://drive.google.com/file/d/${uploadId}/view` };
        remote.set(uploadId, file);
        return Response.json(file);
      }
      const record = remote.get(decodeURIComponent(url.pathname.split('/').at(-1)!));
      return record ? Response.json(record) : new Response(null, { status: 404 });
    });
    const sessions = new BrowserGoogleSessions(fetcher);
    sessions.set(f.account.accountId, { accessToken: 'upload-secret', expiresAt: Date.now() + 3_600_000, subject: 'verified-subject', scopes: [driveScope] });
    const source = { name: 'brief.txt', size: 5, type: 'text/plain', read: async (offset: number, length: number) => new TextEncoder().encode('hello').slice(offset, offset + length) };
    const first = new BrowserGoogleSync(f.store, sessions, async checkpoint => {
      if (checkpoint.stage === 'upload-receipt' && lastCreated === failurePoint) throw new Error('Receipt persistence failed');
      durable = f.db.serialize();
    });
    await expect(first.service.uploadDriveSource({ accountId: f.account.accountId, source })).rejects.toBeInstanceOf(SyncPersistenceError);
    const reopenedDb = database(durable), reopened = new CoreStore(reopenedDb);
    const second = new BrowserGoogleSync(reopened, sessions, async () => { durable = reopenedDb.serialize(); });
    await expect(second.service.uploadDriveSource({ accountId: f.account.accountId, source })).resolves.toMatchObject({ fileId: 'reserved-2', title: 'brief.txt' });
    expect(folderPosts).toBe(1); expect(filePosts).toBe(1); expect(uploads).toBe(1); expect(reserved).toBe(2);
    // Re-selecting the same content reuses its exact remote receipt.
    await second.service.uploadDriveSource({ accountId: f.account.accountId, source });
    expect(filePosts).toBe(1); expect(uploads).toBe(1);
    // OAuth disconnect/reset must not delete these duplicate-prevention records.
    reopened.resetGoogleSyncTokens(f.account.accountId);
    expect(reopened.googleOperationRecord(f.account.accountId, 'drive-folder')).toMatchObject({ fileId: 'reserved-1' });
    expect(durable.includes(Buffer.from('upload-secret'))).toBe(false);
  });
});
