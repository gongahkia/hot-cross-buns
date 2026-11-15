import { newSyncLedger, type SyncBundle, type SyncLink, type SyncProvider } from './journalSync';
import { emptyDocument, normalizeDocument, serializeTodoText, validateDocument, type TodoDocument } from './todoText';

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; revision: number };
export type ScratchpadState = { text: string; revision: number };
export type ScratchpadDestination = { kind: 'dated'; date: string } | { kind: 'undated'; list: string };
export type ScratchpadUndo = { before: TodoState; scratchBefore: ScratchpadState; journalRevision: number; scratchRevision: number };
export const emptyState = (): TodoState => ({ document: emptyDocument(), baseline: null, revision: 0 });
const emptyScratchpad = (): ScratchpadState => ({ text: '', revision: 0 });
const DB_NAME = 'hot-cross-buns-v1';
const STATE_STORE = 'state';
const SCRATCH_STORE = 'scratchpad';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hot-cross-buns-data-v1');

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      for (const name of [STATE_STORE, SCRATCH_STORE]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onblocked = () => { timer = setTimeout(() => { settled = true; reject(new Error('Finish or export unsaved edits in older Hot Cross Buns tabs, then close them and reload to finish the sync storage upgrade.')); }, 3000); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      settled = true; resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timer); settled = true; reject(request.error); };
  });
}

function transact<T>(stores: string[], work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let result: T;
    let error: unknown = null;
    tx.oncomplete = () => { db.close(); if (error) reject(error); else resolve(result); };
    tx.onabort = () => { db.close(); reject(error ?? tx.error ?? new Error('Storage transaction aborted.')); };
    const fail = (cause: unknown) => {
      error ??= cause;
      try { tx.abort(); }
      catch (abortError) {
        // a browser-initiated abort rejects pending requests before onabort fires.
        if (!(abortError instanceof DOMException && abortError.name === 'InvalidStateError')) throw abortError;
      }
    };
    try { work(tx, value => { result = value; }, fail); }
    catch (cause) { fail(cause); }
  }));
}

const stateFrom = (value: TodoState | undefined): TodoState => value
  ? { document: normalizeDocument(value.document), baseline: value.baseline ? normalizeDocument(value.baseline) : null, revision: value.revision ?? 0 }
  : emptyState();
const localNotifications = new EventTarget();
const announce = (kind: 'journal' | 'scratchpad' | 'sync', self = false) => { channel?.postMessage({ kind }); if (self || kind === 'sync') localNotifications.dispatchEvent(new Event(kind)); };
export function subscribeStore(kind: 'journal' | 'scratchpad' | 'sync', callback: () => void): () => void {
  const listener = (event: MessageEvent<{ kind?: string }>) => { if (event.data?.kind === kind) callback(); };
  channel?.addEventListener('message', listener);
  localNotifications.addEventListener(kind, callback);
  return () => { channel?.removeEventListener('message', listener); localNotifications.removeEventListener(kind, callback); };
}

async function read<T>(storeName: string, fallback: T): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get('current');
      request.onsuccess = () => resolve(request.result ?? fallback);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function loadTodoState(): Promise<TodoState> { return stateFrom(await read<TodoState | undefined>(STATE_STORE, undefined)); }
export async function loadScratchpadState(): Promise<ScratchpadState> { return read(SCRATCH_STORE, emptyScratchpad()); }

/** Reading and writing in one transaction serializes writes from all app windows. */
export async function mutateTodoState(change: (latest: TodoState) => TodoState | null): Promise<TodoState | null> {
  const result = await transact<TodoState | null>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE);
    const request = store.get('current');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        const latest = stateFrom(request.result);
        const changed = change(latest);
        if (!changed) { done(null); return; }
        validateDocument(changed.document);
        const next = { ...changed, revision: latest.revision + 1 };
        store.put(next, 'current');
        done(next);
      } catch (error) { fail(error); }
    };
  });
  if (result) announce('journal');
  return result;
}

