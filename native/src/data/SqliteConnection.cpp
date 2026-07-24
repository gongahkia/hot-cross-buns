#include "data/SqliteConnection.h"

#include "sqlite3.h"

#include <QByteArray>
#include <QChar>
#include <QString>

#include <utility>

namespace hcb {
namespace {

[[nodiscard]] int flagsFor(SqliteOpenMode mode) noexcept {
  constexpr int sharedFlags =
      SQLITE_OPEN_FULLMUTEX | SQLITE_OPEN_PRIVATECACHE | SQLITE_OPEN_NOFOLLOW;
  switch (mode) {
  case SqliteOpenMode::ReadOnly:
    return SQLITE_OPEN_READONLY | sharedFlags;
  case SqliteOpenMode::ReadWriteCreate:
    return SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | sharedFlags;
  }
  return SQLITE_OPEN_READONLY | sharedFlags;
}

} // namespace

SqliteConnection::SqliteConnection(sqlite3* handle) noexcept : handle_(handle) {}

SqliteConnection::SqliteConnection(SqliteConnection&& other) noexcept
    : handle_(std::exchange(other.handle_, nullptr)) {}

SqliteConnection& SqliteConnection::operator=(SqliteConnection&& other) noexcept {
  if (this != &other) {
    sqlite3_close_v2(handle_);
    handle_ = std::exchange(other.handle_, nullptr);
  }
  return *this;
}

SqliteConnection::~SqliteConnection() { sqlite3_close_v2(handle_); }

sqlite3* SqliteConnection::nativeHandle() const noexcept { return handle_; }

SqliteConnectionResult SqliteConnectionFactory::open(const FilePath& databasePath,
                                                     SqliteOpenMode mode) {
  const QString& path = databasePath.nativePath();
  if (path.isEmpty() || path.contains(QChar::Null)) {
    return AppError(AppErrorCode::Database, QStringLiteral("SQLite database path is invalid"));
  }

  const QByteArray utf8Path = path.toUtf8();
  sqlite3* handle = nullptr;
  const int result = sqlite3_open_v2(utf8Path.constData(), &handle, flagsFor(mode), nullptr);
  if (result != SQLITE_OK) {
    sqlite3_close_v2(handle);
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite database open failed (%1)").arg(result));
  }
  return SqliteConnection(handle);
}

} // namespace hcb
