import type { SqliteConnection } from "../../data/sqliteConnection";

export function ensureGoogleSyncSchema(connection: SqliteConnection, defaultTimeZone: string): void {
  connection.exec(GOOGLE_SYNC_SCHEMA);
  ensureTaskColumns(connection);
  ensureEventColumns(connection, defaultTimeZone);
  ensureEventInstanceColumns(connection);
  ensureSearchIndexes(connection);
}

function ensureTaskColumns(connection: SqliteConnection): void {
  const existingColumns = new Set(
    connection.query<{ name: string }>("PRAGMA table_info(google_tasks);").map((row) => row.name)
  );

  if (!existingColumns.has("local_priority")) {
    connection.exec("ALTER TABLE google_tasks ADD COLUMN local_priority TEXT NOT NULL DEFAULT 'none';");
  }

  const addColumn = (name: string, definition: string) => {
    if (!existingColumns.has(name)) {
      connection.exec(`ALTER TABLE google_tasks ADD COLUMN ${definition};`);
      existingColumns.add(name);
    }
  };

  addColumn("local_planned_start", "local_planned_start TEXT");
  addColumn("local_planned_end", "local_planned_end TEXT");
  addColumn("local_duration_minutes", "local_duration_minutes INTEGER");
  addColumn("local_locked_schedule", "local_locked_schedule INTEGER NOT NULL DEFAULT 0");
  addColumn("local_snooze_until", "local_snooze_until TEXT");
  addColumn("local_tags_json", "local_tags_json TEXT NOT NULL DEFAULT '[]'");
}

