import { CoreStore, schemaVersion } from '@shared/core/CoreStore';
import { loadSqlite, WasmDatabase } from './sqliteDatabase';

export const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
export interface ImportReview {
  reviewId: string;
  summary: { tasks: number; notes: number; events: number; taskLists: number; calendars: number; accounts: number; pendingMutations: number; schemaVersion: number };
  warnings: string[];
}
export interface StagedImport { review: ImportReview; bytes: Uint8Array<ArrayBuffer>; revision: number; expiresAt: number }

/** All migration, integrity checks and quarantine happen on a separate connection. */
export async function stageWorkspaceImport(bytes: Uint8Array, revision: number): Promise<StagedImport> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 100 || bytes.length > MAX_IMPORT_BYTES) {
    throw new Error('Choose a SQLite workspace backup between 100 bytes and 128 MiB.');
  }
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') throw new Error('This file is not a SQLite workspace backup.');
  if (bytes[18] === 2 || bytes[19] === 2) {
    throw new Error('This file uses WAL mode and may depend on a companion WAL file. Create a consistent SQLite backup with the desktop app or SQLite backup API, then set journal_mode=DELETE on that backup. A copied live database alone may be missing recent changes; changing header bytes cannot recover them.');
  }
  const db = new WasmDatabase(await loadSqlite(), bytes);
  let candidate: CoreStore | undefined;
  try {
    const table = db.raw.selectValue("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
    if (!table) throw new Error('This is not a Hot Cross Buns workspace: its application schema is missing.');
    const version = Number(db.raw.selectValue('SELECT MAX(version) FROM schema_migrations'));
    if (!Number.isInteger(version) || version < 3 || version > schemaVersion) throw new Error(`Workspace schema ${version} is unsupported. Use a compatible Hot Cross Buns version.`);
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('The backup failed its SQLite integrity check.');
    candidate = new CoreStore(db, { platform: 'web' });
    if (db.pragma('foreign_key_check').length) throw new Error('The backup contains broken database relationships.');
    if (db.raw.selectValue(`SELECT 1 FROM tasks child LEFT JOIN tasks parent ON parent.id=child.parent_id WHERE child.parent_id IS NOT NULL AND (parent.id IS NULL OR parent.list_id!=child.list_id) LIMIT 1`) ||
        db.raw.selectValue(`SELECT 1 FROM notes note LEFT JOIN note_lists list ON list.id=note.list_id WHERE note.list_id IS NOT NULL AND list.id IS NULL LIMIT 1`)) {
      throw new Error('The backup contains broken task or note relationships.');
    }
    // Reading the real bootstrap verifies expected application columns and JSON.
    candidate.dispatch('bootstrap', 'get', {});
    const count = (tableName: string, where = '1') => Number(db.raw.selectValue(`SELECT COUNT(*) FROM ${tableName} WHERE ${where}`));
    const summary = {
      tasks: count('tasks'), notes: count('notes', 'deleted_at IS NULL'), events: count('events'),
      taskLists: count('task_lists'), calendars: count('calendars'), accounts: count('google_accounts', "id!='local'"),
      pendingMutations: count('outbox', "account_id!='local' AND state IN ('pending','conflict')"), schemaVersion: version,
    };
    db.transaction(() => {
      db.exec("UPDATE outbox SET state='conflict',last_error='Imported change: compare with Google in Diagnostics before deciding whether to retry or discard.' WHERE account_id!='local' AND state IN ('pending','conflict');");
      db.exec("UPDATE google_accounts SET connection_state='disconnected',last_error='Imported account: reconnect to review Google changes.' WHERE id!='local';");
      db.exec("DELETE FROM sync_meta WHERE key='google-sync-runtime';");
    })();
    return {
      bytes: db.export(), revision, expiresAt: Date.now() + 10 * 60_000,
      review: {
        reviewId: crypto.randomUUID(), summary,
        warnings: ['This replaces the entire workspace, including settings and undo history. It does not merge. Export your current workspace first.',
          'Only use a consistent application backup. A copied live desktop database may omit changes in its WAL.',
          ...(summary.accounts ? ['Google accounts will require reconnection. Imported pending Google changes are blocked until individually reviewed in Diagnostics.'] : [])],
      },
    };
  } finally { if (candidate) candidate.close(); else db.close(); }
}
