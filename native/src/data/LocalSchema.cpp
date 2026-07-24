#include "data/LocalSchema.h"

#include "sqlite3.h"

#include <QCryptographicHash>

#include <array>
#include <optional>

namespace hcb {
namespace {

constexpr char settingsSchemaSql[] = R"(
CREATE TABLE local_settings (
  scope TEXT NOT NULL CHECK(length(trim(scope)) > 0),
  key TEXT NOT NULL CHECK(length(trim(key)) > 0),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) > 0),
  PRIMARY KEY(scope, key)
) STRICT, WITHOUT ROWID
)";

constexpr char accountSchemaSql[] = R"(
CREATE TABLE local_accounts (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 256),
  provider TEXT NOT NULL CHECK(provider = 'google'),
  provider_account_id TEXT CHECK(provider_account_id IS NULL OR length(trim(provider_account_id)) BETWEEN 1 AND 256),
  email TEXT CHECK(email IS NULL OR length(trim(email)) BETWEEN 1 AND 254),
  display_name TEXT CHECK(display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 256),
  avatar_url TEXT CHECK(avatar_url IS NULL OR length(trim(avatar_url)) BETWEEN 1 AND 2048),
  locale TEXT CHECK(locale IS NULL OR length(trim(locale)) BETWEEN 1 AND 64),
  time_zone TEXT CHECK(time_zone IS NULL OR length(trim(time_zone)) BETWEEN 1 AND 128),
  connection_state TEXT NOT NULL CHECK(connection_state IN ('signed_out', 'connected', 'reauth_required', 'sync_paused')),
  granted_scopes_json TEXT NOT NULL CHECK(length(granted_scopes_json) <= 8192 AND json_valid(granted_scopes_json) AND json_type(granted_scopes_json) = 'array' AND json_array_length(granted_scopes_json) <= 20),
  missing_scopes_json TEXT NOT NULL CHECK(length(missing_scopes_json) <= 8192 AND json_valid(missing_scopes_json) AND json_type(missing_scopes_json) = 'array' AND json_array_length(missing_scopes_json) <= 20),
  last_authenticated_at TEXT CHECK(last_authenticated_at IS NULL OR length(trim(last_authenticated_at)) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) BETWEEN 1 AND 64),
  deleted_at TEXT CHECK(deleted_at IS NULL OR length(trim(deleted_at)) BETWEEN 1 AND 64),
  UNIQUE(provider, provider_account_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX local_accounts_active_recency
ON local_accounts(connection_state, updated_at DESC, id)
WHERE deleted_at IS NULL
)";

constexpr char taskListSchemaSql[] = R"(
CREATE TABLE local_task_lists (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 256),
  account_id TEXT NOT NULL REFERENCES local_accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  remote_id TEXT NOT NULL CHECK(length(trim(remote_id)) BETWEEN 1 AND 256),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 1024),
  etag TEXT CHECK(etag IS NULL OR length(etag) <= 4096),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_selected INTEGER NOT NULL DEFAULT 1 CHECK(is_selected IN (0, 1)),
  remote_updated_at TEXT CHECK(remote_updated_at IS NULL OR length(trim(remote_updated_at)) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) BETWEEN 1 AND 64),
  deleted_at TEXT CHECK(deleted_at IS NULL OR length(trim(deleted_at)) BETWEEN 1 AND 64),
  UNIQUE(account_id, remote_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX local_task_lists_active_navigation
ON local_task_lists(account_id, is_selected DESC, sort_order, title COLLATE NOCASE, id)
WHERE deleted_at IS NULL
)";

