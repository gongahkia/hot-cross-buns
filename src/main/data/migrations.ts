import type { SqliteConnection, SqliteWriteOperation } from "./sqliteConnection";

export interface MigrationResult {
  version: number;
  appliedVersions: number[];
  durationMs: number;
}

interface Migration {
  version: number;
  name: string;
  sql?: string;
  operations?: (
    connection: SqliteConnection,
    context: LocalMigrationContext
  ) => SqliteWriteOperation[];
}

interface LocalMigrationContext {
  defaultTimeZone: string;
}

export interface LocalMigrationOptions {
  defaultTimeZone?: string | null;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "local app tables",
    sql: `
CREATE TABLE IF NOT EXISTS local_settings (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, key)
);

CREATE TABLE IF NOT EXISTS local_performance_timings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_performance_timings_recent
  ON local_performance_timings(created_at DESC, kind);
`
  },
  {
    version: 2,
    name: "local search index state",
    sql: `
CREATE TABLE IF NOT EXISTS local_search_index_state (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`
  },
  {
    version: 3,
    name: "deprecated local note links noop",
    operations: () => []
  },
  {
    version: 4,
    name: "calendar event local time zone",
    operations: (connection, context) => {
      if (!tableExists(connection, "google_calendar_events")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );
      const operations: SqliteWriteOperation[] = [];

      if (!columns.has("local_time_zone")) {
        operations.push({
          kind: "run",
          sql: "ALTER TABLE google_calendar_events ADD COLUMN local_time_zone TEXT;"
        });
      }

      operations.push({
        kind: "run",
        sql: `UPDATE google_calendar_events
              SET local_time_zone = COALESCE(
                NULLIF(start_time_zone, ''),
                NULLIF(end_time_zone, ''),
                ?
              )
              WHERE local_time_zone IS NULL OR TRIM(local_time_zone) = '';`,
        params: [context.defaultTimeZone]
      });

      return operations;
    }
  },
  {
    version: 5,
    name: "calendar event recurrence rule",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_events")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );

      return columns.has("recurrence_rule")
        ? []
        : [
            {
              kind: "run",
              sql: "ALTER TABLE google_calendar_events ADD COLUMN recurrence_rule TEXT;"
            }
          ];
    }
  },
  {
    version: 6,
    name: "diagnostic history entries",
    sql: `
CREATE TABLE IF NOT EXISTS local_history_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_id TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_local_history_entries_recent
  ON local_history_entries(timestamp DESC, id DESC);
`
  },
  {
    version: 7,
    name: "calendar event color id",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_events")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );

      return columns.has("color_id")
        ? []
        : [
            {
              kind: "run",
              sql: "ALTER TABLE google_calendar_events ADD COLUMN color_id TEXT;"
            }
          ];
    }
  },
  {
    version: 8,
    name: "calendar event color backfill resync",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_events") || !tableExists(connection, "google_sync_checkpoints")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );

      if (!columns.has("color_id")) {
        return [];
      }

      const missingColorPredicate = columns.has("deleted_at")
        ? "deleted_at IS NULL AND color_id IS NULL"
        : "color_id IS NULL";

      return [
        {
          kind: "run",
          sql: `DELETE FROM google_sync_checkpoints
                WHERE resource_type = 'calendar'
                  AND checkpoint_type = 'sync_token'
                  AND EXISTS (
                    SELECT 1
                    FROM google_calendar_events
                    WHERE ${missingColorPredicate}
                    LIMIT 1
                  );`
        }
      ];
    }
  },
  {
    version: 9,
    name: "deprecated local note lists noop",
    operations: () => []
  },
  {
    version: 10,
    name: "undo stack entries",
    sql: `
CREATE TABLE IF NOT EXISTS local_undo_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stack TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  label TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  undo_payload_json TEXT NOT NULL,
  redo_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_undo_entries_stack
  ON local_undo_entries(session_id, stack, created_at DESC, id DESC);
`
  },
  {
    version: 11,
    name: "calendar event instance completion",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_event_instances")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_event_instances);")
          .map((row) => row.name)
      );
      const operations: SqliteWriteOperation[] = [];

      if (!columns.has("completed_at")) {
        operations.push({
          kind: "run",
          sql: "ALTER TABLE google_calendar_event_instances ADD COLUMN completed_at TEXT;"
        });
      }

      operations.push({
        kind: "run",
        sql: `CREATE INDEX IF NOT EXISTS idx_google_calendar_event_instances_completion
              ON google_calendar_event_instances(event_id, completed_at, start_at, id);`
      });

      return operations;
    }
  },
  {
    version: 12,
    name: "calendar event hcb kind",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_events")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );

      return columns.has("hcb_kind")
        ? []
        : [
            {
              kind: "run",
              sql: "ALTER TABLE google_calendar_events ADD COLUMN hcb_kind TEXT;"
            }
          ];
    }
  },
  {
    version: 13,
    name: "drop deprecated local notes",
    sql: `
DROP TRIGGER IF EXISTS local_notes_fts_ai;
DROP TRIGGER IF EXISTS local_notes_fts_ad;
DROP TRIGGER IF EXISTS local_notes_fts_au;
DROP TABLE IF EXISTS local_notes_fts;
DROP TABLE IF EXISTS local_note_links;
DROP TABLE IF EXISTS local_note_properties;
DROP TABLE IF EXISTS local_note_lists;
DROP TABLE IF EXISTS local_notes;
DROP INDEX IF EXISTS idx_local_notes_updated;
DROP INDEX IF EXISTS idx_local_notes_title;
DROP INDEX IF EXISTS idx_local_notes_list;
DROP INDEX IF EXISTS idx_local_note_lists_updated;
DROP INDEX IF EXISTS idx_local_note_links_source;
DROP INDEX IF EXISTS idx_local_note_links_target;
DROP INDEX IF EXISTS idx_local_note_links_broken;
DROP INDEX IF EXISTS idx_local_note_properties_kv;
DROP INDEX IF EXISTS idx_local_note_properties_note;
`
  },
  {
    version: 14,
    name: "calendar event local tags",
    operations: (connection) => {
      if (!tableExists(connection, "google_calendar_events")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(google_calendar_events);")
          .map((row) => row.name)
      );

      return columns.has("local_tags_json")
        ? []
        : [
            {
              kind: "run",
              sql: "ALTER TABLE google_calendar_events ADD COLUMN local_tags_json TEXT NOT NULL DEFAULT '[]';"
            }
          ];
    }
  },
  {
    version: 15,
    name: "first class local tags",
    sql: `
CREATE TABLE IF NOT EXISTS local_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_entity_tags (
  tag_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tag_id, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_local_tags_visible_name
  ON local_tags(deleted_at, normalized_name);

CREATE INDEX IF NOT EXISTS idx_local_entity_tags_entity
  ON local_entity_tags(entity_kind, entity_id, tag_id);
`
    ,
    operations: (connection) => tagBackfillOperations(connection)
  },
  {
    version: 16,
    name: "agent webhooks semantic chat",
    sql: `
CREATE TABLE IF NOT EXISTS local_agent_actions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  credential_revision TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_agent_actions_status
  ON local_agent_actions(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS local_webhook_subscriptions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events_json TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  include_private_bodies INTEGER NOT NULL,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_delivery_at TEXT,
  last_error TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_webhook_subscriptions_visible
  ON local_webhook_subscriptions(deleted_at, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS local_webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  response_status INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_webhook_deliveries_recent
  ON local_webhook_deliveries(created_at DESC, subscription_id);

CREATE TABLE IF NOT EXISTS local_semantic_embeddings (
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  model_id TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  last_error TEXT,
  PRIMARY KEY(entity_kind, entity_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_local_semantic_embeddings_model
  ON local_semantic_embeddings(model_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS local_chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_chat_sessions_visible
  ON local_chat_sessions(deleted_at, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS local_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_chat_messages_session
  ON local_chat_messages(session_id, created_at ASC, id ASC);
`
  },
  {
    version: 17,
    name: "universal entity links",
    sql: `
CREATE TABLE IF NOT EXISTS local_entity_links (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_field TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  target_label TEXT NOT NULL,
  raw TEXT NOT NULL,
  alias TEXT,
  link_type TEXT NOT NULL,
  broken INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_entity_links_source
  ON local_entity_links(source_kind, source_id, source_field);

CREATE INDEX IF NOT EXISTS idx_local_entity_links_target
  ON local_entity_links(target_kind, target_id, source_kind, source_id);

CREATE INDEX IF NOT EXISTS idx_local_entity_links_broken
  ON local_entity_links(broken, target_kind, target_label);
`
  },
  {
    version: 18,
    name: "ics subscriptions",
    sql: `
CREATE TABLE IF NOT EXISTS local_ics_subscriptions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  refresh_minutes INTEGER NOT NULL DEFAULT 360,
  etag TEXT,
  last_modified TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_ics_subscriptions_url
  ON local_ics_subscriptions(url)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_local_ics_subscriptions_visible
  ON local_ics_subscriptions(deleted_at, enabled, updated_at DESC);
`
  },
  {
    version: 19,
    name: "webhook delivery retries",
    operations: (connection) => {
      if (!tableExists(connection, "local_webhook_deliveries")) {
        return [];
      }

      const columns = new Set(
        connection
          .query<{ name: string }>("PRAGMA table_info(local_webhook_deliveries);")
          .map((row) => row.name)
      );
      const operations: SqliteWriteOperation[] = [];

      if (!columns.has("payload_json")) {
        operations.push({
          kind: "run",
          sql: "ALTER TABLE local_webhook_deliveries ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';"
        });
      }

      if (!columns.has("next_attempt_at")) {
        operations.push({
          kind: "run",
          sql: "ALTER TABLE local_webhook_deliveries ADD COLUMN next_attempt_at TEXT;"
        });
      }

      if (!columns.has("last_attempt_at")) {
        operations.push({
          kind: "run",
          sql: "ALTER TABLE local_webhook_deliveries ADD COLUMN last_attempt_at TEXT;"
        });
      }

      operations.push({
        kind: "run",
        sql: `UPDATE local_webhook_deliveries
              SET next_attempt_at = created_at
              WHERE status = 'pending'
                AND next_attempt_at IS NULL;`
      });
      operations.push({
        kind: "run",
        sql: `CREATE INDEX IF NOT EXISTS idx_local_webhook_deliveries_due
              ON local_webhook_deliveries(status, next_attempt_at, created_at);`
      });

      return operations;
    }
  },
  {
    version: 20,
    name: "local hoster profiles",
    sql: `
CREATE TABLE IF NOT EXISTS local_hoster_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_local_hoster_profiles_active
  ON local_hoster_profiles(deleted_at, updated_at DESC, id DESC);
`
  }
];

