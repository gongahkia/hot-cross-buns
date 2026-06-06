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
