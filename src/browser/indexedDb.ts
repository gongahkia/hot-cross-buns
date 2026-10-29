export const WORKSPACE_DATABASE = 'hot-cross-buns-workspace';
export const WORKSPACE_LOCK = 'hot-cross-buns-workspace-writer';
export const GOOGLE_SYNC_LOCK = 'hot-cross-buns-google-operations';
export interface DurableSnapshot {
  revision: number;
  bytes: Uint8Array<ArrayBuffer>;
  savedAt: string;
  format: 1;
}

export function openWorkspaceStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v3 fences workers that treat a live remote creation as an abandoned one
    // when reopening a snapshot. v2 added the companion revision record.
    const request = indexedDB.open(WORKSPACE_DATABASE, 3);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace');
      const store = request.transaction!.objectStore('workspace');
      const previous = store.get('current');
      previous.onsuccess = () => {
        if (previous.result && Number.isSafeInteger(previous.result.revision) && previous.result.revision > 0) {
          store.put(previous.result.revision, 'revision');
        }
      };
    };
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

/** Small atomic companion record avoids cloning the database for every read. */
export function readRevision(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readonly');
    const store = tx.objectStore('workspace');
    const request = store.get('revision');
    let revision = 0;
    request.onsuccess = () => {
      if (request.result !== undefined) revision = request.result;
      else {
        // Compatibility with snapshots produced by the first browser build.
        const legacy = store.get('current');
        legacy.onsuccess = () => { revision = legacy.result?.revision ?? 0; };
      }
    };
    tx.oncomplete = () => Number.isSafeInteger(revision) && revision >= 0
      ? resolve(revision) : reject(new Error('Invalid workspace revision. Saved data has been preserved.'));
    tx.onabort = () => reject(tx.error ?? new Error('Could not read workspace revision.'));
  });
}

/** One atomic record contains SQL tables, FTS, undo, outbox, and persistence metadata. */
export function commitSnapshot(db: IDBDatabase, snapshot: DurableSnapshot, expectedRevision: number, fail = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite', { durability: 'strict' });
    let reason: Error | undefined;
    const store = transaction.objectStore('workspace');
    const checkAndWrite = (revision: number) => {
      if (revision !== expectedRevision) {
        reason = new Error('The workspace changed in another tab. Reload and retry this change.');
        transaction.abort();
        return;
      }
      try { store.put(snapshot, 'current'); store.put(snapshot.revision, 'revision'); }
      catch (error) { reason = error instanceof Error ? error : new Error(String(error)); transaction.abort(); return; }
      if (fail) {
        reason = new Error('Injected IndexedDB persistence failure.');
        transaction.abort();
      }
    };
    const current = store.get('revision');
    current.onsuccess = () => {
      if (current.result !== undefined) checkAndWrite(current.result);
      else {
        const legacy = store.get('current');
        legacy.onsuccess = () => checkAndWrite(legacy.result?.revision ?? 0);
      }
    };
    // Request success is NOT a durable acknowledgement. Only transaction completion is.
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(reason ?? transaction.error ?? new Error('IndexedDB could not save the workspace.'));
  });
}