function ensureEventColumns(connection: SqliteConnection, defaultTimeZone: string): void {
  const existingColumns = new Set(
    connection
      .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
      .map((row) => row.name)
  );
  const addColumn = (name: string, definition: string) => {
    if (!existingColumns.has(name)) {
      connection.exec(`ALTER TABLE google_calendar_events ADD COLUMN ${definition};`);
      existingColumns.add(name);
    }
  };

  addColumn("attendee_emails_json", "attendee_emails_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("attendee_details_json", "attendee_details_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("reminder_minutes_json", "reminder_minutes_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("reminders_json", "reminders_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("reminders_use_default", "reminders_use_default INTEGER NOT NULL DEFAULT 0");
  addColumn("conference_json", "conference_json TEXT");
  addColumn("recurrence_rule", "recurrence_rule TEXT");
  addColumn("local_time_zone", "local_time_zone TEXT");
  addColumn("hcb_kind", "hcb_kind TEXT");
  addColumn("local_tags_json", "local_tags_json TEXT NOT NULL DEFAULT '[]'");

  connection.run(
    `UPDATE google_calendar_events
     SET local_time_zone = COALESCE(NULLIF(start_time_zone, ''), NULLIF(end_time_zone, ''), ?)
     WHERE local_time_zone IS NULL OR TRIM(local_time_zone) = '';`,
    [defaultTimeZone]
  );
}

function ensureEventInstanceColumns(connection: SqliteConnection): void {
  const existingColumns = new Set(
    connection
      .query<{ name: string }>("PRAGMA table_info(google_calendar_event_instances);")
      .map((row) => row.name)
  );

  if (!existingColumns.has("completed_at")) {
    connection.exec("ALTER TABLE google_calendar_event_instances ADD COLUMN completed_at TEXT;");
  }

  connection.exec(
    `CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_completion
       ON google_calendar_event_instances(event_id, completed_at, start_at, id);`
  );
}

function ensureSearchIndexes(connection: SqliteConnection): void {
  const stateName = "google-fts-v1";
  const current = connection.get<{ version: number }>(
    `SELECT version
     FROM local_search_index_state
     WHERE name = ?
     LIMIT 1;`,
    [stateName]
  );

  if (current?.version === 1) {
    return;
  }

  for (const table of [
    "google_task_lists_fts",
    "google_tasks_fts",
    "google_calendar_lists_fts",
    "google_calendar_events_fts"
  ]) {
    connection.run(`INSERT INTO ${table}(${table}) VALUES ('rebuild');`);
  }

  connection.run(
    `INSERT INTO local_search_index_state (name, version, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at;`,
    [stateName, 1, new Date().toISOString()]
  );
}

const GOOGLE_SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS local_search_index_state (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_accounts (
  id TEXT PRIMARY KEY,
  google_account_id TEXT,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT,
  time_zone TEXT,
  connection_state TEXT NOT NULL,
  granted_scopes_json TEXT NOT NULL,
  missing_scopes_json TEXT NOT NULL,
  last_authenticated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS google_task_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  title TEXT NOT NULL,
  etag TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_selected INTEGER NOT NULL DEFAULT 1,
  sync_status TEXT NOT NULL DEFAULT 'synced',
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_task_lists_visible_sort
  ON google_task_lists(deleted_at, sort_order, title, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_task_lists_fts
  USING fts5(title, content='google_task_lists', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_ai
AFTER INSERT ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_ad
AFTER DELETE ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(google_task_lists_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS google_task_lists_fts_au
AFTER UPDATE ON google_task_lists
BEGIN
  INSERT INTO google_task_lists_fts(google_task_lists_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO google_task_lists_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

CREATE TABLE IF NOT EXISTS google_tasks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  task_list_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  due_time_zone TEXT,
  completed_at TEXT,
  position TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  local_priority TEXT NOT NULL DEFAULT 'none',
  local_planned_start TEXT,
  local_planned_end TEXT,
  local_duration_minutes INTEGER,
  local_locked_schedule INTEGER NOT NULL DEFAULT 0,
  local_snooze_until TEXT,
  local_tags_json TEXT NOT NULL DEFAULT '[]',
  etag TEXT,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, task_list_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_tasks_list_status_due
  ON google_tasks(account_id, task_list_id, status, due_at, sort_order);

CREATE INDEX IF NOT EXISTS idx_google_tasks_visible_list_due
  ON google_tasks(task_list_id, deleted_at, is_hidden, status, due_at, sort_order, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_google_tasks_counts_by_list
  ON google_tasks(task_list_id, deleted_at, is_hidden, status);

CREATE INDEX IF NOT EXISTS idx_google_tasks_parent_visible
  ON google_tasks(parent_task_id, deleted_at, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_google_tasks_search_recent
  ON google_tasks(deleted_at, is_hidden, updated_at DESC, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_tasks_fts
  USING fts5(title, notes, content='google_tasks', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_ai
AFTER INSERT ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(rowid, title, notes)
  VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_ad
AFTER DELETE ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(google_tasks_fts, rowid, title, notes)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_tasks_fts_au
AFTER UPDATE ON google_tasks
BEGIN
  INSERT INTO google_tasks_fts(google_tasks_fts, rowid, title, notes)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
  INSERT INTO google_tasks_fts(rowid, title, notes)
  VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

CREATE TABLE IF NOT EXISTS google_calendar_lists (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  time_zone TEXT,
  background_color TEXT,
  foreground_color TEXT,
  access_role TEXT,
  is_selected INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_lists_visible
  ON google_calendar_lists(deleted_at, is_hidden, is_primary, summary, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_calendar_lists_fts
  USING fts5(summary, content='google_calendar_lists', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_ai
AFTER INSERT ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(rowid, summary)
  VALUES (new.rowid, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_ad
AFTER DELETE ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(google_calendar_lists_fts, rowid, summary)
  VALUES ('delete', old.rowid, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_lists_fts_au
AFTER UPDATE ON google_calendar_lists
BEGIN
  INSERT INTO google_calendar_lists_fts(google_calendar_lists_fts, rowid, summary)
  VALUES ('delete', old.rowid, old.summary);
  INSERT INTO google_calendar_lists_fts(rowid, summary)
  VALUES (new.rowid, new.summary);
END;

CREATE TABLE IF NOT EXISTS google_calendar_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  google_id TEXT NOT NULL,
  recurring_event_id TEXT,
  original_start_at TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  start_time_zone TEXT,
  end_at TEXT NOT NULL,
  end_time_zone TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT,
  color_id TEXT,
  transparency TEXT,
  visibility TEXT,
  local_time_zone TEXT,
  hcb_kind TEXT,
  local_tags_json TEXT NOT NULL DEFAULT '[]',
  attendee_emails_json TEXT NOT NULL DEFAULT '[]',
  attendee_details_json TEXT NOT NULL DEFAULT '[]',
  reminder_minutes_json TEXT NOT NULL DEFAULT '[]',
  reminders_json TEXT NOT NULL DEFAULT '[]',
  reminders_use_default INTEGER NOT NULL DEFAULT 0,
  conference_json TEXT,
  etag TEXT,
  sequence INTEGER,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, calendar_id, google_id)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_range
  ON google_calendar_events(account_id, calendar_id, start_at, end_at, status);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_visible_range
  ON google_calendar_events(calendar_id, deleted_at, status, start_at, end_at, id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_search_recent
  ON google_calendar_events(deleted_at, status, updated_at DESC, id);

CREATE VIRTUAL TABLE IF NOT EXISTS google_calendar_events_fts
  USING fts5(summary, description, location, content='google_calendar_events', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_ai
AFTER INSERT ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(rowid, summary, description, location)
  VALUES (new.rowid, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_ad
AFTER DELETE ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(google_calendar_events_fts, rowid, summary, description, location)
  VALUES ('delete', old.rowid, old.summary, COALESCE(old.description, ''), COALESCE(old.location, ''));
END;

CREATE TRIGGER IF NOT EXISTS google_calendar_events_fts_au
AFTER UPDATE ON google_calendar_events
BEGIN
  INSERT INTO google_calendar_events_fts(google_calendar_events_fts, rowid, summary, description, location)
  VALUES ('delete', old.rowid, old.summary, COALESCE(old.description, ''), COALESCE(old.location, ''));
  INSERT INTO google_calendar_events_fts(rowid, summary, description, location)
  VALUES (new.rowid, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''));
END;

CREATE TABLE IF NOT EXISTS google_calendar_event_instances (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  recurring_event_id TEXT,
  original_start_at TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(account_id, calendar_id, event_id, start_at)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_visible_range
  ON google_calendar_event_instances(calendar_id, deleted_at, status, start_at, end_at, id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_event
  ON google_calendar_event_instances(event_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_completion
  ON google_calendar_event_instances(event_id, completed_at, start_at, id);

CREATE TABLE IF NOT EXISTS local_scheduled_task_blocks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  calendar_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(task_id, calendar_event_id)
);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_range
  ON local_scheduled_task_blocks(calendar_id, deleted_at, planned_start_at, planned_end_at, id);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_task
  ON local_scheduled_task_blocks(task_id, deleted_at, planned_start_at);

CREATE INDEX IF NOT EXISTS idx_local_scheduled_task_blocks_event
  ON local_scheduled_task_blocks(calendar_event_id, deleted_at);

CREATE TABLE IF NOT EXISTS google_sync_checkpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  checkpoint_type TEXT NOT NULL,
  checkpoint_value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_successful_sync_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, resource_type, resource_id, checkpoint_type)
);

CREATE INDEX IF NOT EXISTS idx_google_sync_checkpoints_lookup
  ON google_sync_checkpoints(account_id, resource_type, resource_id, checkpoint_type);

CREATE TABLE IF NOT EXISTS google_sync_diagnostics (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  last_error_code TEXT,
  retry_after_ms INTEGER,
  task_list_count INTEGER,
  task_count INTEGER,
  calendar_list_count INTEGER,
  event_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_google_sync_diagnostics_started
  ON google_sync_diagnostics(started_at DESC);

CREATE TABLE IF NOT EXISTS google_sync_progress_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource TEXT,
  stage TEXT,
  completed_count INTEGER,
  total_count INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  retry_after_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_pending_mutations (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_pending_mutations_status_retry
  ON google_pending_mutations(status, next_retry_at, resource_type);

CREATE INDEX IF NOT EXISTS idx_google_pending_mutations_resource
  ON google_pending_mutations(resource_type, resource_id, status, created_at);
`;
