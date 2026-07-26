#include <QDir>
#include <QFileInfo>
#include <QTemporaryDir>
#include <QtTest/QTest>

#include "core/TaskBulkMutationService.h"
#include "data/SqliteConnection.h"
#include "sqlite3.h"

#include <chrono>
#include <future>
#include <optional>
#include <utility>
#include <variant>

using namespace std::chrono_literals;

namespace {

class FixedClock final : public hcb::Clock {
public:
  [[nodiscard]] hcb::WallTimePoint wallNow() const noexcept override {
    return hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}};
  }
  [[nodiscard]] hcb::MonotonicTimePoint monotonicNow() const noexcept override {
    return hcb::MonotonicTimePoint{};
  }
};

template <typename Result> [[nodiscard]] Result await(std::future<Result>& future) {
  if (future.wait_for(5s) != std::future_status::ready) {
    qFatal("bulk task mutation request timed out");
  }
  return future.get();
}

[[nodiscard]] std::optional<hcb::FilePath> databasePathFor(const QTemporaryDir& directory) {
  return hcb::FilePath::fromAbsolute(QDir(QFileInfo(directory.path()).canonicalFilePath())
                                         .filePath(QStringLiteral("hot-cross-buns.sqlite")));
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
          "('account-a', 'google', 'connected', '[]', '[]', '2026-07-25T00:00:00Z')");
  execute(handle,
          "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at) VALUES "
          "('list-active', 'account-a', 'active', 'Active', '2026-07-25T00:00:00Z'), "
          "('list-other', 'account-a', 'other', 'Other', '2026-07-25T00:00:00Z')");
}

void verifyReady(hcb::TaskMutationService& service) {
  const std::shared_future<hcb::SqliteWriteResult> ready = service.ready();
  QCOMPARE(ready.wait_for(2s), std::future_status::ready);
  QVERIFY(!ready.get().has_value());
}

[[nodiscard]] QString create(hcb::TaskMutationService& service,
                             const QString& taskListId,
                             const QString& title,
                             std::optional<QString> parentTaskId = {}) {
  std::future<hcb::TaskMutationResult> future = service.create(
      {.taskListId = taskListId, .parentTaskId = std::move(parentTaskId), .title = title});
  const hcb::TaskMutationResult result = await(future);
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(result)) {
    qFatal("task create failed");
  }
  return std::get<hcb::TaskMutationReceipt>(result).taskId;
}

[[nodiscard]] hcb::TaskBulkMutationSummary execute(hcb::TaskBulkMutationService& service,
                                                    hcb::TaskBulkMutationInput input) {
  std::future<hcb::TaskBulkMutationResult> future = service.execute(std::move(input));
  const hcb::TaskBulkMutationResult result = await(future);
  if (!std::holds_alternative<hcb::TaskBulkMutationSummary>(result)) {
    qFatal("bulk task mutation failed");
  }
  return std::get<hcb::TaskBulkMutationSummary>(result);
}

} // namespace

class TaskBulkMutationServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void queuesEligibleItemsAndSeparatesSkips();
  void avoidsOrderDependentHierarchyMoves();
  void handlesLargeSelectionsWithIndependentMutations();
  void reparentsMaximumSelectionWithCompatibleParent();
};

void TaskBulkMutationServiceTest::queuesEligibleItemsAndSeparatesSkips() {
  QTemporaryDir directory;
  QVERIFY(directory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(directory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  FixedClock clock;
  hcb::TaskMutationService taskMutations(*databasePath, clock);
  verifyReady(taskMutations);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  const QString active = create(taskMutations, QStringLiteral("list-active"), QStringLiteral("Active"));
  const QString completed =
      create(taskMutations, QStringLiteral("list-active"), QStringLiteral("Completed"));
  std::future<hcb::TaskMutationResult> complete = taskMutations.setCompleted(completed, true);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(await(complete)));

  hcb::TaskBulkMutationService bulk(taskMutations);
  const hcb::TaskBulkMutationSummary summary = execute(
      bulk,
      {.action = hcb::TaskBulkAction::Complete,
       .taskIds = {active, completed, QStringLiteral("task-missing")}});
  QCOMPARE(summary.requested, 3);
  QCOMPARE(summary.eligible, 1);
  QCOMPARE(summary.queued, 1);
  QCOMPARE(summary.applied, 0);
  QCOMPARE(summary.conflicted, 0);
  QCOMPARE(summary.failed, 0);
  QCOMPARE(summary.skipped, 2);
  QCOMPARE(summary.items.size(), 3);

  std::future<hcb::TaskMutationSnapshotResult> inspected =
      taskMutations.inspect({active, completed});
  const hcb::TaskMutationSnapshotResult snapshots = await(inspected);
  QVERIFY(std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots));
  if (!std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots)) {
    return;
  }
  const QList<hcb::TaskMutationSnapshot>& rows =
      std::get<QList<hcb::TaskMutationSnapshot>>(snapshots);
  QCOMPARE(rows.size(), 2);
  QVERIFY(rows.at(0).completed);
  QVERIFY(rows.at(1).completed);
}

