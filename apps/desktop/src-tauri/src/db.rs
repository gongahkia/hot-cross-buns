use std::path::Path;

use rusqlite::Connection;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_inbox INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id),
    parent_task_id TEXT REFERENCES tasks(id),
    title TEXT NOT NULL,
    content TEXT,
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1, 2, 3)),
    status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)),
    due_date TEXT,
    due_timezone TEXT,
    recurrence_rule TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sync_meta (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    new_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, field_name)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    local_value TEXT NOT NULL,
    remote_value TEXT NOT NULL,
    local_updated_at TEXT NOT NULL,
    remote_updated_at TEXT NOT NULL,
    local_device_id TEXT,
    remote_device_id TEXT,
    resolution_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, field_name)
);

CREATE TABLE IF NOT EXISTS sync_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    server_url TEXT NOT NULL DEFAULT '',
    auth_token TEXT NOT NULL DEFAULT '',
    device_id TEXT NOT NULL DEFAULT '',
    auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS notified_tasks (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    notified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(resolution_status);

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, content, content=tasks, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
    INSERT INTO tasks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;
"#;

fn apply_pragmas(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )
    .map_err(|e| format!("Failed to set PRAGMAs: {}", e))
}

fn apply_runtime_migrations(conn: &Connection) -> Result<(), String> {
    let _ = conn.execute_batch("ALTER TABLE tags ADD COLUMN deleted_at TEXT");
    let _ = conn.execute_batch(
        "ALTER TABLE sync_meta ADD COLUMN new_value TEXT NOT NULL DEFAULT '';",
    );
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS completion_log (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            completed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_completion_log_date ON completion_log(completed_at);"
    );
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN start_date TEXT");
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN scheduled_start TEXT");
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN scheduled_end TEXT");
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER DEFAULT 30");
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS areas (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );"
    );
    let _ = conn.execute_batch("ALTER TABLE lists ADD COLUMN area_id TEXT REFERENCES areas(id)");
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS headings (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL REFERENCES lists(id),
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_headings_list_id ON headings(list_id);"
    );
    let _ = conn.execute_batch("ALTER TABLE tasks ADD COLUMN heading_id TEXT");
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_filters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            config TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );"
    );
    Ok(())
}

/// Creates (or opens) cross2.db inside `app_data_dir`, applies PRAGMAs,
/// and runs the canonical schema.
pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_path = app_data_dir.join("cross2.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    apply_pragmas(&conn)?;

    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("Failed to execute schema: {}", e))?;
    apply_runtime_migrations(&conn)?;

    Ok(conn)
}

/// Opens an existing cross2.db with the standard PRAGMAs applied.
pub fn get_connection(app_data_dir: &Path) -> Result<Connection, String> {
    let db_path = app_data_dir.join("cross2.db");
    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    apply_pragmas(&conn)?;
    apply_runtime_migrations(&conn)?;

    Ok(conn)
}
