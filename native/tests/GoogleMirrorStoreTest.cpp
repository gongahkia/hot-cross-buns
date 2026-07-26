#include <QDir>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QtTest/QTest>

#include <chrono>
#include <future>
#include <optional>
#include <utility>
#include <variant>

#include "core/GoogleMirrorStore.h"
#include "data/SqliteConnection.h"
#include "sqlite3.h"

using namespace std::chrono_literals;

class GoogleMirrorStoreTest final : public QObject {
  Q_OBJECT

private slots:
  void atomicallyReplacesTaskAndCalendarSnapshots();
  void preservesQueuedAndApplyingRowsDuringPull();
};

namespace {

[[nodiscard]] std::optional<hcb::FilePath>
databasePathFor(const QTemporaryDir& temporaryDirectory) {
  return hcb::FilePath::fromAbsolute(QDir(QFileInfo(temporaryDirectory.path()).canonicalFilePath())
                                         .filePath(QStringLiteral("hot-cross-buns.sqlite")));
}

template <typename Result> [[nodiscard]] Result awaitResult(std::future<Result>& future) {
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("google mirror request timed out");
  }
  return future.get();
}

void verifyReady(hcb::GoogleMirrorStore& store) {
  const std::shared_future<hcb::SqliteWriteResult> ready = store.ready();
  QCOMPARE(ready.wait_for(2s), std::future_status::ready);
  const hcb::SqliteWriteResult& result = ready.get();
  QVERIFY2(!result.has_value(), qPrintable(result.has_value() ? result->message() : QString()));
}

void execute(sqlite3* handle, const char* sql) {
  char* errorMessage = nullptr;
  const int result = sqlite3_exec(handle, sql, nullptr, nullptr, &errorMessage);
  const QString message = errorMessage == nullptr ? QString() : QString::fromUtf8(errorMessage);
  sqlite3_free(errorMessage);
  QVERIFY2(result == SQLITE_OK, qPrintable(message));
}

[[nodiscard]] int count(sqlite3* handle, const char* sql) {
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    qFatal("SQLite count preparation failed");
  }
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    qFatal("SQLite count query failed");
  }
  const int value = sqlite3_column_int(statement, 0);
  if (sqlite3_finalize(statement) != SQLITE_OK) {
    qFatal("SQLite count finalization failed");
  }
  return value;
}

[[nodiscard]] QString text(sqlite3* handle, const char* sql) {
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    qFatal("SQLite text preparation failed");
  }
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    qFatal("SQLite text query failed");
  }
  const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(statement, 0));
  const int size = sqlite3_column_bytes(statement, 0);
  const QString result = value == nullptr ? QString() : QString::fromUtf8(value, size);
  if (sqlite3_finalize(statement) != SQLITE_OK) {
    qFatal("SQLite text finalization failed");
  }
  return result;
}

} // namespace

void GoogleMirrorStoreTest::atomicallyReplacesTaskAndCalendarSnapshots() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  hcb::SystemClock clock;
  hcb::GoogleMirrorStore store(*databasePath, clock);
  verifyReady(store);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_accounts (id, provider, connection_state, granted_scopes_json, "
          "missing_scopes_json, updated_at) VALUES "
          "('google', 'google', 'connected', '[]', '[]', '2026-07-26T00:00:00Z')");

  std::future<hcb::GoogleMirrorWriteResult> taskWrite =
      store.replaceTasks(QStringLiteral("google"),
                         {{.id = QStringLiteral("inbox"),
                           .title = QStringLiteral("Inbox"),
                           .updatedAt = QStringLiteral("2026-07-26T00:00:00Z")}},
                         {{.id = QStringLiteral("parent"),
                           .taskListId = QStringLiteral("inbox"),
                           .title = QStringLiteral("Parent"),
                           .status = hcb::GoogleTaskStatus::NeedsAction},
                          {.id = QStringLiteral("child"),
                           .taskListId = QStringLiteral("inbox"),
                           .parentId = QStringLiteral("parent"),
                           .title = QStringLiteral("Child"),
                           .status = hcb::GoogleTaskStatus::Completed}});
  const hcb::GoogleMirrorWriteResult taskResult = awaitResult(taskWrite);
  QVERIFY(std::holds_alternative<std::monostate>(taskResult));
  QCOMPARE(count(handle, "SELECT COUNT(*) FROM local_task_lists WHERE deleted_at IS NULL"), 1);
  QCOMPARE(count(handle, "SELECT COUNT(*) FROM local_tasks WHERE deleted_at IS NULL"), 2);
  QCOMPARE(count(handle,
                 "SELECT COUNT(*) FROM local_tasks WHERE parent_task_id IS NOT NULL "
                 "AND state = 'completed'"),
           1);

  std::future<hcb::GoogleMirrorWriteResult> calendarWrite =
      store.replaceCalendars(QStringLiteral("google"),
                             {{.id = QStringLiteral("primary"),
                               .title = QStringLiteral("Primary"),
                               .timeZone = QStringLiteral("UTC"),
                               .accessRole = hcb::GoogleCalendarAccessRole::Owner,
                               .selected = true,
                               .hidden = false,
                               .primary = true}},
                             {{.id = QStringLiteral("event"),
                               .calendarId = QStringLiteral("primary"),
                               .status = hcb::GoogleCalendarEventStatus::Confirmed,
                               .title = QStringLiteral("Planning"),
                               .startAt = QStringLiteral("2026-07-26T09:00:00.000Z"),
                               .endAt = QStringLiteral("2026-07-26T10:00:00.000Z"),
                               .allDay = false}});
  const hcb::GoogleMirrorWriteResult calendarResult = awaitResult(calendarWrite);
  QVERIFY(std::holds_alternative<std::monostate>(calendarResult));
  QCOMPARE(count(handle, "SELECT COUNT(*) FROM local_calendars WHERE deleted_at IS NULL"), 1);
  QCOMPARE(count(handle, "SELECT COUNT(*) FROM local_calendar_events WHERE deleted_at IS NULL"), 1);

  std::future<hcb::GoogleMirrorWriteResult> emptyTasks =
      store.replaceTasks(QStringLiteral("google"), {}, {});
  const hcb::GoogleMirrorWriteResult emptyTaskResult = awaitResult(emptyTasks);
  QVERIFY(std::holds_alternative<std::monostate>(emptyTaskResult));
  QCOMPARE(count(handle, "SELECT COUNT(*) FROM local_task_lists WHERE deleted_at IS NULL"), 0);
}