export async function saveScratchpadText(expectedRevision: number, text: string): Promise<ScratchpadState> {
  const result = await transact<ScratchpadState>([SCRATCH_STORE], (tx, done, fail) => {
    const store = tx.objectStore(SCRATCH_STORE);
    const request = store.get('current');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const latest: ScratchpadState = request.result ?? emptyScratchpad();
      if (latest.revision !== expectedRevision) { fail(new Error('Scratchpad changed in another window. Reload it before editing.')); return; }
      const next = { text, revision: latest.revision + 1 };
      store.put(next, 'current');
      done(next);
    };
  });
  announce('scratchpad');
  return result;
}

export async function convertScratchpadSelection(args: { start: number; end: number; selected: string; scratchRevision: number; destination: ScratchpadDestination; items: Array<{ title: string; details: string[] }>; cut: boolean }): Promise<{ journal: TodoState; scratchpad: ScratchpadState; undo: ScratchpadUndo }> {
  const result = await transact<{ journal: TodoState; scratchpad: ScratchpadState; undo: ScratchpadUndo }>([STATE_STORE, SCRATCH_STORE], (tx, done, fail) => {
    const stateStore = tx.objectStore(STATE_STORE);
    const scratchStore = tx.objectStore(SCRATCH_STORE);
    const journalRequest = stateStore.get('current');
    const scratchRequest = scratchStore.get('current');
    let journal: TodoState | null = null;
    let scratchpad: ScratchpadState | null = null;
    const apply = () => {
      if (!journal || !scratchpad) return;
      try {
        if (scratchpad.revision !== args.scratchRevision || scratchpad.text.slice(args.start, args.end) !== args.selected) throw new Error('The scratchpad changed. Select the text again.');
        const nextDocument = structuredClone(journal.document);
        const newItems = args.items.map(({ title, details }) => ({ id: crypto.randomUUID(), text: title, completed: false, details: details.map(text => ({ text, completed: false })) }));
        if (args.destination.kind === 'dated') {
          const date = args.destination.date;
          let day = nextDocument.days.find(day => day.date === date);
          if (!day) { day = { date, items: [] }; nextDocument.days.push(day); nextDocument.days.sort((a,b) => a.date.localeCompare(b.date)); }
          day.items.push(...newItems);
        } else {
          const name = args.destination.list;
          let list = nextDocument.undated?.find(list => list.name === name);
          if (!list) { list = { name, items: [] }; (nextDocument.undated ??= []).push(list); }
          list.items.push(...newItems);
        }
        validateDocument(nextDocument);
        const nextJournal = { ...journal, document: nextDocument, revision: journal.revision + 1 };
        const nextScratch = args.cut ? { text: scratchpad.text.slice(0, args.start) + scratchpad.text.slice(args.end), revision: scratchpad.revision + 1 } : scratchpad;
        stateStore.put(nextJournal, 'current');
        if (args.cut) scratchStore.put(nextScratch, 'current');
        done({ journal: nextJournal, scratchpad: nextScratch, undo: { before: journal, scratchBefore: scratchpad, journalRevision: nextJournal.revision, scratchRevision: nextScratch.revision } });
      } catch (error) { fail(error); }
    };
    journalRequest.onsuccess = () => { journal = stateFrom(journalRequest.result); apply(); };
    scratchRequest.onsuccess = () => { scratchpad = scratchRequest.result ?? emptyScratchpad(); apply(); };
    journalRequest.onerror = () => fail(journalRequest.error);
    scratchRequest.onerror = () => fail(scratchRequest.error);
  });
  announce('journal');
  if (args.cut) announce('scratchpad');
  return result;
}