constexpr char taskSchemaSql[] = R"(
CREATE TABLE local_tasks (
  id TEXT PRIMARY KEY CHECK(length(trim(id)) BETWEEN 1 AND 256),
  task_list_id TEXT NOT NULL REFERENCES local_task_lists(id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  remote_id TEXT NOT NULL CHECK(length(trim(remote_id)) BETWEEN 1 AND 256),
  parent_task_id TEXT REFERENCES local_tasks(id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED CHECK(parent_task_id IS NULL OR parent_task_id != id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  notes TEXT CHECK(notes IS NULL OR length(notes) <= 10000),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'completed')),
  due_at TEXT CHECK(due_at IS NULL OR length(trim(due_at)) BETWEEN 1 AND 64),
  due_time_zone TEXT CHECK(due_time_zone IS NULL OR length(trim(due_time_zone)) BETWEEN 1 AND 128),
  completed_at TEXT CHECK(completed_at IS NULL OR length(trim(completed_at)) BETWEEN 1 AND 64),
  remote_position TEXT CHECK(remote_position IS NULL OR length(remote_position) <= 256),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK(is_hidden IN (0, 1)),
  priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none', 'low', 'medium', 'high')),
  planned_start_at TEXT CHECK(planned_start_at IS NULL OR length(trim(planned_start_at)) BETWEEN 1 AND 64),
  planned_end_at TEXT CHECK(planned_end_at IS NULL OR length(trim(planned_end_at)) BETWEEN 1 AND 64),
  duration_minutes INTEGER CHECK(duration_minutes IS NULL OR duration_minutes >= 0),
  is_schedule_locked INTEGER NOT NULL DEFAULT 0 CHECK(is_schedule_locked IN (0, 1)),
  snoozed_until TEXT CHECK(snoozed_until IS NULL OR length(trim(snoozed_until)) BETWEEN 1 AND 64),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(length(tags_json) <= 8192 AND json_valid(tags_json) AND json_type(tags_json) = 'array' AND json_array_length(tags_json) <= 64),
  etag TEXT CHECK(etag IS NULL OR length(etag) <= 4096),
  remote_updated_at TEXT CHECK(remote_updated_at IS NULL OR length(trim(remote_updated_at)) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK(length(trim(created_at)) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) BETWEEN 1 AND 64),
  deleted_at TEXT CHECK(deleted_at IS NULL OR length(trim(deleted_at)) BETWEEN 1 AND 64),
  UNIQUE(task_list_id, remote_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX local_tasks_active_navigation
ON local_tasks(task_list_id, is_hidden, state, due_at, sort_order, updated_at DESC, id)
WHERE deleted_at IS NULL AND parent_task_id IS NULL;

CREATE INDEX local_tasks_active_subtasks
ON local_tasks(parent_task_id, is_hidden, sort_order, id)
WHERE deleted_at IS NULL;

CREATE TRIGGER local_tasks_validate_parent_insert
BEFORE INSERT ON local_tasks
WHEN NEW.parent_task_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM local_tasks AS parent
    WHERE parent.id = NEW.parent_task_id AND parent.task_list_id != NEW.task_list_id
  ) THEN RAISE(ABORT, 'Task parent must belong to the same list') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE ancestors(id, parent_task_id) AS (
      SELECT id, parent_task_id FROM local_tasks WHERE id = NEW.parent_task_id
      UNION ALL
      SELECT task.id, task.parent_task_id
      FROM local_tasks AS task
      JOIN ancestors ON task.id = ancestors.parent_task_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE(ABORT, 'Task parent cycle') END;
END;

CREATE TRIGGER local_tasks_validate_parent_update
BEFORE UPDATE OF parent_task_id, task_list_id ON local_tasks
BEGIN
  SELECT CASE WHEN NEW.parent_task_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM local_tasks AS parent
    WHERE parent.id = NEW.parent_task_id AND parent.task_list_id != NEW.task_list_id
  ) THEN RAISE(ABORT, 'Task parent must belong to the same list') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM local_tasks AS child
    WHERE child.parent_task_id = NEW.id AND child.task_list_id != NEW.task_list_id
  ) THEN RAISE(ABORT, 'Task children must belong to the same list') END;
  SELECT CASE WHEN NEW.parent_task_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors(id, parent_task_id) AS (
      SELECT id, parent_task_id FROM local_tasks WHERE id = NEW.parent_task_id
      UNION ALL
      SELECT task.id, task.parent_task_id
      FROM local_tasks AS task
      JOIN ancestors ON task.id = ancestors.parent_task_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE(ABORT, 'Task parent cycle') END;
END
)";

[[nodiscard]] QString checksum(const char* sql) {
  return QString::fromLatin1(
      QCryptographicHash::hash(QByteArray(sql), QCryptographicHash::Algorithm::Sha256).toHex());
}

[[nodiscard]] std::optional<AppError>
applySchema(SqliteConnection& connection, const char* sql, const QString& description) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    description + QStringLiteral(" connection is unavailable"));
  }
  char* errorMessage = nullptr;
  const int result = sqlite3_exec(handle, sql, nullptr, nullptr, &errorMessage);
  sqlite3_free(errorMessage);
  if (result != SQLITE_OK) {
    return AppError(AppErrorCode::Database,
                    description + QStringLiteral(" setup failed (%1)").arg(result));
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError> applySettingsSchema(SqliteConnection& connection) {
  return applySchema(connection, settingsSchemaSql, QStringLiteral("SQLite settings schema"));
}

[[nodiscard]] std::optional<AppError> applyAccountSchema(SqliteConnection& connection) {
  return applySchema(connection, accountSchemaSql, QStringLiteral("SQLite account schema"));
}

[[nodiscard]] std::optional<AppError> applyTaskListSchema(SqliteConnection& connection) {
  return applySchema(connection, taskListSchemaSql, QStringLiteral("SQLite task-list schema"));
}

[[nodiscard]] std::optional<AppError> applyTaskSchema(SqliteConnection& connection) {
  return applySchema(connection, taskSchemaSql, QStringLiteral("SQLite task schema"));
}

[[nodiscard]] const std::array<SqliteMigration, 4>& migrations() {
  static const std::array<SqliteMigration, 4> catalogue = {{
      {1,
       QStringLiteral("create local settings"),
       checksum(settingsSchemaSql),
       applySettingsSchema},
      {2, QStringLiteral("create local accounts"), checksum(accountSchemaSql), applyAccountSchema},
      {3,
       QStringLiteral("create local task lists"),
       checksum(taskListSchemaSql),
       applyTaskListSchema},
      {4, QStringLiteral("create local tasks"), checksum(taskSchemaSql), applyTaskSchema},
  }};
  return catalogue;
}

} // namespace

SqliteMigrationRunResultOrError LocalSchema::initialize(SqliteConnection& connection) {
  return SqliteMigrationRunner::run(connection, migrations());
}

} // namespace hcb
