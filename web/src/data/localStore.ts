import type {
  GoogleCalendar,
  GoogleCalendarEvent,
  GoogleDriveFile,
  GoogleIdentity,
  GoogleTask,
  GoogleTaskList,
  PendingMutation,
  SyncCheckpoint,
  WorkspaceSnapshot
} from "@/types";

const DATABASE_NAME = "hot-cross-buns-web";
const DATABASE_VERSION = 1;

const stores = {
  settings: "settings",
  accounts: "accounts",
  taskLists: "taskLists",
  tasks: "tasks",
  calendars: "calendars",
  events: "events",
  driveFiles: "driveFiles",
  mutations: "mutations",
  checkpoints: "checkpoints"
} as const;

type StoreName = (typeof stores)[keyof typeof stores];
type Cached<T> = T & { readonly subject: string };

interface StoredSetting {
  readonly key: string;
  readonly value: unknown;
}

interface StoredCheckpoint extends SyncCheckpoint {
  readonly subject: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function createSubjectStore(database: IDBDatabase, name: StoreName, keyPath: string | string[]): IDBObjectStore {
  const store = database.createObjectStore(name, { keyPath });
  store.createIndex("subject", "subject", { unique: false });
  return store;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(stores.settings, { keyPath: "key" });
      createSubjectStore(database, stores.accounts, "subject");
      createSubjectStore(database, stores.taskLists, ["subject", "id"]);
      createSubjectStore(database, stores.tasks, ["subject", "id"]);
      createSubjectStore(database, stores.calendars, ["subject", "id"]);
      createSubjectStore(database, stores.events, ["subject", "id"]);
      createSubjectStore(database, stores.driveFiles, ["subject", "id"]);
      createSubjectStore(database, stores.mutations, "id");
      createSubjectStore(database, stores.checkpoints, ["subject", "resource"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not open"));
  });
}

function withoutSubject<T extends { readonly subject: string }>(record: T): Omit<T, "subject"> {
  const { subject: _subject, ...value } = record;
  return value;
}

export class LocalStore {
  private database: Promise<IDBDatabase> | undefined;

  private db(): Promise<IDBDatabase> {
    this.database ??= openDatabase();
    return this.database;
  }

  async getClientId(): Promise<string | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readonly");
    const stored = await requestResult(transaction.objectStore(stores.settings).get("googleClientId"));
    await transactionDone(transaction);
    return typeof (stored as StoredSetting | undefined)?.value === "string"
      ? ((stored as StoredSetting).value as string)
      : undefined;
  }

  async setClientId(clientId: string): Promise<void> {
    await this.put(stores.settings, { key: "googleClientId", value: clientId.trim() } satisfies StoredSetting);
  }