export async function undoScratchpadConversion(undo: ScratchpadUndo): Promise<{ journal: TodoState; scratchpad: ScratchpadState }> {
  const result = await transact<{ journal: TodoState; scratchpad: ScratchpadState }>([STATE_STORE, SCRATCH_STORE], (tx, done, fail) => {
    const journalStore = tx.objectStore(STATE_STORE);
    const scratchStore = tx.objectStore(SCRATCH_STORE);
    const journalRequest = journalStore.get('current');
    const scratchRequest = scratchStore.get('current');
    let journal: TodoState | null = null;
    let scratchpad: ScratchpadState | null = null;
    const apply = () => {
      if (!journal || !scratchpad) return;
      if (journal.revision !== undo.journalRevision || scratchpad.revision !== undo.scratchRevision) { fail(new Error('New edits were made. Undo is no longer available.')); return; }
      const nextJournal = { ...undo.before, revision: journal.revision + 1 };
      const nextScratch = { ...undo.scratchBefore, revision: scratchpad.revision + 1 };
      journalStore.put(nextJournal, 'current');
      scratchStore.put(nextScratch, 'current');
      done({ journal: nextJournal, scratchpad: nextScratch });
    };
    journalRequest.onsuccess = () => { journal = stateFrom(journalRequest.result); apply(); };
    scratchRequest.onsuccess = () => { scratchpad = scratchRequest.result ?? emptyScratchpad(); apply(); };
    journalRequest.onerror = () => fail(journalRequest.error);
    scratchRequest.onerror = () => fail(scratchRequest.error);
  });
  announce('journal'); announce('scratchpad');
  return result;
}

// a separate key preserves the linked file's baseline when manual imports or downloads change theirs.
export async function loadFileLink(): Promise<import('./linkedFile').FileLink | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get('linked-file');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function storeFileLink(link: import('./linkedFile').FileLink | null): Promise<void> { await storeLinkedTarget('file', link); }

export async function loadDriveLink(): Promise<import('./googleDrive').DriveLink | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get('google-drive-link');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function storeDriveLink(link: import('./googleDrive').DriveLink | null): Promise<void> { await storeLinkedTarget('drive', link); }

async function storeLinkedTarget(provider: SyncProvider, link: SyncLink | null): Promise<void> {
  await transact<void>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE), key = provider + '-sync-ledger', request = store.get(key);
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        if (link) {
          store.put(link, linkKey(provider)); store.put(newSyncLedger(link.id, request.result), key);
          if (provider === 'drive') store.delete('sync-file-creation');
        } else { store.delete(linkKey(provider)); store.delete(key); }
        done();
      } catch (error) { fail(error); }
    };
  });
  announce('sync');
}

const linkKey = (provider: SyncProvider) => provider === 'file' ? 'linked-file' : 'google-drive-link';
export async function readSyncBundle<L extends SyncLink>(provider: SyncProvider): Promise<SyncBundle<L> | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const store = db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE), request = store.get(linkKey(provider));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result as L | undefined;
        if (!record) { resolve(null); return; }
        const journal = store.get('current'), ledger = store.get(provider + '-sync-ledger');
        let remaining = 2;
        const finish = () => {
          if (--remaining) return;
          try {
            const saved = stateFrom(journal.result);
            resolve({ link: record, document: saved.document, revision: saved.revision, ledger: ledger.result?.linkId === record.id ? ledger.result : { ...newSyncLedger(record.id), generation: 'legacy:' + record.id } });
          } catch (error) { reject(error); }
        };
        for (const entry of [journal, ledger]) { entry.onsuccess = finish; entry.onerror = () => reject(entry.error); }
      };
    });
  } finally { db.close(); }
}
export async function changeSyncBundle<L extends SyncLink>(provider: SyncProvider, work: (current: SyncBundle<L>, canIntegrate: boolean) => SyncBundle<L> | null, integrate = false): Promise<SyncBundle<L> | null> {
  const commit = async (canIntegrate: boolean) => {
    let journalChanged = false, metadataChanged = false;
    const result = await transact<SyncBundle<L> | null>([STATE_STORE], (tx, done, fail) => {
      const store = tx.objectStore(STATE_STORE);
      const link = store.get(linkKey(provider)), journal = store.get('current'), ledger = store.get(provider + '-sync-ledger');
      let remaining = 3;
      const finish = () => {
        if (--remaining) return;
        const record = link.result as L | undefined;
        if (!record) { done(null); return; }
        try {
          const saved = stateFrom(journal.result);
          const current: SyncBundle<L> = { link: record, document: saved.document, revision: saved.revision, ledger: ledger.result?.linkId === record.id ? ledger.result : { ...newSyncLedger(record.id), generation: 'legacy:' + record.id } };
          const next = work(current, canIntegrate);
          if (!next) { done(null); return; }
          journalChanged = next.document !== current.document && JSON.stringify(next.document) !== JSON.stringify(current.document);
          if (journalChanged) { validateDocument(next.document); next.revision = saved.revision + 1; store.put({ ...saved, document: next.document, revision: next.revision }, 'current'); }
          if (next !== current || ledger.result?.linkId !== record.id) { metadataChanged = true; store.put(next.link, linkKey(provider)); store.put(next.ledger, provider + '-sync-ledger'); }
          done(next);
        } catch (error) { fail(error); }
      };
      for (const request of [link, journal, ledger]) { request.onsuccess = finish; request.onerror = () => fail(request.error); }
    });
    if (journalChanged) announce('journal', true);
    if (metadataChanged || journalChanged) announce('sync');
    return result;
  };
  return navigator.locks.request('hot-cross-buns-linked-file', () => integrate
    ? navigator.locks.request('hot-cross-buns-journal-editor', { ifAvailable: true }, lock => commit(!!lock))
    : commit(false));
}

