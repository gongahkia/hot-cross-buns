import { materializeJournalAsync, readJournalAsync } from './journalBackground.ts';
import { createJournal, serializeJournal, validateJournal, materializeJournal, readJournal, journalFromModel } from './journalDocument.ts';
import { newSyncLedger, type SyncBundle, type SyncLink, type SyncProvider } from './journalSync';
import { reviewedRevision } from './revisionSync';
import { normalizeDocument, type TodoDocument } from './todoText';
import { finishMarkdownMeasurement, startMarkdownMeasurement } from './markdownMeasurements';

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; revision: number; scratchRevision?: number };
export type ScratchpadState = { text: string; revision: number };
export type ScratchpadDestination = { kind: 'dated'; date: string } | { kind: 'undated'; list: string };
export type ScratchpadUndo = { before: TodoState; scratchBefore: ScratchpadState; journalRevision: number; scratchRevision: number };
export const emptyState = (): TodoState => ({ document: createJournal(), baseline: null, revision: 0 });
const DB_NAME = 'hot-cross-buns-v1';
const STATE_STORE = 'state';
const SCRATCH_STORE = 'scratchpad';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('hot-cross-buns-data-v1');

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = event => {
      for (const name of [STATE_STORE, SCRATCH_STORE]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      if (event.oldVersion > 0 && event.oldVersion < 4) for (const name of [STATE_STORE, SCRATCH_STORE]) {
        const store = request.transaction!.objectStore(name), cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (!String(entry.key).startsWith('legacy-txt:')) { store.put(entry.value, 'legacy-txt:' + entry.key); entry.delete(); }
          entry.continue();
        };
      }
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

const stateFrom = (value: TodoState | undefined): TodoState => {
  if (!value) return emptyState();
  if (value.document.source === undefined) throw new Error('This workspace needs the explicit Markdown transition. Export its recovery copy before continuing.');
  const document = readJournal(value.document.source).document;
  validateJournal(document);
  if (value.baseline && value.baseline.source === undefined) throw new Error('The saved baseline has no Markdown source. Keep the browser data for recovery.');
  const baseline = value.baseline ? readJournal(value.baseline.source!).document : null;
  return { document, baseline, revision: value.revision ?? 0, scratchRevision: value.scratchRevision ?? 0 };
};
const canonicalState = (next: TodoState, previous: TodoState): TodoState => {
  const document = materializeJournal(next.document);
  const baseline = next.baseline ? materializeJournal(next.baseline) : null;
  return { ...next, document, baseline, revision: previous.revision + 1,
    scratchRevision: (previous.scratchRevision ?? 0) + Number(document.scratchpad !== previous.document.scratchpad) };
};
const localNotifications = new EventTarget();
const announce = (kind: 'journal' | 'scratchpad' | 'sync', self = false) => { channel?.postMessage({ kind }); if (self || kind === 'sync') localNotifications.dispatchEvent(new Event(kind)); };
export function subscribeStore(kind: 'journal' | 'scratchpad' | 'sync', callback: () => void): () => void {
  const listener = (event: MessageEvent<{ kind?: string }>) => { if (event.data?.kind === kind) callback(); };
  channel?.addEventListener('message', listener);
  localNotifications.addEventListener(kind, callback);
  return () => { channel?.removeEventListener('message', listener); localNotifications.removeEventListener(kind, callback); };
}

export async function loadTodoState(): Promise<TodoState> {
  const db = await openDatabase();
  let existing: TodoState | undefined;
  try {
    existing = await new Promise((resolve,reject) => {
      const request = db.transaction(STATE_STORE,'readonly').objectStore(STATE_STORE).get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
  if (existing) {
    const sources = [existing.document?.source, existing.baseline?.source].filter((source): source is string => typeof source === 'string');
    await Promise.all([...new Set(sources)].map(source => readJournalAsync(source)));
    return stateFrom(existing);
  }
  return transact<TodoState>([STATE_STORE, SCRATCH_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE), current = store.get('current'), legacy = store.get('legacy-txt:current'), scratch = tx.objectStore(SCRATCH_STORE).get('legacy-txt:current');
    let remaining = 3;
    const finish = () => {
      if (--remaining) return;
      try {
        if (!current.result && (legacy.result || scratch.result)) throw new Error('Finish the Markdown workspace transition before opening the journal.');
        const state = stateFrom(current.result);
        if (!current.result) store.put(state, 'current');
        done(state);
      } catch (error) { fail(error); }
    };
    for (const request of [current, legacy, scratch]) { request.onsuccess = finish; request.onerror = () => fail(request.error); }
  });
}
export async function loadScratchpadState(): Promise<ScratchpadState> {
  const state = await loadTodoState();
  return { text: state.document.scratchpad ?? '', revision: state.scratchRevision ?? 0 };
}

/** Reading and writing in one transaction serializes writes from all app windows. */
export async function mutateTodoState(change: (latest: TodoState) => TodoState | null): Promise<TodoState | null> {
  const started = startMarkdownMeasurement();
  const result = await transact<TodoState | null>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE);
    const request = store.get('current');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        const latest = stateFrom(request.result);
        const changed = change(latest);
        if (!changed) { done(null); return; }
        validateJournal(changed.document);
        const next = canonicalState(changed, latest);
        store.put(next, 'current');
        done(next);
      } catch (error) { fail(error); }
    };
  });
  finishMarkdownMeasurement('durableSave', started);
  if (result) { announce('journal', true); announce('scratchpad', true); }
  return result;
}

