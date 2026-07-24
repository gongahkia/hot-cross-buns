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

[[nodiscard]] const std::array<SqliteMigration, 2>& migrations() {
  static const std::array<SqliteMigration, 2> catalogue = {{
      {1,
       QStringLiteral("create local settings"),
       checksum(settingsSchemaSql),
       applySettingsSchema},
      {2, QStringLiteral("create local accounts"), checksum(accountSchemaSql), applyAccountSchema},
  }};
  return catalogue;
}

} // namespace

SqliteMigrationRunResultOrError LocalSchema::initialize(SqliteConnection& connection) {
  return SqliteMigrationRunner::run(connection, migrations());
}

} // namespace hcb
