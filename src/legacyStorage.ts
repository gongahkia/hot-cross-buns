const legacyPrefix = 'shio-pan-';
const prefix = 'hot-cross-buns-';
const migrationKey = `${prefix}storage-renamed-v1`;

function migratePreferences(storage: Storage): void {
  if (storage.getItem(migrationKey)) return;
  for (const key of Object.keys(storage)) {
    if (!key.startsWith(legacyPrefix)) continue;
    const renamed = prefix + key.slice(legacyPrefix.length);
    if (storage.getItem(renamed) === null) storage.setItem(renamed, storage.getItem(key)!);
  }
  storage.setItem(migrationKey, 'true');
}

function readLegacyJournal(): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`${legacyPrefix}v1`);
    let absent = false;
    request.onupgradeneeded = () => { absent = true; request.transaction!.abort(); };
    request.onerror = () => absent ? resolve(undefined) : reject(request.error);
    request.onblocked = () => reject(new Error('Close older journal tabs and reload to migrate saved data.'));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const stores = ['state', 'scratchpad'].filter(name => db.objectStoreNames.contains(name));
        if (!stores.length) { db.close(); reject(new Error('The saved journal has an unknown format.')); return; }
        const values: Record<string, unknown> = {};
        const tx = db.transaction(stores, 'readonly');
        for (const name of stores) {
          const entry = tx.objectStore(name).get('current');
          entry.onsuccess = () => { if (entry.result !== undefined) values[name] = entry.result; };
        }
        tx.oncomplete = () => { db.close(); resolve(values); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

function copyJournal(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`${prefix}v1`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('scratchpad');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other journal tabs and reload to migrate saved data.'));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const stores = ['state', 'scratchpad'];
        const tx = db.transaction(stores, 'readwrite');
        let pending = stores.length;
        let populated = false;
        for (const name of stores) {
          const entry = tx.objectStore(name).get('current');
          entry.onsuccess = () => {
            populated ||= entry.result !== undefined;
            // never mix an existing renamed journal with an older snapshot.
            if (--pending === 0 && !populated) {
              for (const [store, value] of Object.entries(values)) tx.objectStore(store).put(value, 'current');
            }
          };
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export async function migrateLegacyStorage(): Promise<void> {
  if (!localStorage.getItem(migrationKey)) {
    const journal = await readLegacyJournal();
    if (journal && Object.keys(journal).length) await copyJournal(journal);
    migratePreferences(localStorage);
  }
  migratePreferences(sessionStorage);
}
