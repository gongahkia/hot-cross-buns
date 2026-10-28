import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlDatabase, SqlStatement } from '@shared/core/database';

let initialization: Promise<Sqlite3Static> | undefined;
export const loadSqlite = () => initialization ??= sqlite3InitModule();

/** SQLite's synchronous OO API, owned exclusively by a Web Worker. */
export class WasmDatabase implements SqlDatabase {
  readonly name = 'IndexedDB workspace';
  readonly raw: InstanceType<Sqlite3Static['oo1']['DB']>;
  private nextSavepoint = 0;

  constructor(readonly sqlite: Sqlite3Static, bytes?: Uint8Array) {
    this.raw = new sqlite.oo1.DB(':memory:', 'c');
    try {
      if (bytes) {
        // SQLite owns and may resize this buffer. Use its allocator, not a JS
        // heap address or a fixed-size deserialize buffer.
        const pointer = sqlite.capi.sqlite3_malloc(bytes.byteLength + 20);
        if (!pointer) throw new Error('Not enough memory to reopen the workspace.');
        sqlite.wasm.heap8u().fill(0, pointer, pointer + bytes.byteLength + 20);
        sqlite.wasm.heap8u().set(bytes, pointer);
        const result = sqlite.capi.sqlite3_deserialize(this.raw.pointer!, 'main', pointer,
          bytes.byteLength, bytes.byteLength + 20,
          sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE);
        // FREEONCLOSE also frees the buffer if sqlite3_deserialize fails.
        this.raw.checkRc(result);
      }
      this.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=MEMORY;');
      if (bytes && this.pragma('quick_check', { simple: true }) !== 'ok') {
        throw new Error('The saved workspace failed its integrity check. Its IndexedDB data has been preserved.');
      }
    } catch (error) { this.raw.close(); throw error; }
  }

  prepare(sql: string): SqlStatement {
    const statement = this.raw.prepare(sql);
    const invoke = (bindings: any[], mode: 'run' | 'get' | 'all'): any => {
      try {
        statement.reset(true);
        // better-sqlite3 accepts bare named keys and ignores extra object keys.
        // Bind by parameter name to preserve its semantics (OO1 requires @/:/$).
        if (bindings.length === 1 && bindings[0] && typeof bindings[0] === 'object' && !Array.isArray(bindings[0]) && !(bindings[0] instanceof Uint8Array)) {
          const values = bindings[0];
          for (let index = 1; index <= statement.parameterCount; index++) {
            const name = this.sqlite.capi.sqlite3_bind_parameter_name(statement.pointer!, index);
            if (!name) throw new Error('Expected a named SQL parameter.');
            const key = Object.hasOwn(values, name) ? name : name.slice(1);
            if (!Object.hasOwn(values, key)) throw new Error(`Missing SQL binding: ${name}`);
            statement.bind(index, values[key]);
          }
        } else if (bindings.length) {
          statement.bind(bindings.length === 1 && Array.isArray(bindings[0]) ? bindings[0] : bindings);
        } else if (statement.parameterCount) {
          throw new Error('Missing SQL bindings.');
        }
        if (mode === 'get') return statement.step() ? statement.get({}) : undefined;
        if (mode === 'all') {
          const rows: any[] = [];
          while (statement.step()) rows.push(statement.get({}));
          return rows;
        }
        while (statement.step()) { /* exhaust RETURNING results before reset */ }
        return { changes: this.raw.changes(), lastInsertRowid: Number(this.raw.selectValue('SELECT last_insert_rowid()')) };
      } finally {
        // Reset even after constraints or failed bindings: cached statements are reusable.
        statement.reset(true);
      }
    };
    return {
      run: (...bindings) => invoke(bindings, 'run'),
      get: (...bindings) => invoke(bindings, 'get'),
      all: (...bindings) => invoke(bindings, 'all'),
      iterate: (...bindings) => invoke(bindings, 'all')[Symbol.iterator](),
      finalize: () => { statement.finalize(); },
    };
  }

  exec(sql: string): void { this.raw.exec(sql); }
  pragma(sql: string, options?: { simple?: boolean }): any {
    const rows = this.raw.selectObjects(`PRAGMA ${sql}`);
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }
  transaction<T extends (...args: any[]) => any>(action: T): T {
    return ((...args: Parameters<T>) => {
      const name = `hcb_${++this.nextSavepoint}`;
      this.exec(`SAVEPOINT ${name}`);
      try {
        const result = action(...args);
        if (result instanceof Promise) throw new Error('SQL transactions must be synchronous.');
        this.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        this.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw error;
      }
    }) as T;
  }
  get totalChanges(): number { return Number(this.raw.changes(true)); }
  export(): Uint8Array<ArrayBuffer> { return this.sqlite.capi.sqlite3_js_db_export(this.raw.pointer!); }
  close(): void { this.raw.close(); }
}
