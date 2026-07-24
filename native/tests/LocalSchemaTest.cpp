#include <QtTest/QTest>

#include <memory>
#include <optional>
#include <utility>
#include <variant>
#include <vector>

#include "data/LocalSchema.h"
#include "sqlite3.h"
#include "support/TemporarySqliteDatabase.h"

class LocalSchemaTest final : public QObject {
  Q_OBJECT

private slots:
  void createsSettingsSchemaAndRecordsMigration();
  void enforcesSettingsIntegrity();
  void createsAccountMetadataSchemaAndEnforcesIntegrity();
  void createsTaskListSchemaAndEnforcesIntegrity();
  void createsTaskAndSubtaskSchemaAndEnforcesIntegrity();
  void createsCalendarSchemaAndEnforcesIntegrity();
  void createsCalendarEventSchemaAndEnforcesIntegrity();
  void createsTaskBackedNoteProjectionAndIndex();
};

namespace {

[[nodiscard]] std::unique_ptr<hcb::test::TemporarySqliteDatabase> createDatabase() {
  hcb::test::TemporarySqliteDatabaseResult result = hcb::test::TemporarySqliteDatabase::create();
  if (std::holds_alternative<hcb::AppError>(result)) {
    return nullptr;
  }
  return std::move(std::get<std::unique_ptr<hcb::test::TemporarySqliteDatabase>>(result));
}

[[nodiscard]] std::optional<hcb::SqliteConnection>
openConnection(const hcb::test::TemporarySqliteDatabase& database) {
  hcb::SqliteConnectionResult result = database.open(hcb::SqliteOpenMode::ReadWriteCreate);
  if (std::holds_alternative<hcb::AppError>(result)) {
    return std::nullopt;
  }
  return std::move(std::get<hcb::SqliteConnection>(result));
}

[[nodiscard]] int scalar(sqlite3* handle, const char* sql) {
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    return -1;
  }
  const int stepResult = sqlite3_step(statement);
  const int value = sqlite3_column_int(statement, 0);
  const int finalizeResult = sqlite3_finalize(statement);
  return stepResult == SQLITE_ROW && finalizeResult == SQLITE_OK ? value : -1;
}

[[nodiscard]] int execute(sqlite3* handle, const char* sql) {
  char* errorMessage = nullptr;
  const int result = sqlite3_exec(handle, sql, nullptr, nullptr, &errorMessage);
  sqlite3_free(errorMessage);
  return result;
}

[[nodiscard]] std::optional<QString> scalarText(sqlite3* handle, const char* sql) {
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    return std::nullopt;
  }
  const int stepResult = sqlite3_step(statement);
  const char* const value = reinterpret_cast<const char*>(sqlite3_column_text(statement, 0));
  const int valueSize = sqlite3_column_bytes(statement, 0);
  std::optional<QString> result = stepResult == SQLITE_ROW && value != nullptr
                                      ? std::optional<QString>(QString::fromUtf8(value, valueSize))
                                      : std::nullopt;
  const int finalizeResult = sqlite3_finalize(statement);
  if (!result.has_value() || finalizeResult != SQLITE_OK) {
    return std::nullopt;
  }
  return result;
}

} // namespace

