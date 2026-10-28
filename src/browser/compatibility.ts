import { loadSqlite, WasmDatabase } from './sqliteDatabase';
import { CoreStore } from '@shared/core/CoreStore';

/** Executed against the exact shipped WASM binary, never a native SQLite substitute. */
export async function verifySqliteCompatibility() {
  const sqlite = await loadSqlite();
  let db = new WasmDatabase(sqlite);
  const checks: string[] = [];
  const assert = (condition: unknown, label: string) => {
    if (!condition) throw new Error(`SQLite compatibility failed: ${label}`);
    checks.push(label);
  };
  try {
    db.exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY, title TEXT UNIQUE, data TEXT);
      CREATE TABLE child(parent_id INTEGER REFERENCES parent(id), value TEXT);
      CREATE VIRTUAL TABLE search USING fts5(title);
      CREATE TRIGGER search_insert AFTER INSERT ON parent BEGIN INSERT INTO search(rowid,title) VALUES(new.id,new.title); END;`);
    const insert = db.prepare('INSERT INTO parent(id,title,data) VALUES(?,?,?)');
    insert.run(1, 'fresh cinnamon buns', '{"count":3}');
    const named = db.prepare('INSERT INTO parent(id,title,data) VALUES(@id,:title,$data)');
    named.run({ id: 2, title: 'cardamom bread', data: '{"count":4}', ignored: true });
    assert(db.raw.selectValue('SELECT count(*) FROM parent') === 2, 'positional and named SQL bindings');
    assert(db.raw.selectValue("SELECT count(*) FROM search WHERE search MATCH 'cinnamon'") === 1, 'FTS5 and triggers');
    assert(db.raw.selectValue("SELECT json_extract(data,'$.count') FROM parent WHERE id=2") === 4, 'JSON expressions');
    let rejected = false;
    try { db.exec("INSERT INTO child VALUES(99,'bad')"); } catch { rejected = true; }
    assert(rejected, 'foreign keys enforced');
    db.transaction(() => {
      insert.run(3, 'outer savepoint', '{}');
      try { db.transaction(() => { insert.run(4, 'inner rollback', '{}'); throw new Error('rollback'); })(); } catch { /* expected */ }
      insert.run(5, 'outer continued', '{}');
    })();
    assert(db.raw.selectValue('SELECT count(*) FROM parent WHERE id IN (3,4,5)') === 2, 'nested transactions/savepoints');
    try { db.transaction(() => { insert.run(6, 'rollback everything', '{}'); throw new Error('rollback'); })(); } catch { /* expected */ }
    assert(db.raw.selectValue('SELECT count(*) FROM parent WHERE id=6') === 0, 'outer transaction rollback');
    try { insert.run(1, 'duplicate', '{}'); } catch { /* cached statement must survive */ }
    insert.run(7, 'reused after constraint', '{}');
    const select = db.prepare('SELECT title FROM parent WHERE id=?');
    assert(select.get(1).title === 'fresh cinnamon buns' && select.get(7).title === 'reused after constraint', 'statement cleanup and reuse');
    assert(db.raw.selectValue('WITH ranked AS (SELECT id,row_number() OVER (ORDER BY id) n FROM parent) SELECT MAX(n) FROM ranked') === 5, 'CTEs and window queries');
    select.finalize?.(); insert.finalize?.(); named.finalize?.();
    assert(db.raw.openStatementCount() === 0, 'explicit statement finalization');
    const bytes = db.export();
    db.close();
    db = new WasmDatabase(sqlite, bytes);
    assert(db.raw.selectValue("SELECT count(*) FROM search WHERE search MATCH 'cinnamon'") === 1, 'export/reopen preserves FTS5');
    db.exec("INSERT INTO parent VALUES(8,'database grows after reopen', '{}')");
    assert(db.raw.selectValue('SELECT count(*) FROM parent') === 6, 'reopened database remains writable');
    db.close();
    db = new WasmDatabase(sqlite);
    let core = new CoreStore(db);
    core.dispatch('tasks', 'create', { title: 'Durable browser task' });
    core.dispatch('notes', 'create', { title: 'Durable browser note', body: 'Indexed cinnamon' });
    const populated = db.export();
    core.close();
    db = new WasmDatabase(sqlite, populated);
    core = new CoreStore(db);
    const reopened = db.export();
    assert(reopened.length === populated.length && reopened.every((value, index) => value === populated[index]), 'current workspace reopens without snapshot churn');
    assert(core.dispatch('search', 'query', { query: 'cinnamon' }).items.length === 1, 'domain full-text search after snapshot reopen');
    return { version: sqlite.version.libVersion, checks, bytes: bytes.byteLength };
  } finally { db.close(); }
}
