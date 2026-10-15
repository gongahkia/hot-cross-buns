import { emptyDocument, normalizeDocument, validateDocument, type TodoDocument } from './todoText';

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; revision: number };
export const emptyState = (): TodoState => ({ document: emptyDocument(), baseline: null, revision: 0 });
const DB_NAME = 'hito-todo-v1';
const LEGACY_DB_NAME = 'jing-todo-v1';
const STORE = 'state';
const PENDING_KEY = 'hito-todo-pending-v1';
const LEGACY_PENDING_KEY = 'jing-todo-pending-v1';
let queued: Promise<void> = Promise.resolve();

function openDatabase(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readState(name: string): Promise<TodoState | null> {
  const db = await openDatabase(name);
  try {
    return await new Promise<TodoState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('current');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function loadTodoState(): Promise<TodoState> {
  const current = await readState(DB_NAME);
  const legacy = await readState(LEGACY_DB_NAME);
  let saved = current && (current.revision ?? 0) >= (legacy?.revision ?? -1) ? current : legacy ?? emptyState();
  let migrated = saved !== current;
  for (const key of [PENDING_KEY, LEGACY_PENDING_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const pending = JSON.parse(raw) as { revision: number; document: TodoDocument };
        if (Number.isSafeInteger(pending.revision) && pending.revision > (saved.revision ?? 0)) {
          const document = normalizeDocument(pending.document);
          validateDocument(document);
          saved = { ...saved, document, revision: pending.revision, baseline: null };
          migrated = true;
        }
      }
    } catch { /* A damaged recovery record must not hide the IndexedDB copy. */ }
  }
  const loaded: TodoState = { document: normalizeDocument(saved.document), baseline: saved.baseline ? normalizeDocument(saved.baseline) : null, revision: saved.revision ?? 0 };
  if (migrated) void saveTodoState(loaded).then(() => localStorage.removeItem(LEGACY_PENDING_KEY)).catch(() => undefined);
  return loaded;
}

export function saveTodoState(state: TodoState): Promise<void> {
  const snapshot: TodoState = { document: structuredClone(state.document), baseline: state.baseline ? structuredClone(state.baseline) : null, revision: state.revision };
  // IndexedDB commits asynchronously. This small recovery record covers a reload
  // before its transaction starts or finishes; IndexedDB remains the main store.
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ revision: state.revision, document: state.document })); }
  catch { /* Large documents can exceed localStorage; IndexedDB still saves them. */ }
  queued = queued.catch(() => undefined).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(snapshot, 'current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    try {
      const pending = localStorage.getItem(PENDING_KEY);
      if (pending && (JSON.parse(pending) as { revision: number }).revision <= state.revision) localStorage.removeItem(PENDING_KEY);
    } catch { /* Recovery cleanup is best effort. */ }
  });
  return queued;
}
