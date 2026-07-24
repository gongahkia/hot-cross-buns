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

[[nodiscard]] QString checksum(const char* sql) {
  return QString::fromLatin1(
      QCryptographicHash::hash(QByteArray(sql), QCryptographicHash::Algorithm::Sha256).toHex());
}

[[nodiscard]] std::optional<AppError> applySettingsSchema(SqliteConnection& connection) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite settings schema connection is unavailable"));
  }
  char* errorMessage = nullptr;
  const int result = sqlite3_exec(handle, settingsSchemaSql, nullptr, nullptr, &errorMessage);
  sqlite3_free(errorMessage);
  if (result != SQLITE_OK) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite settings schema setup failed (%1)").arg(result));
  }
  return std::nullopt;
}

[[nodiscard]] const std::array<SqliteMigration, 1>& migrations() {
  static const std::array<SqliteMigration, 1> catalogue = {{
      {1,
       QStringLiteral("create local settings"),
       checksum(settingsSchemaSql),
       applySettingsSchema},
  }};
  return catalogue;
}

} // namespace

SqliteMigrationRunResultOrError LocalSchema::initialize(SqliteConnection& connection) {
  return SqliteMigrationRunner::run(connection, migrations());
}

} // namespace hcb