export function runLocalDataMigrations(
  connection: SqliteConnection,
  options: LocalMigrationOptions = {}
): MigrationResult {
  const startedAt = Date.now();
  const context: LocalMigrationContext = {
    defaultTimeZone: normalizeTimeZone(options.defaultTimeZone)
  };

  connection.exec(`
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const appliedRows = connection.query<{ version: number }>(
    "SELECT version FROM local_schema_migrations;"
  );
  const applied = new Set(appliedRows.map((row) => row.version));
  const appliedVersions: number[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    const now = new Date().toISOString();
    const operations: SqliteWriteOperation[] = [
      ...(migration.sql === undefined
        ? []
        : [
            {
              kind: "exec" as const,
              sql: migration.sql
            }
          ]),
      ...(migration.operations?.(connection, context) ?? []),
      {
        kind: "run",
        sql: `INSERT INTO local_schema_migrations (version, name, applied_at)
              VALUES (?, ?, ?);`,
        params: [migration.version, migration.name, now]
      }
    ];

    connection.executeTransaction(operations);
    appliedVersions.push(migration.version);
  }

  return {
    version: MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0,
    appliedVersions,
    durationMs: Math.max(0, Date.now() - startedAt)
  };
}

function tableExists(connection: SqliteConnection, tableName: string): boolean {
  return connection.get<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name = ?
     LIMIT 1;`,
    [tableName]
  ) !== undefined;
}