void LocalSchemaTest::createsSettingsSchemaAndRecordsMigration() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }

  hcb::SqliteMigrationRunResultOrError firstResult = hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(firstResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(firstResult)) {
    return;
  }
  const hcb::SqliteMigrationRunResult first =
      std::get<hcb::SqliteMigrationRunResult>(std::move(firstResult));
  QCOMPARE(first.version, 7);
  QCOMPARE(first.appliedVersions, std::vector<int>({1, 2, 3, 4, 5, 6, 7}));
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' "
                  "AND name = 'local_settings'"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 1 "
                  "AND name = 'create local settings' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 2 "
                  "AND name = 'create local accounts' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 3 "
                  "AND name = 'create local task lists' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 4 "
                  "AND name = 'create local tasks' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 5 "
                  "AND name = 'create local calendars' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 6 "
                  "AND name = 'create local calendar events' AND length(checksum) = 64"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 7 "
                  "AND name = 'create local note projection' AND length(checksum) = 64"),
           1);
  const std::optional<QString> settingsSchema = scalarText(
      connection->nativeHandle(), "SELECT sql FROM sqlite_master WHERE name = 'local_settings'");
  QVERIFY(settingsSchema.has_value());
  if (!settingsSchema.has_value()) {
    return;
  }
  QVERIFY(settingsSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));

  hcb::SqliteMigrationRunResultOrError secondResult = hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(secondResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(secondResult)) {
    return;
  }
  const hcb::SqliteMigrationRunResult second =
      std::get<hcb::SqliteMigrationRunResult>(std::move(secondResult));
  QCOMPARE(second.version, 7);
  QVERIFY(second.appliedVersions.empty());
}

void LocalSchemaTest::enforcesSettingsIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_settings (scope, key, value_json, updated_at) "
                   "VALUES ('appearance', 'theme', '\"system\"', '2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_settings (scope, key, value_json, updated_at) "
                   "VALUES ('appearance', 'theme', '\"dark\"', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_settings (scope, key, value_json, updated_at) "
                   "VALUES ('appearance', 'bad-json', 'not-json', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_settings (scope, key, value_json, updated_at) "
                   "VALUES (' ', 'empty-scope', 'true', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_settings (scope, key, value_json, updated_at) "
                   "VALUES ('appearance', 'empty-time', 'true', ' ')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_settings"), 1);
}

void LocalSchemaTest::createsAccountMetadataSchemaAndEnforcesIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, provider_account_id, email, "
                   "connection_state, granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'google-1', 'person@example.com', "
                   "'connected', '[\"openid\"]', '[]', '2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, provider_account_id, "
                   "connection_state, granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-2', 'google', 'google-1', 'signed_out', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-3', 'google', 'unknown', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-4', 'google', 'signed_out', '{}', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_accounts"), 1);
  const std::optional<QString> accountSchema =
      scalarText(handle, "SELECT sql FROM sqlite_master WHERE name = 'local_accounts'");
  QVERIFY(accountSchema.has_value());
  if (!accountSchema.has_value()) {
    return;
  }
  QVERIFY(accountSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));
  QVERIFY(!accountSchema->contains(QStringLiteral("token"), Qt::CaseInsensitive));
}

void LocalSchemaTest::createsTaskListSchemaAndEnforcesIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'connected', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-1', 'account-1', 'google-list-1', 'Inbox', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-2', 'account-1', 'google-list-1', 'Duplicate', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, is_selected, "
                   "updated_at) VALUES ('list-3', 'account-1', 'google-list-3', 'Bad selection', "
                   "2, '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-4', 'missing-account', 'google-list-4', 'Orphan', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_task_lists"), 1);
  const std::optional<QString> taskListSchema =
      scalarText(handle, "SELECT sql FROM sqlite_master WHERE name = 'local_task_lists'");
  QVERIFY(taskListSchema.has_value());
  if (!taskListSchema.has_value()) {
    return;
  }
  QVERIFY(taskListSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));
}

void LocalSchemaTest::createsTaskAndSubtaskSchemaAndEnforcesIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'connected', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-1', 'account-1', 'google-list-1', 'Inbox', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-2', 'account-1', 'google-list-2', 'Later', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_tasks (id, task_list_id, remote_id, title, updated_at) "
                   "VALUES ('task-1', 'list-1', 'google-task-1', 'Parent', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_tasks (id, task_list_id, remote_id, parent_task_id, title, "
                   "updated_at) VALUES ('task-2', 'list-1', 'google-task-2', 'task-1', 'Child', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_tasks (id, task_list_id, remote_id, title, updated_at) "
                   "VALUES ('task-3', 'list-1', 'google-task-1', 'Duplicate', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_tasks (id, task_list_id, remote_id, parent_task_id, title, "
              "updated_at) VALUES ('task-4', 'list-2', 'google-task-4', 'task-1', 'Cross list', "
              "'2026-07-24T00:00:00Z')"),
      SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle, "UPDATE local_tasks SET parent_task_id = 'task-2' WHERE id = 'task-1'"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_tasks (id, task_list_id, remote_id, title, tags_json, "
                   "updated_at) VALUES ('task-5', 'list-1', 'google-task-5', 'Bad tags', '{}', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_tasks"), 2);
  const std::optional<QString> taskSchema =
      scalarText(handle, "SELECT sql FROM sqlite_master WHERE name = 'local_tasks'");
  QVERIFY(taskSchema.has_value());
  if (!taskSchema.has_value()) {
    return;
  }
  QVERIFY(taskSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));
}

