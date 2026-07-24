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
  QCOMPARE(first.version, 1);
  QCOMPARE(first.appliedVersions, std::vector<int>({1}));
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' "
                  "AND name = 'local_settings'"),
           1);
  QCOMPARE(scalar(connection->nativeHandle(),
                  "SELECT COUNT(*) FROM local_schema_migrations WHERE version = 1 "
                  "AND name = 'create local settings' AND length(checksum) = 64"),
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
  QCOMPARE(second.version, 1);
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

QTEST_GUILESS_MAIN(LocalSchemaTest)

#include "LocalSchemaTest.moc"
