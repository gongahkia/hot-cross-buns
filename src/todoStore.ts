import { emptyDocument, validateDocument, type TodoDocument } from './todoText';

export interface TodoFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
}

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; baselineText: string | null; fileHandle: TodoFileHandle | null; revision: number };
export const emptyState = (): TodoState => ({ document: emptyDocument(), baseline: null, baselineText: null, fileHandle: null, revision: 0 });
const DB_NAME = 'jing-todo-v1';
const STORE = 'state';
const PENDING_KEY = 'jing-todo-pending-v1';
let queued: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadTodoState(): Promise<TodoState> {
  const db = await openDatabase();
  try {
    const saved = await new Promise<TodoState>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('current');
      request.onsuccess = () => resolve(request.result ?? emptyState());
      request.onerror = () => reject(request.error);
    });
    let recovered: TodoState | null = null;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as { revision: number; document: TodoDocument };
        if (Number.isSafeInteger(pending.revision) && pending.revision > (saved.revision ?? 0)) {
          validateDocument(pending.document);
          recovered = { ...saved, document: pending.document, revision: pending.revision, baseline: null, baselineText: null, fileHandle: null };
        }
      }
    } catch { /* A damaged recovery record must not hide the IndexedDB copy. */ }
    if (recovered) {
      void saveTodoState(recovered);
      return recovered;
    }
    return { ...saved, revision: saved.revision ?? 0 };
  } finally { db.close(); }
}

export function saveTodoState(state: TodoState): Promise<void> {
  const snapshot = { ...state, document: structuredClone(state.document), baseline: state.baseline ? structuredClone(state.baseline) : null };
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

export function pickTodoFile(): Promise<TodoFileHandle> {
  const picker = (window as Window & { showOpenFilePicker?: (options?: object) => Promise<TodoFileHandle[]> }).showOpenFilePicker;
  if (!picker) throw new Error('Direct file access is unavailable in this browser. Use Import instead.');
  return picker({ types: [{ description: 'TODO.txt', accept: { 'text/plain': ['.txt'] } }], multiple: false }).then(handles => handles[0]);
}

export function supportsDirectFiles() {
  return typeof (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}
