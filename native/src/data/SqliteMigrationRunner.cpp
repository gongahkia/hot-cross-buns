#include "data/SqliteMigrationRunner.h"

#include "data/SqliteTransaction.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QChar>

#include <algorithm>
#include <exception>
#include <limits>
#include <unordered_set>
#include <utility>

namespace hcb {
namespace {

constexpr const char* schemaMigrationsSql = R"(
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
)";

[[nodiscard]] AppError migrationError(QString message, int result) {
  return AppError(AppErrorCode::Database, std::move(message).arg(result));
}

[[nodiscard]] std::optional<AppError> execute(sqlite3* handle, const char* sql, QString message) {
  char* sqliteErrorMessage = nullptr;
  const int result = sqlite3_exec(handle, sql, nullptr, nullptr, &sqliteErrorMessage);
  sqlite3_free(sqliteErrorMessage);
  if (result != SQLITE_OK) {
    return migrationError(std::move(message), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
validateMigrations(std::span<const SqliteMigration> migrations) {
  int previousVersion = 0;
  for (const SqliteMigration& migration : migrations) {
    if (migration.version <= previousVersion || migration.name.trimmed().isEmpty() ||
        migration.name.contains(QChar::Null) || !migration.apply) {
      return AppError(AppErrorCode::Database,
                      QStringLiteral("SQLite migration catalogue is invalid"));
    }
    previousVersion = migration.version;
  }
  return std::nullopt;
}

using AppliedMigrationResult = std::variant<std::vector<int>, AppError>;

[[nodiscard]] AppliedMigrationResult readAppliedVersions(sqlite3* handle) {
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle,
                         "SELECT version FROM local_schema_migrations ORDER BY version",
                         -1,
                         SQLITE_PREPARE_PERSISTENT,
                         &statement,
                         nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return migrationError(QStringLiteral("SQLite migration history read failed (%1)"),
                          prepareResult);
  }

  std::vector<int> appliedVersions;
  int stepResult = SQLITE_OK;
  while ((stepResult = sqlite3_step(statement)) == SQLITE_ROW) {
    const sqlite3_int64 version = sqlite3_column_int64(statement, 0);
    if (version < std::numeric_limits<int>::min() || version > std::numeric_limits<int>::max()) {
      sqlite3_finalize(statement);
      return AppError(AppErrorCode::Database,
                      QStringLiteral("SQLite migration history version is invalid"));
    }
    appliedVersions.push_back(static_cast<int>(version));
  }
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return migrationError(QStringLiteral("SQLite migration history read failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return migrationError(QStringLiteral("SQLite migration history finalization failed (%1)"),
                          finalizeResult);
  }
  return appliedVersions;
}

[[nodiscard]] std::optional<AppError>
validateAppliedHistory(const std::vector<int>& appliedVersions,
                       std::span<const SqliteMigration> migrations) {
  std::unordered_set<int> applied(appliedVersions.begin(), appliedVersions.end());
  if (applied.size() != appliedVersions.size()) {
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite migration history is invalid"));
  }

  bool missingMigrationSeen = false;
  for (const SqliteMigration& migration : migrations) {
    if (applied.contains(migration.version)) {
      if (missingMigrationSeen) {
        return AppError(AppErrorCode::Database,
                        QStringLiteral("SQLite migration history is discontinuous"));
      }
      continue;
    }
    missingMigrationSeen = true;
  }
  if (applied.size() > migrations.size()) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite migration history is newer than this application"));
  }
  for (const int appliedVersion : appliedVersions) {
    const bool declared = std::any_of(
        migrations.begin(), migrations.end(), [appliedVersion](const SqliteMigration& migration) {
          return migration.version == appliedVersion;
        });
    if (!declared) {
      return AppError(AppErrorCode::Database,
                      QStringLiteral("SQLite migration history is newer than this application"));
    }
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError> recordMigration(sqlite3* handle,
                                                      const SqliteMigration& migration) {
  sqlite3_stmt* statement = nullptr;
  const int prepareResult = sqlite3_prepare_v3(handle,
                                               R"(
INSERT INTO local_schema_migrations (version, name, applied_at)
VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)",
                                               -1,
                                               SQLITE_PREPARE_PERSISTENT,
                                               &statement,
                                               nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return migrationError(QStringLiteral("SQLite migration record preparation failed (%1)"),
                          prepareResult);
  }

  const QByteArray name = migration.name.toUtf8();
  if (name.size() > std::numeric_limits<int>::max()) {
    sqlite3_finalize(statement);
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite migration name is too large"));
  }
  const int bindVersionResult = sqlite3_bind_int(statement, 1, migration.version);
  const int bindNameResult = sqlite3_bind_text(
      statement, 2, name.constData(), static_cast<int>(name.size()), SQLITE_TRANSIENT);
  const int stepResult = bindVersionResult == SQLITE_OK && bindNameResult == SQLITE_OK
                             ? sqlite3_step(statement)
                             : SQLITE_ERROR;
  const int finalizeResult = sqlite3_finalize(statement);
  if (bindVersionResult != SQLITE_OK) {
    return migrationError(QStringLiteral("SQLite migration version binding failed (%1)"),
                          bindVersionResult);
  }
  if (bindNameResult != SQLITE_OK) {
    return migrationError(QStringLiteral("SQLite migration name binding failed (%1)"),
                          bindNameResult);
  }
  if (stepResult != SQLITE_DONE) {
    return migrationError(QStringLiteral("SQLite migration record write failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return migrationError(QStringLiteral("SQLite migration record finalization failed (%1)"),
                          finalizeResult);
  }
  return std::nullopt;
}

} // namespace

SqliteMigrationRunResultOrError
SqliteMigrationRunner::run(SqliteConnection& connection,
                           std::span<const SqliteMigration> migrations) {
  if (const std::optional<AppError> error = validateMigrations(migrations); error.has_value()) {
    return *error;
  }
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite migration connection is unavailable"));
  }
  if (const std::optional<AppError> error = execute(
          handle, schemaMigrationsSql, QStringLiteral("SQLite migration schema setup failed (%1)"));
      error.has_value()) {
    return *error;
  }

  AppliedMigrationResult appliedResult = readAppliedVersions(handle);
  if (std::holds_alternative<AppError>(appliedResult)) {
    return std::get<AppError>(std::move(appliedResult));
  }
  const std::vector<int> appliedVersions = std::get<std::vector<int>>(std::move(appliedResult));
  if (const std::optional<AppError> error = validateAppliedHistory(appliedVersions, migrations);
      error.has_value()) {
    return *error;
  }
  const std::unordered_set<int> applied(appliedVersions.begin(), appliedVersions.end());

  SqliteMigrationRunResult result;
  result.version = migrations.empty() ? 0 : migrations.back().version;
  for (const SqliteMigration& migration : migrations) {
    if (applied.contains(migration.version)) {
      continue;
    }
    SqliteTransactionResult transactionResult = SqliteTransaction::begin(connection);
    if (std::holds_alternative<AppError>(transactionResult)) {
      return std::get<AppError>(std::move(transactionResult));
    }
    SqliteTransaction transaction = std::move(std::get<SqliteTransaction>(transactionResult));
    try {
      if (const std::optional<AppError> error = migration.apply(connection); error.has_value()) {
        return *error;
      }
    } catch (const std::exception&) {
      return AppError(AppErrorCode::Database, QStringLiteral("SQLite migration failed"));
    } catch (...) {
      return AppError(AppErrorCode::Database, QStringLiteral("SQLite migration failed"));
    }
    if (const std::optional<AppError> error = recordMigration(handle, migration);
        error.has_value()) {
      return *error;
    }
    if (const std::optional<AppError> error = transaction.commit(); error.has_value()) {
      return *error;
    }
    result.appliedVersions.push_back(migration.version);
  }
  return result;
}

} // namespace hcb