export type SyncCreation = { id: string; accountId: string; email: string; createdAt: number; text: string; document: TodoDocument; uncertain: boolean };
export async function loadSyncCreation(): Promise<SyncCreation | null> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => { const request = db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get('sync-file-creation'); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function storeSyncCreation(expectedId: string | null, next: SyncCreation | null): Promise<boolean> {
  const result = await transact<boolean>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE), request = store.get('sync-file-creation');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        if ((request.result?.id ?? null) !== expectedId) { done(false); return; }
        if (next) store.put(next, 'sync-file-creation'); else store.delete('sync-file-creation');
        done(true);
      } catch (error) { fail(error); }
    };
  });
  announce('sync'); return result;
}

export type ReviewedJournal = { document: TodoDocument; baseline: TodoDocument; expectedText: string; generation?: string };
/** The reviewed journal, target and baseline either commit together or all remain unchanged. */
export async function commitReviewedLink<L extends SyncLink>(provider: SyncProvider, link: L, expectedId: string | null, review: ReviewedJournal): Promise<TodoState> {
  const result = await transact<TodoState>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE);
    const target = store.get(linkKey(provider)), other = store.get(linkKey(provider === 'file' ? 'drive' : 'file')), journal = store.get('current'), ledger = store.get(provider + '-sync-ledger');
    let remaining = 4;
    const finish = () => {
      if (--remaining) return;
      try {
        if (other.result || (target.result?.id ?? null) !== expectedId || review.generation && (ledger.result?.generation ?? 'legacy:' + target.result?.id) !== review.generation) throw new Error('The file link changed in another window. Cancel and review it again.');
        const latest = stateFrom(journal.result);
        if (serializeTodoText(latest.document) !== review.expectedText) throw new Error('The journal changed while this review was open. Cancel and review the linked file again.');
        validateDocument(review.document);
        const next = { ...latest, document: review.document, baseline: review.baseline, revision: latest.revision + 1 };
        store.put(next, 'current'); store.put(link, linkKey(provider)); store.put(newSyncLedger(link.id, ledger.result), provider + '-sync-ledger');
        if (provider === 'drive') store.delete('sync-file-creation');
        done(next);
      } catch (error) { fail(error); }
    };
    for (const request of [target, other, journal, ledger]) { request.onsuccess = finish; request.onerror = () => fail(request.error); }
  });
  announce('journal'); announce('sync'); return result;
}