void LocalSchemaTest::createsCalendarSchemaAndEnforcesIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'connected', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendars (id, account_id, remote_id, title, "
                   "background_color, foreground_color, access_role, is_primary, updated_at) "
                   "VALUES ('calendar-1', 'account-1', 'google-calendar-1', 'Primary', "
                   "'#112233', '#ffffff', 'owner', 1, '2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendars (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('calendar-2', 'account-1', 'google-calendar-1', 'Duplicate', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendars (id, account_id, remote_id, title, is_primary, "
                   "updated_at) VALUES ('calendar-3', 'account-1', 'google-calendar-3', 'Second', "
                   "1, '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_calendars (id, account_id, remote_id, title, background_color, "
              "updated_at) VALUES ('calendar-4', 'account-1', 'google-calendar-4', 'Bad color', "
              "'#bad', '2026-07-24T00:00:00Z')"),
      SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendars (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('calendar-5', 'missing-account', 'google-calendar-5', 'Orphan', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_calendars"), 1);
  const std::optional<QString> calendarSchema =
      scalarText(handle, "SELECT sql FROM sqlite_master WHERE name = 'local_calendars'");
  QVERIFY(calendarSchema.has_value());
  if (!calendarSchema.has_value()) {
    return;
  }
  QVERIFY(calendarSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));
}

void LocalSchemaTest::createsCalendarEventSchemaAndEnforcesIntegrity() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'connected', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendars (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('calendar-1', 'account-1', 'google-calendar-1', 'Primary', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, "
                   "recurring_remote_id, original_start_at, title, start_at, end_at, "
                   "attendee_emails_json, attendee_details_json, reminders_json, updated_at) "
                   "VALUES ('event-1', 'calendar-1', 'google-event-1', 'google-series-1', "
                   "'2026-07-24T09:00:00Z', 'Planning', '2026-07-24T09:00:00Z', "
                   "'2026-07-24T10:00:00Z', '[\"person@example.com\"]', "
                   "'[{\"email\":\"person@example.com\"}]', "
                   "'[{\"method\":\"popup\",\"minutes\":15}]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, title, "
                   "start_at, end_at, updated_at) VALUES ('event-2', 'calendar-1', "
                   "'google-event-1', 'Duplicate', '2026-07-24T11:00:00Z', "
                   "'2026-07-24T12:00:00Z', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, title, start_at, end_at, "
                   "updated_at) VALUES ('event-pending', 'calendar-1', 'Offline create', "
                   "'2026-07-24T11:00:00Z', '2026-07-24T12:00:00Z', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, status, title, "
                   "start_at, end_at, updated_at) VALUES ('event-cancelled', 'calendar-1', "
                   "'google-event-cancelled', 'cancelled', 'Cancelled tombstone', "
                   "'2026-07-24T00:00:00Z', '2026-07-24T00:00:00Z', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, title, "
                   "start_at, end_at, updated_at) VALUES ('event-3', 'calendar-1', "
                   "'google-event-3', 'Invalid range', '2026-07-24T12:00:00Z', "
                   "'2026-07-24T11:00:00Z', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, title, "
                   "start_at, end_at, attendee_details_json, updated_at) VALUES ('event-4', "
                   "'calendar-1', 'google-event-4', 'Bad attendees', '2026-07-24T13:00:00Z', "
                   "'2026-07-24T14:00:00Z', '{}', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_calendar_events (id, calendar_id, remote_id, title, "
                   "start_at, end_at, updated_at) VALUES ('event-5', 'missing-calendar', "
                   "'google-event-5', 'Orphan', '2026-07-24T13:00:00Z', "
                   "'2026-07-24T14:00:00Z', '2026-07-24T00:00:00Z')"),
           SQLITE_CONSTRAINT);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_calendar_events"), 3);
  const std::optional<QString> eventSchema =
      scalarText(handle, "SELECT sql FROM sqlite_master WHERE name = 'local_calendar_events'");
  QVERIFY(eventSchema.has_value());
  if (!eventSchema.has_value()) {
    return;
  }
  QVERIFY(eventSchema->contains(QStringLiteral("STRICT, WITHOUT ROWID")));
}