void GoogleMirrorStoreTest::preservesQueuedAndApplyingRowsDuringPull() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  hcb::SystemClock clock;
  hcb::GoogleMirrorStore store(*databasePath, clock);
  verifyReady(store);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_accounts (id, provider, connection_state, granted_scopes_json, "
          "missing_scopes_json, updated_at) VALUES "
          "('google', 'google', 'connected', '[]', '[]', '2026-07-26T00:00:00Z')");
  std::future<hcb::GoogleMirrorWriteResult> tasks =
      store.replaceTasks(QStringLiteral("google"),
                         {{.id = QStringLiteral("inbox"), .title = QStringLiteral("Inbox")}},
                         {{.id = QStringLiteral("task"),
                           .taskListId = QStringLiteral("inbox"),
                           .title = QStringLiteral("Local title"),
                           .status = hcb::GoogleTaskStatus::NeedsAction}});
  QVERIFY(std::holds_alternative<std::monostate>(awaitResult(tasks)));
  std::future<hcb::GoogleMirrorWriteResult> calendars =
      store.replaceCalendars(QStringLiteral("google"),
                             {{.id = QStringLiteral("primary"),
                               .title = QStringLiteral("Primary"),
                               .accessRole = hcb::GoogleCalendarAccessRole::Owner}},
                             {{.id = QStringLiteral("event"),
                               .calendarId = QStringLiteral("primary"),
                               .status = hcb::GoogleCalendarEventStatus::Confirmed,
                               .title = QStringLiteral("Local event"),
                               .startAt = QStringLiteral("2026-07-26T09:00:00.000Z"),
                               .endAt = QStringLiteral("2026-07-26T10:00:00.000Z")}});
  QVERIFY(std::holds_alternative<std::monostate>(awaitResult(calendars)));
  execute(handle,
          "INSERT INTO local_pending_mutations "
          "(id, account_id, resource_type, resource_id, operation, payload_json, status, "
          "attempt_count, created_at, updated_at) "
          "SELECT 'task-mutation', 'google', 'task', id, 'update', '{}', 'pending', 0, "
          "'2026-07-26T00:00:00Z', '2026-07-26T00:00:00Z' FROM local_tasks LIMIT 1");
  execute(handle,
          "INSERT INTO local_pending_mutations "
          "(id, account_id, resource_type, resource_id, operation, payload_json, status, "
          "attempt_count, lease_id, lease_expires_at, created_at, updated_at) "
          "SELECT 'event-mutation', 'google', 'event', id, 'update', '{}', 'applying', 1, "
          "'lease', '2026-07-26T01:00:00Z', '2026-07-26T00:00:00Z', '2026-07-26T00:00:00Z' "
          "FROM local_calendar_events LIMIT 1");
  std::future<hcb::GoogleMirrorWriteResult> refreshedTasks =
      store.replaceTasks(QStringLiteral("google"), {}, {});
  QVERIFY(std::holds_alternative<std::monostate>(awaitResult(refreshedTasks)));
  std::future<hcb::GoogleMirrorWriteResult> refreshedCalendars =
      store.replaceCalendars(QStringLiteral("google"), {}, {});
  QVERIFY(std::holds_alternative<std::monostate>(awaitResult(refreshedCalendars)));
  QCOMPARE(text(handle, "SELECT title FROM local_tasks WHERE deleted_at IS NULL"),
           QStringLiteral("Local title"));
  QCOMPARE(text(handle, "SELECT title FROM local_calendar_events WHERE deleted_at IS NULL"),
           QStringLiteral("Local event"));
}

QTEST_GUILESS_MAIN(GoogleMirrorStoreTest)

#include "GoogleMirrorStoreTest.moc"
