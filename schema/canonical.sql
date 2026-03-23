-- Cross 2 canonical schema (SQLite)
-- All clients must implement this schema locally.

PRAGMA foreign_keys = ON;

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
    created_at TEXT NOT NULL
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
    updated_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
