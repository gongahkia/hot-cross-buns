export const WORKSPACE_DATABASE = 'hot-cross-buns-workspace';
export const WORKSPACE_LOCK = 'hot-cross-buns-workspace-writer';
export interface DurableSnapshot {
  revision: number;
  bytes: Uint8Array<ArrayBuffer>;
  savedAt: string;
  format: 1;
}

export function openWorkspaceStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => { request.result.createObjectStore('workspace'); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close older Hot Cross Buns tabs and reload to upgrade workspace storage.')); };
  });
}

export function readSnapshot(db: IDBDatabase): Promise<DurableSnapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly');
    const request = transaction.objectStore('workspace').get('current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read IndexedDB.'));
  });
}

/** One atomic record contains SQL tables, FTS, undo, outbox, and persistence metadata. */
export function commitSnapshot(db: IDBDatabase, snapshot: DurableSnapshot, expectedRevision: number, fail = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite', { durability: 'strict' });
    let reason: Error | undefined;
    const store = transaction.objectStore('workspace');
    const current = store.get('current');
    current.onsuccess = () => {
      if ((current.result?.revision ?? 0) !== expectedRevision) {
        reason = new Error('The workspace changed in another tab. Reload and retry this change.');
        transaction.abort();
        return;
      }
      try { store.put(snapshot, 'current'); }
      catch (error) { reason = error instanceof Error ? error : new Error(String(error)); transaction.abort(); return; }
      if (fail) {
        reason = new Error('Injected IndexedDB persistence failure.');
        transaction.abort();
      }
    };
    // Request success is NOT a durable acknowledgement. Only transaction completion is.
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(reason ?? transaction.error ?? new Error('IndexedDB could not save the workspace.'));
  });
}