  async getActiveSubject(): Promise<string | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readonly");
    const stored = await requestResult(transaction.objectStore(stores.settings).get("activeGoogleSubject"));
    await transactionDone(transaction);
    return typeof (stored as StoredSetting | undefined)?.value === "string"
      ? ((stored as StoredSetting).value as string)
      : undefined;
  }

  async setActiveSubject(subject: string | undefined): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.settings, "readwrite");
    const store = transaction.objectStore(stores.settings);
    if (subject) {
      store.put({ key: "activeGoogleSubject", value: subject } satisfies StoredSetting);
    } else {
      store.delete("activeGoogleSubject");
    }
    await transactionDone(transaction);
  }

  async saveSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(
      [stores.accounts, stores.taskLists, stores.tasks, stores.calendars, stores.events],
      "readwrite"
    );
    transaction.objectStore(stores.accounts).put({ ...snapshot.identity, updatedAt: snapshot.updatedAt });
    await this.replaceSubjectRecords(transaction.objectStore(stores.taskLists), snapshot.identity.subject, snapshot.taskLists);
    await this.replaceSubjectRecords(transaction.objectStore(stores.tasks), snapshot.identity.subject, snapshot.tasks);
    await this.replaceSubjectRecords(transaction.objectStore(stores.calendars), snapshot.identity.subject, snapshot.calendars);
    await this.replaceSubjectRecords(transaction.objectStore(stores.events), snapshot.identity.subject, snapshot.events);
    await transactionDone(transaction);
  }

  async readSnapshot(subject: string): Promise<WorkspaceSnapshot | undefined> {
    const database = await this.db();
    const transaction = database.transaction(
      [stores.accounts, stores.taskLists, stores.tasks, stores.calendars, stores.events],
      "readonly"
    );
    const account = await requestResult(transaction.objectStore(stores.accounts).get(subject)) as (GoogleIdentity & { updatedAt: string }) | undefined;
    const [taskLists, tasks, calendars, events] = await Promise.all([
      this.recordsForSubject<Cached<GoogleTaskList>>(transaction.objectStore(stores.taskLists), subject),
      this.recordsForSubject<Cached<GoogleTask>>(transaction.objectStore(stores.tasks), subject),
      this.recordsForSubject<Cached<GoogleCalendar>>(transaction.objectStore(stores.calendars), subject),
      this.recordsForSubject<Cached<GoogleCalendarEvent>>(transaction.objectStore(stores.events), subject)
    ]);
    await transactionDone(transaction);
    if (!account) {
      return undefined;
    }
    const { updatedAt, ...identity } = account;
    return {
      identity,
      taskLists: taskLists.map(withoutSubject),
      tasks: tasks.map(withoutSubject),
      calendars: calendars.map(withoutSubject),
      events: events.map(withoutSubject),
      updatedAt
    };
  }

  async saveDriveFiles(subject: string, files: readonly GoogleDriveFile[]): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.driveFiles, "readwrite");
    await this.replaceSubjectRecords(transaction.objectStore(stores.driveFiles), subject, files);
    await transactionDone(transaction);
  }

  async queueMutation(mutation: PendingMutation): Promise<void> {
    await this.put(stores.mutations, mutation);
  }

  async pendingMutations(subject: string): Promise<PendingMutation[]> {
    const database = await this.db();
    const transaction = database.transaction(stores.mutations, "readonly");
    const result = await this.recordsForSubject<PendingMutation>(transaction.objectStore(stores.mutations), subject);
    await transactionDone(transaction);
    return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async removeMutation(id: string): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(stores.mutations, "readwrite");
    transaction.objectStore(stores.mutations).delete(id);
    await transactionDone(transaction);
  }

  async saveCheckpoint(subject: string, checkpoint: SyncCheckpoint): Promise<void> {
    await this.put(stores.checkpoints, { ...checkpoint, subject } satisfies StoredCheckpoint);
  }

  async readCheckpoint(subject: string, resource: string): Promise<SyncCheckpoint | undefined> {
    const database = await this.db();
    const transaction = database.transaction(stores.checkpoints, "readonly");
    const record = await requestResult(
      transaction.objectStore(stores.checkpoints).get([subject, resource])
    ) as StoredCheckpoint | undefined;
    await transactionDone(transaction);
    return record ? withoutSubject(record) : undefined;
  }

  async clearAccount(subject: string): Promise<void> {
    const database = await this.db();
    const affectedStores: StoreName[] = [
      stores.accounts,
      stores.taskLists,
      stores.tasks,
      stores.calendars,
      stores.events,
      stores.driveFiles,
      stores.mutations,
      stores.checkpoints
    ];
    const transaction = database.transaction(affectedStores, "readwrite");
    for (const storeName of affectedStores) {
      const store = transaction.objectStore(storeName);
      if (storeName === stores.accounts) {
        store.delete(subject);
      } else {
        await this.deleteSubjectRecords(store, subject);
      }
    }
    await transactionDone(transaction);
  }

  async clearAll(): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(Object.values(stores), "readwrite");
    for (const name of Object.values(stores)) {
      transaction.objectStore(name).clear();
    }
    await transactionDone(transaction);
  }

  private async put(storeName: StoreName, value: unknown): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  }

  private async recordsForSubject<T>(store: IDBObjectStore, subject: string): Promise<T[]> {
    return requestResult(store.index("subject").getAll(IDBKeyRange.only(subject))) as Promise<T[]>;
  }

  private async replaceSubjectRecords<T extends { readonly id: string }>(
    store: IDBObjectStore,
    subject: string,
    records: readonly T[]
  ): Promise<void> {
    await this.deleteSubjectRecords(store, subject);
    for (const record of records) {
      store.put({ ...record, subject });
    }
  }

  private async deleteSubjectRecords(store: IDBObjectStore, subject: string): Promise<void> {
    const index = store.index("subject");
    await new Promise<void>((resolve, reject) => {
      const request = index.openKeyCursor(IDBKeyRange.only(subject));
      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  }
}

export const localStore = new LocalStore();
