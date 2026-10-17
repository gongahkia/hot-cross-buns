import { emptyDocument, normalizeDocument, validateDocument, type TodoDocument } from './todoText';

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; revision: number };
export type ScratchpadState = { text: string; revision: number };
export type ScratchpadDestination = { kind: 'dated'; date: string } | { kind: 'undated'; list: string };
export type ScratchpadUndo = { before: TodoState; scratchBefore: ScratchpadState; journalRevision: number; scratchRevision: number };
export const emptyState = (): TodoState => ({ document: emptyDocument(), baseline: null, revision: 0 });
const emptyScratchpad = (): ScratchpadState => ({ text: '', revision: 0 });
const DB_NAME = 'shio-pan-v1';
const STATE_STORE = 'state';
const SCRATCH_STORE = 'scratchpad';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('shio-pan-data-v1');

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STATE_STORE);
      request.result.createObjectStore(SCRATCH_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(stores: string[], work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    let result: T;
    let error: unknown = null;
    tx.oncomplete = () => { db.close(); if (error) reject(error); else resolve(result); };
    tx.onabort = () => { db.close(); reject(error ?? tx.error ?? new Error('Storage transaction aborted.')); };
    try { work(tx, value => { result = value; }, cause => { error = cause; tx.abort(); }); }
    catch (cause) { error = cause; tx.abort(); }
  }));
}

const stateFrom = (value: TodoState | undefined): TodoState => value
  ? { document: normalizeDocument(value.document), baseline: value.baseline ? normalizeDocument(value.baseline) : null, revision: value.revision ?? 0 }
  : emptyState();
const announce = (kind: 'journal' | 'scratchpad') => channel?.postMessage({ kind });
export function subscribeStore(kind: 'journal' | 'scratchpad', callback: () => void): () => void {
  if (!channel) return () => undefined;
  const listener = (event: MessageEvent<{ kind?: string }>) => { if (event.data?.kind === kind) callback(); };
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
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