void LocalSchemaTest::createsTaskBackedNoteProjectionAndIndex() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  std::optional<hcb::SqliteConnection> connection = openConnection(*database);
  QVERIFY(connection.has_value());
  if (!connection.has_value()) {
    return;
  }
  const hcb::SqliteMigrationRunResultOrError schemaResult =
      hcb::LocalSchema::initialize(*connection);
  QVERIFY(std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult));
  if (!std::holds_alternative<hcb::SqliteMigrationRunResult>(schemaResult)) {
    return;
  }

  sqlite3* const handle = connection->nativeHandle();
  QCOMPARE(execute(handle,
                   "INSERT INTO local_accounts (id, provider, connection_state, "
                   "granted_scopes_json, missing_scopes_json, updated_at) "
                   "VALUES ('account-1', 'google', 'connected', '[]', '[]', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) "
                   "VALUES ('list-1', 'account-1', 'google-list-1', 'Notes', "
                   "'2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_tasks (id, task_list_id, remote_id, title, notes, updated_at) "
              "VALUES ('note-1', 'list-1', 'google-note-1', 'Project note', 'Body', "
              "'2026-07-24T00:00:00Z')"),
      SQLITE_OK);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_tasks (id, task_list_id, remote_id, title, due_at, updated_at) "
              "VALUES ('task-due', 'list-1', 'google-task-due', 'Task', '2026-07-25T00:00:00Z', "
              "'2026-07-24T00:00:00Z')"),
      SQLITE_OK);
  QCOMPARE(execute(handle,
                   "INSERT INTO local_tasks (id, task_list_id, remote_id, parent_task_id, title, "
                   "updated_at) VALUES ('task-child', 'list-1', 'google-task-child', 'note-1', "
                   "'Child', '2026-07-24T00:00:00Z')"),
           SQLITE_OK);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_tasks (id, task_list_id, remote_id, title, state, updated_at) "
              "VALUES ('task-completed', 'list-1', 'google-task-completed', 'Completed', "
              "'completed', '2026-07-24T00:00:00Z')"),
      SQLITE_OK);
  QCOMPARE(
      execute(handle,
              "INSERT INTO local_tasks (id, task_list_id, remote_id, title, is_hidden, updated_at) "
              "VALUES ('task-hidden', 'list-1', 'google-task-hidden', 'Hidden', 1, "
              "'2026-07-24T00:00:00Z')"),
      SQLITE_OK);
  QCOMPARE(scalar(handle, "SELECT COUNT(*) FROM local_note_projections"), 1);
  QCOMPARE(scalarText(handle, "SELECT body FROM local_note_projections WHERE id = 'note-1'"),
           std::optional<QString>(QStringLiteral("Body")));
  QCOMPARE(scalar(handle,
                  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'view' "
                  "AND name = 'local_note_projections'"),
           1);
  QCOMPARE(scalar(handle,
                  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' "
                  "AND name = 'local_note_projections'"),
           0);
  QCOMPARE(scalar(handle,
                  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' "
                  "AND name = 'local_tasks_active_note_recency'"),
           1);
}

QTEST_GUILESS_MAIN(LocalSchemaTest)

#include "LocalSchemaTest.moc"
