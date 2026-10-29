import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreStore } from '@shared/core/CoreStore';
import { GoogleSyncService } from '@shared/google/GoogleSyncService';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); });
function fixture() {
  const db = new Database(':memory:'); databases.push(db);
  const store = new CoreStore(db);
  const account = store.upsertGoogleAccount({ googleAccountId: 'subject', connectionState: 'connected' });
  const list = store.upsertGoogleTaskList({ id: 'list', title: 'Tasks' }, account.accountId);
  const calendar = store.upsertGoogleCalendar({ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }, account.accountId);
  const event = () => store.dispatch('calendar', 'create', { calendarId: calendar.id, title: 'Original', startsAt: '2026-10-29T08:00:00Z', endsAt: '2026-10-29T09:00:00Z' });
  return { db, store, account, list, calendar, event };
}

describe('Google receipts after concurrent local commands', () => {
  it('preserves newer recurrence and attachments while binding an accepted event', () => {
    const f = fixture(), event = f.event(), sent = f.store.googleEventForSync(event.id)!;
    f.store.dispatch('calendar', 'update', { id: event.id, title: 'Newer', recurrenceLines: ['RRULE:FREQ=DAILY;COUNT=3'], attachments: [{ fileId: 'new-file', fileUrl: 'https://drive.google.com/open?id=new-file', title: 'New file' }] });
    f.store.bindGoogleEvent(event.id, { id: 'remote', etag: 'v2', recurrence: [], attachments: [] }, sent);
    expect(f.store.googleEventForSync(event.id)).toMatchObject({ title: 'Newer', googleId: 'remote', googleEtag: 'v2', recurrenceLines: ['RRULE:FREQ=DAILY;COUNT=3'], attachments: [{ fileId: 'new-file' }] });
    expect(f.store.pendingSyncMutations()).toHaveLength(2);
  });

  it('binds a late creation receipt to the queued delete without resurrecting its event', () => {
    const f = fixture(), event = f.event(), sent = f.store.googleEventForSync(event.id)!;
    f.store.dispatch('calendar', 'delete', { id: event.id });
    f.store.bindGoogleEvent(event.id, { id: 'accepted', etag: 'v2' }, sent);
    expect(f.store.googleEventForSync(event.id)).toBeNull();
    expect(f.store.pendingSyncMutations().find(item => item.kind === 'event.delete')?.payload).toMatchObject({ googleId: 'accepted', googleEtag: 'v2', calendarGoogleId: 'calendar' });
    expect(f.store.upsertGoogleEvent({ id: 'accepted' }, f.calendar.id)).toBeNull();
  });

  it('turns a move during creation into an ordered remote move', () => {
    const f = fixture(), event = f.event(), sent = f.store.googleEventForSync(event.id)!;
    const mutation = f.store.pendingSyncMutations()[0];
    const destination = f.store.upsertGoogleCalendar({ id: 'destination', summary: 'Next', accessRole: 'owner' }, f.account.accountId);
    f.store.dispatch('calendar', 'update', { id: event.id, calendarId: destination.id });
    f.store.bindGoogleEvent(event.id, { id: 'accepted', etag: 'v2' }, sent, mutation.id);
    expect(f.store.pendingSyncMutations()[1]).toMatchObject({ kind: 'event.move', payload: { sourceCalendarId: f.calendar.id, destinationCalendarId: destination.id } });
    expect(f.store.googleEventForSync(event.id)?.calendarId).toBe(destination.id);
  });

  it('keeps the actual remote task location when the local destination changes during creation', () => {
    const f = fixture(), task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Task' });
    const sent = f.store.googleTaskForSync(task.id)!;
    const next = f.store.upsertGoogleTaskList({ id: 'next-list', title: 'Next' }, f.account.accountId);
    f.store.dispatch('tasks', 'update', { id: task.id, listId: next.id, title: 'Newer' });
    f.store.bindGoogleTask(task.id, { id: 'accepted', etag: 'v2', position: '1' }, sent);
    expect(f.store.googleTaskForSync(task.id)).toMatchObject({ title: 'Newer', googleId: 'accepted', googleListId: 'list', listGoogleId: 'next-list' });
  });

  it('retains a late task-list identity on its deletion tombstone', () => {
    const f = fixture(), list = f.store.dispatch('tasks', 'createTaskList', { accountId: f.account.accountId, title: 'Temporary' });
    const sent = f.store.googleTaskListForSync(list.id)!;
    f.store.dispatch('tasks', 'deleteTaskList', { id: list.id });
    f.store.bindGoogleTaskList(list.id, { id: 'accepted-list', etag: 'v2' }, sent);
    expect(f.store.pendingSyncMutations().find(item => item.kind === 'taskList.delete')?.payload).toMatchObject({ googleId: 'accepted-list', googleEtag: 'v2' });
    expect(f.store.googleDeletionPending('taskList', f.account.accountId, 'accepted-list')).toBe(true);
  });

  it('delivers the refreshed delete receipt even when deletion was queued in the original batch', async () => {
    const f = fixture(), event = f.event();
    f.store.bindGoogleEvent(event.id, { id: 'remote', etag: 'v1' });
    f.store.completeSyncMutation(f.store.pendingSyncMutations()[0].id);
    f.store.dispatch('calendar', 'update', { id: event.id, title: 'Updated' });
    const calls: string[] = [];
    const service = new GoogleSyncService(f.store, { onConnectionChange: () => () => {}, googleFetch: async (inputAccount, input, init) => {
      expect(inputAccount).toBe(f.account.accountId);
      const url = new URL(input);
      if (init?.method === 'PATCH') {
        f.store.dispatch('calendar', 'delete', { id: event.id });
        calls.push('PATCH');
        return Response.json({ id: 'remote', etag: 'v2' });
      }
      if (init?.method === 'DELETE') { calls.push(`DELETE ${new Headers(init.headers).get('if-match')}`); return new Response(null, { status: 204 }); }
      if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] });
      if (url.pathname.endsWith('/events')) return Response.json({ items: [], nextSyncToken: 'token' });
      return Response.json({ items: [{ id: 'list', title: 'Tasks' }] });
    } }, { automaticConnectionSync: false });
    f.store.dispatch('settings', 'update', { syncTasksEnabled: false });
    await service.runNow(); await service.runNow();
    expect(calls).toEqual(['PATCH', 'DELETE v2']);
    expect(f.store.googleEventForSync(event.id)).toBeNull();
    expect(f.store.pendingSyncMutations()).toHaveLength(0);
  });

  it('does not recover an active create on another worker snapshot, but recovers an abandoned intent', () => {
    const f = fixture(), task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'In flight' });
    f.store.beginSyncCreation(f.store.pendingSyncMutations()[0].id);
    const db = new Database(f.db.serialize()); databases.push(db);
    const live = new CoreStore(db, { platform: 'web', deferSyncRecovery: true });
    expect(db.prepare('SELECT state,creation_started FROM outbox WHERE entity_id=?').get(task.id)).toEqual({ state: 'pending', creation_started: 1 });
    live.recoverInterruptedSyncCreations();
    expect(db.prepare('SELECT state,creation_started FROM outbox WHERE entity_id=?').get(task.id)).toEqual({ state: 'conflict', creation_started: 0 });
  });
});