void TaskBulkMutationServiceTest::avoidsOrderDependentHierarchyMoves() {
  QTemporaryDir directory;
  QVERIFY(directory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(directory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  FixedClock clock;
  hcb::TaskMutationService taskMutations(*databasePath, clock);
  verifyReady(taskMutations);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  const QString parent = create(taskMutations, QStringLiteral("list-active"), QStringLiteral("Parent"));
  const QString child = create(taskMutations,
                               QStringLiteral("list-active"),
                               QStringLiteral("Child"),
                               parent);

  hcb::TaskBulkMutationService bulk(taskMutations);
  const hcb::TaskBulkMutationSummary summary = execute(
      bulk,
      {.action = hcb::TaskBulkAction::MoveToList,
       .taskIds = {parent, child},
       .taskListId = QStringLiteral("list-other")});
  QCOMPARE(summary.eligible, 1);
  QCOMPARE(summary.queued, 1);
  QCOMPARE(summary.skipped, 1);

  std::future<hcb::TaskMutationSnapshotResult> inspected =
      taskMutations.inspect({parent, child});
  const hcb::TaskMutationSnapshotResult snapshots = await(inspected);
  QVERIFY(std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots));
  if (!std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots)) {
    return;
  }
  const QList<hcb::TaskMutationSnapshot>& rows =
      std::get<QList<hcb::TaskMutationSnapshot>>(snapshots);
  QCOMPARE(rows.at(0).taskListId, QStringLiteral("list-active"));
  QCOMPARE(rows.at(1).taskListId, QStringLiteral("list-other"));
}

void TaskBulkMutationServiceTest::handlesLargeSelectionsWithIndependentMutations() {
  QTemporaryDir directory;
  QVERIFY(directory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(directory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  FixedClock clock;
  hcb::TaskMutationService taskMutations(*databasePath, clock);
  verifyReady(taskMutations);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  QList<QString> taskIds;
  constexpr int taskCount = 96;
  taskIds.reserve(taskCount);
  for (int index = 0; index < taskCount; ++index) {
    taskIds.append(create(taskMutations,
                          QStringLiteral("list-active"),
                          QStringLiteral("Task %1").arg(index)));
  }

  hcb::TaskBulkMutationService bulk(taskMutations);
  const hcb::TaskBulkMutationSummary summary = execute(
      bulk,
      {.action = hcb::TaskBulkAction::SetPriority,
       .taskIds = taskIds,
       .priority = hcb::TaskPriority::High});
  QCOMPARE(summary.requested, taskCount);
  QCOMPARE(summary.eligible, taskCount);
  QCOMPARE(summary.queued, taskCount);
  QCOMPARE(summary.failed, 0);
  QCOMPARE(summary.skipped, 0);

  std::future<hcb::TaskMutationSnapshotResult> inspected = taskMutations.inspect(taskIds);
  const hcb::TaskMutationSnapshotResult snapshots = await(inspected);
  QVERIFY(std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots));
  if (!std::holds_alternative<QList<hcb::TaskMutationSnapshot>>(snapshots)) {
    return;
  }
  const QList<hcb::TaskMutationSnapshot>& rows =
      std::get<QList<hcb::TaskMutationSnapshot>>(snapshots);
  QCOMPARE(rows.size(), taskCount);
  for (const hcb::TaskMutationSnapshot& task : rows) {
    QCOMPARE(task.priority, hcb::TaskPriority::High);
  }
}

void TaskBulkMutationServiceTest::reparentsMaximumSelectionWithCompatibleParent() {
  QTemporaryDir directory;
  QVERIFY(directory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(directory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  FixedClock clock;
  hcb::TaskMutationService taskMutations(*databasePath, clock);
  verifyReady(taskMutations);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  const QString parent = create(taskMutations, QStringLiteral("list-active"), QStringLiteral("Parent"));
  QList<QString> taskIds;
  constexpr int taskCount = 500;
  taskIds.reserve(taskCount);
  for (int index = 0; index < taskCount; ++index) {
    taskIds.append(create(taskMutations,
                          QStringLiteral("list-active"),
                          QStringLiteral("Task %1").arg(index)));
  }

  hcb::TaskBulkMutationService bulk(taskMutations);
  const hcb::TaskBulkMutationSummary summary = execute(
      bulk,
      {.action = hcb::TaskBulkAction::Reparent,
       .taskIds = taskIds,
       .parentTaskId = parent});
  QCOMPARE(summary.requested, taskCount);
  QCOMPARE(summary.eligible, taskCount);
  QCOMPARE(summary.queued, taskCount);
  QCOMPARE(summary.failed, 0);
  QCOMPARE(summary.skipped, 0);
}

QTEST_GUILESS_MAIN(TaskBulkMutationServiceTest)

#include "TaskBulkMutationServiceTest.moc"