async function prepareJournalMutation(work: (before: TodoState) => TodoDocument): Promise<{ before: TodoState; journal: TodoState }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await loadTodoState();
    const document = await materializeJournalAsync(work(before));
    const journal = await mutateTodoState(latest => {
      if (latest.revision !== before.revision || latest.scratchRevision !== before.scratchRevision || latest.document.source !== before.document.source) return null;
      return { ...latest, document };
    });
    if (journal) return { before, journal };
  }
  throw new Error('The journal kept changing during validation. Your draft has not been applied; retry against the latest journal.');
}

export async function saveScratchpadText(expectedRevision: number, text: string): Promise<ScratchpadState> {
  const { journal } = await prepareJournalMutation(latest => {
    if ((latest.scratchRevision ?? 0) !== expectedRevision) throw new Error('Scratchpad changed in another window. Reload it before editing.');
    return { ...latest.document, scratchpad: text };
  });
  return { text: journal.document.scratchpad ?? '', revision: journal.scratchRevision ?? 0 };
}

export async function convertScratchpadSelection(args: { start: number; end: number; selected: string; scratchRevision: number; destination: ScratchpadDestination; items: Array<{ title: string; details: string[] }>; cut: boolean }): Promise<{ journal: TodoState; scratchpad: ScratchpadState; undo: ScratchpadUndo }> {
  const { before, journal: result } = await prepareJournalMutation(latest => {
    const scratch = latest.document.scratchpad ?? '';
    if ((latest.scratchRevision ?? 0) !== args.scratchRevision || scratch.slice(args.start, args.end) !== args.selected) throw new Error('The scratchpad changed. Select the text again.');
    const document = structuredClone(latest.document);
    const items = args.items.map(({ title, details }) => ({ id: crypto.randomUUID(), text: title, completed: false, details: details.map(text => ({ text, completed: false })) }));
    if (args.destination.kind === 'dated') {
      const date = args.destination.date;
      let day = document.days.find(day => day.date === date);
      if (!day) { day = { date, items: [] }; document.days.push(day); }
      day.items.push(...items);
    } else {
      const name = args.destination.list;
      let list = document.undated?.find(list => list.name === name);
      if (!list) { list = { name, items: [] }; (document.undated ??= []).push(list); }
      list.items.push(...items);
    }
    if (args.cut) document.scratchpad = scratch.slice(0, args.start) + scratch.slice(args.end);
    return document;
  });
  const undo: ScratchpadUndo = { before, scratchBefore: { text: before.document.scratchpad ?? '', revision: before.scratchRevision ?? 0 }, journalRevision: result.revision, scratchRevision: result.scratchRevision ?? 0 };
  return { journal: result, scratchpad: { text: result.document.scratchpad ?? '', revision: result.scratchRevision ?? 0 }, undo };
}

export async function undoScratchpadConversion(undo: ScratchpadUndo): Promise<{ journal: TodoState; scratchpad: ScratchpadState }> {
  const result = await mutateTodoState(latest => {
    if (latest.revision !== undo.journalRevision || (latest.scratchRevision ?? 0) !== undo.scratchRevision) throw new Error('New edits were made. Undo is no longer available.');
    return { ...latest, document: undo.before.document, baseline: undo.before.baseline };
  });
  if (!result) throw new Error('The capture promotion was not undone.');
  return { journal: result, scratchpad: { text: result.document.scratchpad ?? '', revision: result.scratchRevision ?? 0 } };
}

export async function loadWorkspaceArchive(): Promise<{ state: Record<string, unknown>; scratchpad: Record<string, unknown> } | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STATE_STORE, SCRATCH_STORE], 'readonly');
      const result: { state: Record<string, unknown>; scratchpad: Record<string, unknown> } = { state: {}, scratchpad: {} };
      let current = false;
      const active = tx.objectStore(STATE_STORE).get('current'); active.onsuccess = () => { current = !!active.result; };
      for (const name of [STATE_STORE, SCRATCH_STORE]) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => { const entry = request.result; if (!entry) return; if (String(entry.key).startsWith('legacy-txt:')) result[name as 'state' | 'scratchpad'][String(entry.key).slice(11)] = entry.value; entry.continue(); };
      }
      tx.oncomplete = () => resolve(!current && (Object.keys(result.state).length || Object.keys(result.scratchpad).length) ? result : null);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function startMarkdownWorkspace(convert: boolean): Promise<TodoState> {
  const archive = await loadWorkspaceArchive();
  if (!archive) return loadTodoState();
  const old = archive.state.current as TodoState | undefined;
  const scratch = archive.scratchpad.current as ScratchpadState | undefined;
  const document = convert ? journalFromModel(old ? normalizeDocument(old.document) : { days: [] }, scratch?.text ?? '') : createJournal();
  return transact<TodoState>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE), request = store.get('current');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      try {
        if (request.result) { done(stateFrom(request.result)); return; }
        const next: TodoState = { document, baseline: null, revision: 0, scratchRevision: 0 };
        store.put(next, 'current'); done(next);
      } catch (error) { fail(error); }
    };
  });
}

