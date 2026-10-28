/** The synchronous SQL surface consumed by the domain; execution lives off the UI thread. */
export interface SqlStatement {
  run(...bindings: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...bindings: any[]): any;
  all(...bindings: any[]): any[];
  iterate(...bindings: any[]): IterableIterator<any>;
  /** WASM statements must release their native allocation when evicted. */
  finalize?(): void;
}

export interface SqlDatabase {
  readonly name?: string;
  prepare(sql: string): SqlStatement;
  exec(sql: string): unknown;
  pragma(sql: string, options?: { simple?: boolean }): any;
  /** Includes nested savepoint semantics, matching better-sqlite3. */
  transaction<T>(action: () => T): () => T;
  close(): void;
}

export interface CoreStorePlatform {
  platform?: string;
  backupTo?(filePath: string): Promise<void>;
  openSnapshot?(filePath: string): SqlDatabase;
  /** Optional compact fingerprint for temporary Google conflict reviews. */
  hashVersion?(value: string): string;
}
