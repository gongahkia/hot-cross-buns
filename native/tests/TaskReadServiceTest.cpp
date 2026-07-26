#include <QDir>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QtTest/QTest>

#include <chrono>
#include <future>
#include <optional>
#include <utility>
#include <variant>

#include "core/TaskReadService.h"
#include "data/SqliteConnection.h"
#include "sqlite3.h"

using namespace std::chrono_literals;

class TaskReadServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void readsVisibleTasksWithoutAccountFilter();
  void filtersSelectedListsAndRejectsInvalidRequests();
};

namespace {

[[nodiscard]] std::optional<hcb::FilePath>
databasePathFor(const QTemporaryDir& temporaryDirectory) {
  return hcb::FilePath::fromAbsolute(QDir(QFileInfo(temporaryDirectory.path()).canonicalFilePath())
                                             .filePath(QStringLiteral("hot-cross-buns.sqlite")));
}

template <typename Result> [[nodiscard]] Result awaitResult(std::future<Result>& future) {
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("task read service request timed out");
  }
  return future.get();
}

void verifyReady(hcb::TaskReadService& service) {
  const std::shared_future<hcb::SqliteWriteResult> ready = service.ready();
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

void seed(hcb::SqliteConnection& connection) {
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_accounts (id, provider, connection_state, granted_scopes_json, "
          "missing_scopes_json, updated_at) VALUES "
          "('account-a', 'google', 'connected', '[]', '[]', '2026-07-24T00:00:00Z'), "
          "('account-b', 'google', 'connected', '[]', '[]', '2026-07-24T00:00:00Z')");
  execute(handle,
          "INSERT INTO local_task_lists (id, account_id, remote_id, title, sort_order, is_selected, "
          "updated_at, deleted_at) VALUES "
          "('list-a', 'account-a', 'a', 'A', 0, 1, '2026-07-24T00:00:00Z', NULL), "
          "('list-b', 'account-b', 'b', 'B', 1, 0, '2026-07-24T00:00:00Z', NULL)");
  execute(handle,
          "INSERT INTO local_tasks (id, task_list_id, remote_id, title, state, is_hidden, "
          "sort_order, priority, updated_at, deleted_at) VALUES "
          "('task-visible-a', 'list-a', 'a', 'Visible A', 'active', 0, 0, 'high', "
          "'2026-07-24T00:00:00Z', NULL), "
          "('task-visible-b', 'list-b', 'b', 'Visible B', 'completed', 0, 0, 'low', "
          "'2026-07-24T00:00:00Z', NULL), "
          "('task-hidden', 'list-a', 'hidden', 'Hidden', 'active', 1, 1, 'none', "
          "'2026-07-24T00:00:00Z', NULL), "
          "('task-deleted', 'list-a', 'deleted', 'Deleted', 'active', 0, 2, 'none', "
          "'2026-07-24T00:00:00Z', '2026-07-24T01:00:00Z')");
}

} // namespace

void TaskReadServiceTest::readsVisibleTasksWithoutAccountFilter() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  hcb::TaskReadService service(*databasePath);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);

  std::future<hcb::TaskReadResult> future = service.list({.limit = 10});
  const hcb::TaskReadResult result = awaitResult(future);
  QVERIFY(std::holds_alternative<QList<hcb::TaskModelTask>>(result));
  const QList<hcb::TaskModelTask>& tasks = std::get<QList<hcb::TaskModelTask>>(result);
  QCOMPARE(tasks.size(), 2);
  QCOMPARE(tasks.at(0).id, QStringLiteral("task-visible-a"));
  QCOMPARE(tasks.at(0).priority, hcb::TaskPriority::High);
  QVERIFY(!tasks.at(0).completed);
  QCOMPARE(tasks.at(1).id, QStringLiteral("task-visible-b"));
  QCOMPARE(tasks.at(1).priority, hcb::TaskPriority::Low);
  QVERIFY(tasks.at(1).completed);
}

void TaskReadServiceTest::filtersSelectedListsAndRejectsInvalidRequests() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  hcb::TaskReadService service(*databasePath);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);

  std::future<hcb::TaskReadResult> selected =
      service.list({.accountId = QStringLiteral("account-a"), .selectedListsOnly = true});
  const hcb::TaskReadResult selectedResult = awaitResult(selected);
  QVERIFY(std::holds_alternative<QList<hcb::TaskModelTask>>(selectedResult));
  const QList<hcb::TaskModelTask>& tasks =
      std::get<QList<hcb::TaskModelTask>>(selectedResult);
  QCOMPARE(tasks.size(), 1);
  QCOMPARE(tasks.first().id, QStringLiteral("task-visible-a"));

  std::future<hcb::TaskReadResult> invalid = service.list({.limit = 0});
  const hcb::TaskReadResult invalidResult = awaitResult(invalid);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidResult));
  QCOMPARE(std::get<hcb::AppError>(invalidResult).code(), hcb::AppErrorCode::Validation);
}

QTEST_GUILESS_MAIN(TaskReadServiceTest)

#include "TaskReadServiceTest.moc"
