import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CoreStore as DomainCoreStore } from "../../shared/core/CoreStore";
import { assertIsolatedTestDatabasePath } from "./testDatabasePaths";
export * from "../../shared/core/CoreStore";

/** Native SQLite is retained for domain regression tests and legacy tooling. */
export class CoreStore extends DomainCoreStore {
  constructor(databasePath: string) {
    assertIsolatedTestDatabasePath(databasePath);
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(databasePath), 0o700);
    const database = new Database(databasePath);
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
    try {
      super(database, {
        platform: process.platform,
        hashVersion: (value) => createHash("sha256").update(value).digest("hex"),
        backupTo: async (filePath) => { await database.backup(filePath); chmodSync(filePath, 0o600); },
        openSnapshot: (filePath) => new Database(filePath, { readonly: true, fileMustExist: true })
      });
    } catch (error) {
      database.close();
      throw error;
    }
  }
}