function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = value?.trim();

  if (trimmed) {
    return trimmed;
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function tagBackfillOperations(connection: SqliteConnection): SqliteWriteOperation[] {
  const now = new Date().toISOString();
  const refs: Array<{ entityId: string; kind: "task" | "event" | "note"; tag: string }> = [];

  if (tableExists(connection, "google_tasks")) {
    for (const row of connection.query<{
      id: string;
      status: string;
      dueAt: string | null;
      parentId: string | null;
      deletedAt: string | null;
      isHidden: number;
      tagsJson: string | null;
    }>(
      `SELECT
         id,
         status,
         due_at AS dueAt,
         parent_task_id AS parentId,
         deleted_at AS deletedAt,
         is_hidden AS isHidden,
         local_tags_json AS tagsJson
       FROM google_tasks
       WHERE local_tags_json IS NOT NULL;`
    )) {
      const kind: "task" | "note" = row.deletedAt == null &&
        row.isHidden !== 1 &&
        row.status !== "completed" &&
        row.parentId === null &&
        row.dueAt === null
        ? "note"
        : "task";
      refs.push(...parseTagJson(row.tagsJson).map((tag) => ({ entityId: row.id, kind, tag })));
    }
  }

  if (tableExists(connection, "google_calendar_events")) {
    for (const row of connection.query<{ id: string; tagsJson: string | null }>(
      `SELECT id, local_tags_json AS tagsJson
       FROM google_calendar_events
       WHERE local_tags_json IS NOT NULL;`
    )) {
      refs.push(...parseTagJson(row.tagsJson).map((tag) => ({ entityId: row.id, kind: "event" as const, tag })));
    }
  }

  const operations: SqliteWriteOperation[] = [];
  const seenTags = new Set<string>();
  const seenRefs = new Set<string>();

  for (const ref of refs) {
    const normalized = normalizeTagName(ref.tag);

    if (!normalized) {
      continue;
    }

    const tagId = tagIdForName(normalized);

    if (!seenTags.has(normalized)) {
      seenTags.add(normalized);
      operations.push({
        kind: "run",
        sql: `INSERT INTO local_tags (id, name, normalized_name, color, created_at, updated_at, deleted_at)
              VALUES (?, ?, ?, NULL, ?, ?, NULL)
              ON CONFLICT(normalized_name) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at,
                deleted_at = NULL;`,
        params: [tagId, ref.tag.trim(), normalized, now, now]
      });
    }

    const refKey = `${tagId}|${ref.kind}|${ref.entityId}`;
    if (seenRefs.has(refKey)) {
      continue;
    }

    seenRefs.add(refKey);
    operations.push({
      kind: "run",
      sql: `INSERT OR IGNORE INTO local_entity_tags (tag_id, entity_kind, entity_id, created_at)
            VALUES (?, ?, ?, ?);`,
      params: [tagId, ref.kind, ref.entityId, now]
    });
  }

  return operations;
}

function parseTagJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeTagName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function tagIdForName(normalized: string): string {
  let hash = 2166136261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `tag:${(hash >>> 0).toString(36)}`;
}
