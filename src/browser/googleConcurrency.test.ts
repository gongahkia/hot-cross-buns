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

  it('delivers a delete queued during PATCH with the receipt’s newest ETag', async () => {
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

  it('keeps a cleanup receipt when an in-flight task is moved into a list that is deleted', () => {
    const f = fixture(), task = f.store.dispatch('tasks', 'create', { listId: f.list.id, title: 'Task' });
    const sent = f.store.googleTaskForSync(task.id)!;
    const next = f.store.upsertGoogleTaskList({ id: 'destination', title: 'Destination' }, f.account.accountId);
    f.store.dispatch('tasks', 'update', { id: task.id, listId: next.id });
    f.store.dispatch('tasks', 'deleteTaskList', { id: next.id });
    f.store.bindGoogleTask(task.id, { id: 'accepted', etag: 'v2' }, sent);
    expect(f.store.googleTaskForSync(task.id)).toBeNull();
    expect(f.store.pendingSyncMutations().find(item => item.kind === 'task.delete')?.payload).toMatchObject({ googleId: 'accepted', googleListId: 'list' });
  });

  it('recovers a lost restoration receipt with its reserved ID without creating a second local row', () => {
    const f = fixture(), event = f.event();
    f.store.completeGoogleEventDeletion(f.account.accountId, event.id, 'previous');
    const restoredId = f.store.googleEventCreationId(f.account.accountId, event.id);
    const remote = { id: restoredId, etag: 'restored', extendedProperties: { private: { hcbLocalEventId: event.id } } };
    expect(f.store.upsertGoogleEvent(remote, f.calendar.id)).toBeNull(); // pending local command still wins
    expect(f.store.googleEventForSync(event.id)?.googleId).toBe(restoredId);
    expect(f.db.prepare('SELECT count(*) AS total FROM events').get()).toEqual({ total: 1 });
  });

  it('recovers a lost creation response after a local calendar move without duplicating the event', () => {
    const f = fixture(), event = f.event();
    const next = f.store.upsertGoogleCalendar({ id: 'destination', summary: 'Next', accessRole: 'owner' }, f.account.accountId);
    f.store.dispatch('calendar', 'update', { id: event.id, calendarId: next.id });
    const id = f.store.googleEventCreationId(f.account.accountId, event.id);
    f.store.upsertGoogleEvent({ id, etag: 'accepted', extendedProperties: { private: { hcbLocalEventId: event.id } } }, f.calendar.id);
    expect(f.store.googleEventForSync(event.id)).toMatchObject({ googleId: id, calendarId: next.id });
    expect(f.store.pendingSyncMutations()[1]).toMatchObject({ kind: 'event.move', payload: { sourceCalendarId: f.calendar.id, destinationCalendarId: next.id } });
    expect(f.db.prepare('SELECT count(*) AS total FROM events').get()).toEqual({ total: 1 });
  });

  for (const fails of [false, true]) it(`preserves concurrent edits during a series split even when its HTTP response ${fails ? 'fails' : 'succeeds'}`, async () => {
    const f = fixture();
    const master = { id: 'series', etag: 'v1', iCalUID: 'series-uid', summary: 'Series', recurrence: ['RRULE:FREQ=DAILY;COUNT=5'], start: { dateTime: '2026-10-29T08:00:00Z' }, end: { dateTime: '2026-10-29T09:00:00Z' } };
    const original = f.store.upsertGoogleEvent(master, f.calendar.id)!;
    const successor = f.store.dispatch('calendar', 'update', { id: original.id, scope: 'following', originalStartAt: '2026-10-30T08:00:00Z', title: 'Split', startsAt: '2026-10-30T08:00:00Z', endsAt: '2026-10-30T09:00:00Z' });
    f.store.dispatch('settings', 'update', { syncTasksEnabled: false });
    let writes = 0;
    const service = new GoogleSyncService(f.store, { onConnectionChange: () => () => {}, googleFetch: async (_account, input, init) => {
      const url = new URL(input);
      if (init?.method === 'PATCH') {
        writes++;
        f.store.dispatch('calendar', 'update', { id: successor.id, title: 'Latest edit during split' });
        if (fails) throw new Error('Response lost');
        return Response.json({ ...master, etag: 'v2' });
      }
      if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] });
      if (url.pathname.endsWith('/series')) return Response.json(master);
      if (url.pathname.endsWith('/events')) return Response.json({ items: [master], nextSyncToken: 'token' });
      throw new Error(`Unexpected ${url}`);
    } }, { automaticConnectionSync: false, checkpoint: async () => {} });
    await service.runNow();
    expect(writes).toBe(1); // no compensating write may erase the newer command
    expect(f.store.googleEventForSync(successor.id)?.title).toBe('Latest edit during split');
    expect(f.db.prepare("SELECT state,last_error AS error FROM outbox WHERE kind='event.splitSeries'").get()).toMatchObject({ state: 'conflict', error: expect.stringContaining('Local changes arrived') });
  });


  it('recovers an accepted but unacknowledged Calendar create onto its queued deletion after a local move', () => {
    const f = fixture(), event = f.event();
    const next = f.store.upsertGoogleCalendar({ id: 'destination', summary: 'Next', accessRole: 'owner' }, f.account.accountId);
    f.store.dispatch('calendar', 'update', { id: event.id, calendarId: next.id });
    f.store.dispatch('calendar', 'delete', { id: event.id });
    const id = f.store.googleEventCreationId(f.account.accountId, event.id);
    f.store.upsertGoogleEvent({ id, etag: 'accepted', extendedProperties: { private: { hcbLocalEventId: event.id } } }, f.calendar.id);
    expect(f.store.googleEventForSync(event.id)).toBeNull();
    expect(f.store.pendingSyncMutations().find(item => item.kind === 'event.delete')?.payload).toMatchObject({ googleId: id, googleEtag: 'accepted', calendarGoogleId: 'calendar' });
  });

});
