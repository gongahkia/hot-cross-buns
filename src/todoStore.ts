import { emptyDocument, type TodoDocument } from './todoText';

export interface TodoFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options?: { mode: 'readwrite' }): Promise<PermissionState>;
}

export type TodoState = { document: TodoDocument; baseline: TodoDocument | null; baselineText: string | null; fileHandle: TodoFileHandle | null };
export const emptyState = (): TodoState => ({ document: emptyDocument(), baseline: null, baselineText: null, fileHandle: null });
const DB_NAME = 'jing-todo-v1';
const STORE = 'state';
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
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get('current');
      request.onsuccess = () => resolve(request.result ?? emptyState());
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export function saveTodoState(state: TodoState): Promise<void> {
  const snapshot = { ...state, document: structuredClone(state.document), baseline: state.baseline ? structuredClone(state.baseline) : null };
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