/** raw read-only recovery remains available even when the canonical source cannot be parsed. */
export async function readBrowserRecovery(): Promise<Record<string, Record<string, unknown>>> {
  // recovery must not retry a schema change that already failed or interpret future storage.
  const db = await new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => request.transaction!.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  try {
    return await new Promise((resolve,reject) => {
      const names = [...db.objectStoreNames];
      if (!names.length) { reject(new Error('There are no saved browser stores to recover.')); return; }
      const tx = db.transaction(names,'readonly');
      const result: Record<string,Record<string,unknown>> = Object.create(null);
      for (const name of names) {
        result[name] = Object.create(null);
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => { const entry = request.result; if (!entry) return; result[name][String(entry.key)] = entry.value; entry.continue(); };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
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
function checkedBundle<L extends SyncLink>(record: L, saved: TodoState, storedLedger: SyncBundle<L>['ledger'] | undefined): SyncBundle<L> {
  if (record.baselineDocument?.source === undefined) throw new Error('The linked target has no Markdown baseline. Keep its recovery data, unlink it and select a Markdown target.');
  const baseline = readJournal(record.baselineDocument.source).document;
  validateJournal(baseline);
  if (!storedLedger || storedLedger.linkId !== record.id) throw new Error('The linked target is missing its matching sync ledger. Saving is paused; keep the browser data and recover the target before relinking.');
  let ledger = storedLedger;
  if (ledger.checkpoint) {
    if (ledger.checkpoint.document?.source !== ledger.checkpoint.text) throw new Error('The pending save checkpoint is inconsistent. Saving is paused; keep the browser data and recovery copies.');
    const document = readJournal(ledger.checkpoint.text).document;
    validateJournal(document);
    ledger = { ...ledger, checkpoint: { ...ledger.checkpoint, document } };
  }
  if (ledger.revisions?.pending && ledger.revisions.pending.record.protocol !== 2) throw new Error('The pending revision uses an incompatible protocol. Keep it for recovery and use a compatible build.');
  return { link: { ...record, baselineDocument: baseline }, document: saved.document, revision: saved.revision, ledger };
}
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
            resolve(checkedBundle(record, saved, ledger.result));
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
          const current = checkedBundle(record, saved, ledger.result);
          const next = work(current, canIntegrate);
          if (!next) { done(null); return; }
          next.document = materializeJournal(next.document);
          journalChanged = serializeJournal(next.document) !== serializeJournal(current.document);
          if (journalChanged) { const state = canonicalState({ ...saved, document: next.document }, saved); next.document = state.document; next.revision = state.revision; store.put(state, 'current'); }
          if (next !== current || ledger.result?.linkId !== record.id) { metadataChanged = true; store.put(next.link, linkKey(provider)); store.put(next.ledger, provider + '-sync-ledger'); }
          done(next);
        } catch (error) { fail(error); }
      };
      for (const request of [link, journal, ledger]) { request.onsuccess = finish; request.onerror = () => fail(request.error); }
    });
    if (journalChanged) { announce('journal', true); announce('scratchpad', true); }
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

export async function loadSyncDevice(): Promise<string> {
  return transact<string>([STATE_STORE], (tx, done, fail) => {
    const store = tx.objectStore(STATE_STORE), request = store.get('sync-device-id');
    request.onerror = () => fail(request.error);
    request.onsuccess = () => { try { const id = request.result ?? crypto.randomUUID(); if (!request.result) store.put(id, 'sync-device-id'); done(id); } catch (error) { fail(error); } };
  });
}

export type ReviewedJournal = { document: TodoDocument; baseline: TodoDocument; expectedText: string; observedText?: string; generation?: string; revisionId?: string };
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
        if (serializeJournal(latest.document) !== review.expectedText) throw new Error('The journal changed while this review was open. Cancel and review the linked file again.');
        validateJournal(review.document);
        const next = canonicalState({ ...latest, document: review.document, baseline: review.baseline }, latest);
        const nextLedger = newSyncLedger(link.id, ledger.result);
        nextLedger.recovery = { at: Date.now(), local: review.expectedText, remote: review.observedText ?? link.baselineText };
        if (review.revisionId) {
          if (!nextLedger.revisions) throw new Error('The journal revision link changed. Review it again.');
          nextLedger.revisions = reviewedRevision(nextLedger.revisions, review.revisionId);
        }
        store.put(next, 'current'); store.put(link, linkKey(provider)); store.put(nextLedger, provider + '-sync-ledger');
        if (provider === 'drive') store.delete('sync-file-creation');
        done(next);
      } catch (error) { fail(error); }
    };
    for (const request of [target, other, journal, ledger]) { request.onsuccess = finish; request.onerror = () => fail(request.error); }
  });
  announce('journal'); announce('scratchpad', true); announce('sync'); return result;
}
