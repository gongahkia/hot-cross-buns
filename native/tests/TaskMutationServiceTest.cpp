#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <QTimeZone>
#include <QtTest/QTest>

#include <chrono>
#include <future>
#include <optional>
#include <utility>
#include <variant>

#include "core/TaskMutationService.h"
#include "data/SqliteConnection.h"
#include "sqlite3.h"

using namespace std::chrono_literals;

namespace {

class FixedClock final : public hcb::Clock {
public:
  explicit FixedClock(hcb::WallTimePoint wallTime) : wallTime_(wallTime) {}

  [[nodiscard]] hcb::WallTimePoint wallNow() const noexcept override { return wallTime_; }
  [[nodiscard]] hcb::MonotonicTimePoint monotonicNow() const noexcept override {
    return hcb::MonotonicTimePoint{};
  }

private:
  hcb::WallTimePoint wallTime_;
};

struct TaskSnapshot final {
  QString id;
  QString taskListId;
  QString remoteId;
  std::optional<QString> parentTaskId;
  QString title;
  std::optional<QString> notes;
  QString state;
  std::optional<QString> dueAt;
  std::optional<QString> dueTimeZone;
  QString priority;
  std::optional<QString> completedAt;
  std::optional<QString> deletedAt;
  std::int64_t sortOrder;
  QString createdAt;
  QString updatedAt;
};

struct PendingMutationSnapshot final {
  QString id;
  QString operation;
  QJsonObject payload;
};

[[nodiscard]] std::optional<hcb::FilePath>
databasePathFor(const QTemporaryDir& temporaryDirectory) {
  return hcb::FilePath::fromAbsolute(QDir(QFileInfo(temporaryDirectory.path()).canonicalFilePath())
                                         .filePath(QStringLiteral("hot-cross-buns.sqlite")));
}

template <typename Result> [[nodiscard]] Result awaitResult(std::future<Result>& future) {
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("task mutation service request timed out");
  }
  return future.get();
}

void verifyReady(hcb::TaskMutationService& service) {
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
          "('account-a', 'google', 'connected', '[]', '[]', '2026-07-25T00:00:00Z')");
  execute(handle,
          "INSERT INTO local_task_lists (id, account_id, remote_id, title, updated_at, deleted_at) "
          "VALUES "
          "('list-active', 'account-a', 'active', 'Active', '2026-07-25T00:00:00Z', NULL), "
          "('list-other', 'account-a', 'other', 'Other', '2026-07-25T00:00:00Z', NULL), "
          "('list-deleted', 'account-a', 'deleted', 'Deleted', '2026-07-25T00:00:00Z', "
          "'2026-07-25T01:00:00Z')");
}

[[nodiscard]] std::optional<QString> optionalText(sqlite3_stmt* statement, int index) {
  if (sqlite3_column_type(statement, index) == SQLITE_NULL) {
    return std::nullopt;
  }
  const auto* value = reinterpret_cast<const char*>(sqlite3_column_text(statement, index));
  const int byteCount = sqlite3_column_bytes(statement, index);
  if (value == nullptr || byteCount < 0) {
    return std::nullopt;
  }
  return QString::fromUtf8(value, byteCount);
}

[[nodiscard]] std::optional<TaskSnapshot> readTask(sqlite3* handle, const QString& taskId) {
  constexpr char sql[] = R"(
SELECT id, task_list_id, remote_id, parent_task_id, title, notes, state, due_at, due_time_zone,
       priority, completed_at, deleted_at, sort_order, created_at, updated_at
FROM local_tasks
WHERE id = ?1
)";
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const QByteArray taskIdUtf8 = taskId.toUtf8();
  if (sqlite3_bind_text(statement,
                        1,
                        taskIdUtf8.constData(),
                        static_cast<int>(taskIdUtf8.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const std::optional<QString> id = optionalText(statement, 0);
  const std::optional<QString> taskListId = optionalText(statement, 1);
  const std::optional<QString> remoteId = optionalText(statement, 2);
  const std::optional<QString> title = optionalText(statement, 4);
  const std::optional<QString> state = optionalText(statement, 6);
  const std::optional<QString> priority = optionalText(statement, 9);
  const std::optional<QString> createdAt = optionalText(statement, 13);
  const std::optional<QString> updatedAt = optionalText(statement, 14);
  const TaskSnapshot snapshot{.id = id.value_or(QString()),
                              .taskListId = taskListId.value_or(QString()),
                              .remoteId = remoteId.value_or(QString()),
                              .parentTaskId = optionalText(statement, 3),
                              .title = title.value_or(QString()),
                              .notes = optionalText(statement, 5),
                              .state = state.value_or(QString()),
                              .dueAt = optionalText(statement, 7),
                              .dueTimeZone = optionalText(statement, 8),
                              .priority = priority.value_or(QString()),
                              .completedAt = optionalText(statement, 10),
                              .deletedAt = optionalText(statement, 11),
                              .sortOrder = sqlite3_column_int64(statement, 12),
                              .createdAt = createdAt.value_or(QString()),
                              .updatedAt = updatedAt.value_or(QString())};
  const int finalizeResult = sqlite3_finalize(statement);
  return finalizeResult == SQLITE_OK ? std::optional<TaskSnapshot>(snapshot) : std::nullopt;
}

[[nodiscard]] std::int64_t pendingMutationCount(sqlite3* handle) {
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle,
                         "SELECT COUNT(*) FROM local_pending_mutations",
                         -1,
                         SQLITE_PREPARE_PERSISTENT,
                         &statement,
                         nullptr) != SQLITE_OK) {
    sqlite3_finalize(statement);
    return -1;
  }
  const int stepResult = sqlite3_step(statement);
  const std::int64_t count = sqlite3_column_int64(statement, 0);
  const int finalizeResult = sqlite3_finalize(statement);
  return stepResult == SQLITE_ROW && finalizeResult == SQLITE_OK ? count : -1;
}

[[nodiscard]] std::optional<PendingMutationSnapshot>
readPendingTaskMutation(sqlite3* handle, const QString& taskId) {
  constexpr char sql[] = R"(
SELECT id, operation, payload_json
FROM local_pending_mutations
WHERE resource_type = 'task' AND resource_id = ?1 AND status IN ('pending', 'failed')
ORDER BY created_at DESC, id DESC
LIMIT 1
)";
  sqlite3_stmt* statement = nullptr;
  if (sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr) !=
      SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const QByteArray taskIdUtf8 = taskId.toUtf8();
  if (sqlite3_bind_text(statement,
                        1,
                        taskIdUtf8.constData(),
                        static_cast<int>(taskIdUtf8.size()),
                        SQLITE_TRANSIENT) != SQLITE_OK) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  if (sqlite3_step(statement) != SQLITE_ROW) {
    sqlite3_finalize(statement);
    return std::nullopt;
  }
  const std::optional<QString> mutationId = optionalText(statement, 0);
  const std::optional<QString> operation = optionalText(statement, 1);
  const std::optional<QString> payloadJson = optionalText(statement, 2);
  const QJsonDocument payload =
      payloadJson.has_value() ? QJsonDocument::fromJson(payloadJson->toUtf8()) : QJsonDocument();
  const int finalizeResult = sqlite3_finalize(statement);
  return finalizeResult == SQLITE_OK && mutationId.has_value() && operation.has_value() &&
                 payload.isObject()
             ? std::optional<PendingMutationSnapshot>(PendingMutationSnapshot{
                   .id = *mutationId, .operation = *operation, .payload = payload.object()})
             : std::nullopt;
}

} // namespace

class TaskMutationServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void createsUpdatesCompletesAndDeletesTask();
  void queuesRemoteTaskChangesWithBaseEtag();
  void movesTaskToAnotherActiveList();
  void reordersTaskAmongSiblings();
  void createsAndReparentsOneLevelSubtasks();
  void rejectsInvalidAndUnavailableMutations();
};

void TaskMutationServiceTest::createsUpdatesCompletesAndDeletesTask() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const hcb::WallTimePoint fixedTime{std::chrono::milliseconds{1'753'408'000'123}};
  const FixedClock clock(fixedTime);
  const QString expectedTimestamp =
      QDateTime::fromMSecsSinceEpoch(1'753'408'000'123, QTimeZone::UTC).toString(Qt::ISODateWithMs);
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);

  std::future<hcb::TaskMutationResult> create = service.create(
      hcb::TaskCreateInput{.taskListId = QStringLiteral("list-active"),
                           .title = QStringLiteral(" Buy oat milk "),
                           .notes = QStringLiteral("two cartons"),
                           .due = hcb::TaskDue{.at = QStringLiteral("2026-07-26T09:30:00.000Z"),
                                               .timeZone = QStringLiteral("Asia/Singapore")},
                           .priority = hcb::TaskPriority::High});
  const hcb::TaskMutationResult createResult = awaitResult(create);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(createResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(createResult)) {
    return;
  }
  const hcb::TaskMutationReceipt receipt = std::get<hcb::TaskMutationReceipt>(createResult);
  QCOMPARE(receipt.updatedAt, expectedTimestamp);
  QVERIFY(receipt.taskId.startsWith(QStringLiteral("task:")));
  const std::optional<TaskSnapshot> created = readTask(handle, receipt.taskId);
  QVERIFY(created.has_value());
  if (!created.has_value()) {
    return;
  }
  QCOMPARE(created->remoteId, QStringLiteral("pending:") + receipt.taskId.mid(5));
  QCOMPARE(created->title, QStringLiteral("Buy oat milk"));
  QCOMPARE(created->notes, std::optional<QString>(QStringLiteral("two cartons")));
  QCOMPARE(created->state, QStringLiteral("active"));
  QCOMPARE(created->dueAt, std::optional<QString>(QStringLiteral("2026-07-26T09:30:00.000Z")));
  QCOMPARE(created->dueTimeZone, std::optional<QString>(QStringLiteral("Asia/Singapore")));
  QCOMPARE(created->priority, QStringLiteral("high"));
  QCOMPARE(created->sortOrder, 0);
  QCOMPARE(created->createdAt, expectedTimestamp);
  QCOMPARE(created->updatedAt, expectedTimestamp);
  QCOMPARE(pendingMutationCount(handle), 1);
  const std::optional<PendingMutationSnapshot> createMutation =
      readPendingTaskMutation(handle, receipt.taskId);
  QVERIFY(createMutation.has_value());
  if (!createMutation.has_value()) {
    return;
  }
  QCOMPARE(createMutation->operation, QStringLiteral("task.create"));
  QCOMPARE(createMutation->payload.value(QStringLiteral("taskListId")).toString(),
           QStringLiteral("active"));
  QCOMPARE(createMutation->payload.value(QStringLiteral("localTaskId")).toString(), receipt.taskId);
  QCOMPARE(createMutation->payload.value(QStringLiteral("task"))
               .toObject()
               .value(QStringLiteral("title"))
               .toString(),
           QStringLiteral("Buy oat milk"));
  QVERIFY(createMutation->payload.value(QStringLiteral("_hcbSync"))
              .toObject()
              .value(QStringLiteral("base"))
              .toObject()
              .isEmpty());

  std::future<hcb::TaskMutationResult> update =
      service.update(hcb::TaskUpdateInput{.taskId = receipt.taskId,
                                          .title = QStringLiteral(" Buy bread "),
                                          .notes = QString(),
                                          .due = hcb::TaskDue{},
                                          .priority = hcb::TaskPriority::Low});
  const hcb::TaskMutationResult updateResult = awaitResult(update);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(updateResult));
  const std::optional<TaskSnapshot> updated = readTask(handle, receipt.taskId);
  QVERIFY(updated.has_value());
  if (!updated.has_value()) {
    return;
  }
  QCOMPARE(updated->title, QStringLiteral("Buy bread"));
  QCOMPARE(updated->notes, std::optional<QString>(QString()));
  QVERIFY(!updated->dueAt.has_value());
  QVERIFY(!updated->dueTimeZone.has_value());
  QCOMPARE(updated->priority, QStringLiteral("low"));
  QCOMPARE(updated->updatedAt, expectedTimestamp);
  const std::optional<PendingMutationSnapshot> editedCreateMutation =
      readPendingTaskMutation(handle, receipt.taskId);
  QVERIFY(editedCreateMutation.has_value());
  if (!editedCreateMutation.has_value()) {
    return;
  }
  QCOMPARE(editedCreateMutation->operation, QStringLiteral("task.create"));
  QCOMPARE(editedCreateMutation->payload.value(QStringLiteral("task"))
               .toObject()
               .value(QStringLiteral("title"))
               .toString(),
           QStringLiteral("Buy bread"));

  std::future<hcb::TaskMutationResult> complete = service.setCompleted(receipt.taskId, true);
  const hcb::TaskMutationResult completeResult = awaitResult(complete);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(completeResult));
  const std::optional<TaskSnapshot> completed = readTask(handle, receipt.taskId);
  QVERIFY(completed.has_value());
  if (!completed.has_value()) {
    return;
  }
  QCOMPARE(completed->state, QStringLiteral("completed"));
  QCOMPARE(completed->completedAt, std::optional<QString>(expectedTimestamp));

  std::future<hcb::TaskMutationResult> reopen = service.setCompleted(receipt.taskId, false);
  const hcb::TaskMutationResult reopenResult = awaitResult(reopen);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(reopenResult));
  const std::optional<TaskSnapshot> reopened = readTask(handle, receipt.taskId);
  QVERIFY(reopened.has_value());
  if (!reopened.has_value()) {
    return;
  }
  QCOMPARE(reopened->state, QStringLiteral("active"));
  QVERIFY(!reopened->completedAt.has_value());
  const std::optional<PendingMutationSnapshot> reopenedCreateMutation =
      readPendingTaskMutation(handle, receipt.taskId);
  QVERIFY(reopenedCreateMutation.has_value());
  if (!reopenedCreateMutation.has_value()) {
    return;
  }
  QCOMPARE(reopenedCreateMutation->payload.value(QStringLiteral("task"))
               .toObject()
               .value(QStringLiteral("status"))
               .toString(),
           QStringLiteral("needsAction"));

  std::future<hcb::TaskMutationResult> remove = service.remove(receipt.taskId);
  const hcb::TaskMutationResult removeResult = awaitResult(remove);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(removeResult));
  const std::optional<TaskSnapshot> removed = readTask(handle, receipt.taskId);
  QVERIFY(removed.has_value());
  if (!removed.has_value()) {
    return;
  }
  QCOMPARE(removed->deletedAt, std::optional<QString>(expectedTimestamp));
  QCOMPARE(removed->updatedAt, expectedTimestamp);
  QCOMPARE(pendingMutationCount(handle), 0);
}

void TaskMutationServiceTest::queuesRemoteTaskChangesWithBaseEtag() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_tasks (id, task_list_id, remote_id, title, notes, state, due_at, "
          "etag, updated_at) VALUES "
          "('task-remote', 'list-active', 'remote-task', 'Base title', 'Base notes', 'active', "
          "'2026-08-01T00:00:00.000Z', 'task-etag', '2026-07-25T00:00:00Z')");

  std::future<hcb::TaskMutationResult> update = service.update(
      {.taskId = QStringLiteral("task-remote"), .title = QStringLiteral("Local title")});
  const hcb::TaskMutationResult updateResult = awaitResult(update);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(updateResult));
  const std::optional<PendingMutationSnapshot> updateMutation =
      readPendingTaskMutation(handle, QStringLiteral("task-remote"));
  QVERIFY(updateMutation.has_value());
  if (!updateMutation.has_value()) {
    return;
  }
  QCOMPARE(updateMutation->operation, QStringLiteral("task.update"));
  QCOMPARE(updateMutation->payload.value(QStringLiteral("remoteTaskId")).toString(),
           QStringLiteral("remote-task"));
  QCOMPARE(updateMutation->payload.value(QStringLiteral("task"))
               .toObject()
               .value(QStringLiteral("title"))
               .toString(),
           QStringLiteral("Local title"));
  const QJsonObject metadata = updateMutation->payload.value(QStringLiteral("_hcbSync")).toObject();
  QCOMPARE(metadata.value(QStringLiteral("etag")).toString(), QStringLiteral("task-etag"));
  QCOMPARE(
      metadata.value(QStringLiteral("base")).toObject().value(QStringLiteral("title")).toString(),
      QStringLiteral("Base title"));

  std::future<hcb::TaskMutationResult> complete =
      service.setCompleted(QStringLiteral("task-remote"), true);
  const hcb::TaskMutationResult completeResult = awaitResult(complete);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(completeResult));
  const std::optional<PendingMutationSnapshot> coalescedMutation =
      readPendingTaskMutation(handle, QStringLiteral("task-remote"));
  QVERIFY(coalescedMutation.has_value());
  if (!coalescedMutation.has_value()) {
    return;
  }
  QCOMPARE(pendingMutationCount(handle), 1);
  QCOMPARE(coalescedMutation->operation, QStringLiteral("task.update"));
  QCOMPARE(coalescedMutation->payload.value(QStringLiteral("task"))
               .toObject()
               .value(QStringLiteral("status"))
               .toString(),
           QStringLiteral("completed"));
  QCOMPARE(coalescedMutation->payload.value(QStringLiteral("_hcbSync"))
               .toObject()
               .value(QStringLiteral("base"))
               .toObject()
               .value(QStringLiteral("title"))
               .toString(),
           QStringLiteral("Base title"));

  std::future<hcb::TaskMutationResult> remove = service.remove(QStringLiteral("task-remote"));
  const hcb::TaskMutationResult removeResult = awaitResult(remove);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(removeResult));
  const std::optional<PendingMutationSnapshot> deleteMutation =
      readPendingTaskMutation(handle, QStringLiteral("task-remote"));
  QVERIFY(deleteMutation.has_value());
  if (!deleteMutation.has_value()) {
    return;
  }
  QCOMPARE(deleteMutation->operation, QStringLiteral("task.delete"));
  QCOMPARE(deleteMutation->payload.value(QStringLiteral("remoteTaskId")).toString(),
           QStringLiteral("remote-task"));
  QCOMPARE(deleteMutation->payload.value(QStringLiteral("_hcbSync"))
               .toObject()
               .value(QStringLiteral("etag"))
               .toString(),
           QStringLiteral("task-etag"));
}

void TaskMutationServiceTest::movesTaskToAnotherActiveList() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);

  std::future<hcb::TaskMutationResult> createDestinationTask = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-other"), .title = QStringLiteral("Destination task")});
  const hcb::TaskMutationResult destinationResult = awaitResult(createDestinationTask);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(destinationResult));

  std::future<hcb::TaskMutationResult> createMovableTask = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-active"), .title = QStringLiteral("Move me")});
  const hcb::TaskMutationResult movableResult = awaitResult(createMovableTask);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(movableResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(movableResult)) {
    return;
  }
  const QString movableId = std::get<hcb::TaskMutationReceipt>(movableResult).taskId;

  std::future<hcb::TaskMutationResult> move =
      service.moveToTaskList(movableId, QStringLiteral("list-other"));
  const hcb::TaskMutationResult moveResult = awaitResult(move);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(moveResult));
  const std::optional<TaskSnapshot> moved = readTask(handle, movableId);
  QVERIFY(moved.has_value());
  if (!moved.has_value()) {
    return;
  }
  QCOMPARE(moved->taskListId, QStringLiteral("list-other"));
  QVERIFY(!moved->parentTaskId.has_value());
  QCOMPARE(moved->sortOrder, 1);

  std::future<hcb::TaskMutationResult> sameListMove =
      service.moveToTaskList(movableId, QStringLiteral("list-other"));
  const hcb::TaskMutationResult sameListResult = awaitResult(sameListMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(sameListResult));
  QCOMPARE(std::get<hcb::AppError>(sameListResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> createParent = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-active"), .title = QStringLiteral("Parent")});
  const hcb::TaskMutationResult parentResult = awaitResult(createParent);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(parentResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(parentResult)) {
    return;
  }
  const QString parentId = std::get<hcb::TaskMutationReceipt>(parentResult).taskId;
  std::future<hcb::TaskMutationResult> createChild =
      service.create(hcb::TaskCreateInput{.taskListId = QStringLiteral("list-active"),
                                          .parentTaskId = parentId,
                                          .title = QStringLiteral("Child")});
  const hcb::TaskMutationResult childResult = awaitResult(createChild);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(childResult));

  std::future<hcb::TaskMutationResult> parentMove =
      service.moveToTaskList(parentId, QStringLiteral("list-other"));
  const hcb::TaskMutationResult parentMoveResult = awaitResult(parentMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(parentMoveResult));
  QCOMPARE(std::get<hcb::AppError>(parentMoveResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> deletedListMove =
      service.moveToTaskList(parentId, QStringLiteral("list-deleted"));
  const hcb::TaskMutationResult deletedListResult = awaitResult(deletedListMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(deletedListResult));
  QCOMPARE(std::get<hcb::AppError>(deletedListResult).code(), hcb::AppErrorCode::Validation);

  execute(handle,
          "INSERT INTO local_tasks (id, task_list_id, remote_id, title, state, due_at, "
          "due_time_zone, etag, updated_at) VALUES "
          "('task-remote', 'list-active', 'remote-original', 'Remote task', 'active', "
          "'2026-08-01T00:00:00.000Z', 'Asia/Singapore', 'remote-etag', "
          "'2026-07-25T00:00:00Z')");
  std::future<hcb::TaskMutationResult> remoteMove =
      service.moveToTaskList(QStringLiteral("task-remote"), QStringLiteral("list-other"));
  const hcb::TaskMutationResult remoteMoveResult = awaitResult(remoteMove);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(remoteMoveResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(remoteMoveResult)) {
    return;
  }
  const QString replacementId = std::get<hcb::TaskMutationReceipt>(remoteMoveResult).taskId;
  QVERIFY(replacementId != QStringLiteral("task-remote"));
  const std::optional<TaskSnapshot> original = readTask(handle, QStringLiteral("task-remote"));
  const std::optional<TaskSnapshot> replacement = readTask(handle, replacementId);
  QVERIFY(original.has_value());
  QVERIFY(replacement.has_value());
  if (!original.has_value() || !replacement.has_value()) {
    return;
  }
  QVERIFY(original->deletedAt.has_value());
  QCOMPARE(replacement->taskListId, QStringLiteral("list-other"));
  QVERIFY(replacement->remoteId.startsWith(QStringLiteral("pending:")));
  QCOMPARE(replacement->dueAt, std::optional<QString>(QStringLiteral("2026-08-01T00:00:00.000Z")));
  QCOMPARE(replacement->dueTimeZone, std::optional<QString>(QStringLiteral("Asia/Singapore")));
  const std::optional<PendingMutationSnapshot> replacementCreate =
      readPendingTaskMutation(handle, replacementId);
  const std::optional<PendingMutationSnapshot> originalDelete =
      readPendingTaskMutation(handle, QStringLiteral("task-remote"));
  QVERIFY(replacementCreate.has_value());
  QVERIFY(originalDelete.has_value());
  if (!replacementCreate.has_value() || !originalDelete.has_value()) {
    return;
  }
  QCOMPARE(replacementCreate->operation, QStringLiteral("task.create"));
  QCOMPARE(originalDelete->operation, QStringLiteral("task.delete"));
  QCOMPARE(originalDelete->payload.value(QStringLiteral("remoteTaskId")).toString(),
           QStringLiteral("remote-original"));
  QCOMPARE(originalDelete->payload.value(QStringLiteral("dependsOnMutationId")).toString(),
           replacementCreate->id);
}

void TaskMutationServiceTest::reordersTaskAmongSiblings() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);
  execute(handle,
          "INSERT INTO local_tasks (id, task_list_id, remote_id, title, state, sort_order, "
          "updated_at) VALUES "
          "('task-a', 'list-active', 'remote-a', 'A', 'active', 0, '2026-07-25T00:00:00Z'), "
          "('task-b', 'list-active', 'remote-b', 'B', 'active', 1, '2026-07-25T00:00:00Z'), "
          "('task-c', 'list-active', 'remote-c', 'C', 'active', 2, '2026-07-25T00:00:00Z')");

  std::future<hcb::TaskMutationResult> reordered =
      service.reorder(QStringLiteral("task-b"), hcb::TaskReorderDirection::Earlier);
  const hcb::TaskMutationResult reorderedResult = awaitResult(reordered);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(reorderedResult));
  const std::optional<TaskSnapshot> taskA = readTask(handle, QStringLiteral("task-a"));
  const std::optional<TaskSnapshot> taskB = readTask(handle, QStringLiteral("task-b"));
  const std::optional<TaskSnapshot> taskC = readTask(handle, QStringLiteral("task-c"));
  QVERIFY(taskA.has_value());
  QVERIFY(taskB.has_value());
  QVERIFY(taskC.has_value());
  if (!taskA.has_value() || !taskB.has_value() || !taskC.has_value()) {
    return;
  }
  QCOMPARE(taskB->sortOrder, 0);
  QCOMPARE(taskA->sortOrder, 1);
  QCOMPARE(taskC->sortOrder, 2);
  const std::optional<PendingMutationSnapshot> moveMutation =
      readPendingTaskMutation(handle, QStringLiteral("task-b"));
  QVERIFY(moveMutation.has_value());
  if (!moveMutation.has_value()) {
    return;
  }
  QCOMPARE(moveMutation->operation, QStringLiteral("task.move"));
  QCOMPARE(moveMutation->payload.value(QStringLiteral("remoteTaskId")).toString(),
           QStringLiteral("remote-b"));
  QVERIFY(!moveMutation->payload.contains(QStringLiteral("previousTaskId")));

  std::future<hcb::TaskMutationResult> noFurtherMove =
      service.reorder(QStringLiteral("task-c"), hcb::TaskReorderDirection::Later);
  const hcb::TaskMutationResult noFurtherMoveResult = awaitResult(noFurtherMove);
  QVERIFY(std::holds_alternative<hcb::AppError>(noFurtherMoveResult));
  QCOMPARE(std::get<hcb::AppError>(noFurtherMoveResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> movedLater =
      service.reorder(QStringLiteral("task-a"), hcb::TaskReorderDirection::Later);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(awaitResult(movedLater)));
  const std::optional<PendingMutationSnapshot> moveLaterMutation =
      readPendingTaskMutation(handle, QStringLiteral("task-a"));
  QVERIFY(moveLaterMutation.has_value());
  if (!moveLaterMutation.has_value()) {
    return;
  }
  QCOMPARE(moveLaterMutation->operation, QStringLiteral("task.move"));
  QCOMPARE(moveLaterMutation->payload.value(QStringLiteral("previousTaskId")).toString(),
           QStringLiteral("remote-c"));
}

void TaskMutationServiceTest::createsAndReparentsOneLevelSubtasks() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);
  sqlite3* const handle = connection.nativeHandle();
  QVERIFY(handle != nullptr);

  std::future<hcb::TaskMutationResult> createParent = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-active"), .title = QStringLiteral("Parent")});
  const hcb::TaskMutationResult parentResult = awaitResult(createParent);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(parentResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(parentResult)) {
    return;
  }
  const QString parentId = std::get<hcb::TaskMutationReceipt>(parentResult).taskId;

  std::future<hcb::TaskMutationResult> createChild =
      service.create(hcb::TaskCreateInput{.taskListId = QStringLiteral("list-active"),
                                          .parentTaskId = parentId,
                                          .title = QStringLiteral("Child")});
  const hcb::TaskMutationResult childResult = awaitResult(createChild);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(childResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(childResult)) {
    return;
  }
  const QString childId = std::get<hcb::TaskMutationReceipt>(childResult).taskId;
  const std::optional<TaskSnapshot> child = readTask(handle, childId);
  QVERIFY(child.has_value());
  if (!child.has_value()) {
    return;
  }
  QCOMPARE(child->parentTaskId, std::optional<QString>(parentId));

  std::future<hcb::TaskMutationResult> createGrandchild =
      service.create(hcb::TaskCreateInput{.taskListId = QStringLiteral("list-active"),
                                          .parentTaskId = childId,
                                          .title = QStringLiteral("Grandchild")});
  const hcb::TaskMutationResult grandchildResult = awaitResult(createGrandchild);
  QVERIFY(std::holds_alternative<hcb::AppError>(grandchildResult));
  QCOMPARE(std::get<hcb::AppError>(grandchildResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> createRoot = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-active"), .title = QStringLiteral("Move me")});
  const hcb::TaskMutationResult rootResult = awaitResult(createRoot);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(rootResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(rootResult)) {
    return;
  }
  const QString rootId = std::get<hcb::TaskMutationReceipt>(rootResult).taskId;
  const std::optional<std::optional<QString>> attachParent{std::optional<QString>(parentId)};
  std::future<hcb::TaskMutationResult> attach =
      service.update(hcb::TaskUpdateInput{.taskId = rootId, .parentTaskId = attachParent});
  const hcb::TaskMutationResult attachResult = awaitResult(attach);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(attachResult));
  const std::optional<TaskSnapshot> attached = readTask(handle, rootId);
  QVERIFY(attached.has_value());
  if (!attached.has_value()) {
    return;
  }
  QCOMPARE(attached->parentTaskId, std::optional<QString>(parentId));

  const std::optional<std::optional<QString>> detachParent{std::optional<QString>{}};
  std::future<hcb::TaskMutationResult> detach =
      service.update(hcb::TaskUpdateInput{.taskId = rootId, .parentTaskId = detachParent});
  const hcb::TaskMutationResult detachResult = awaitResult(detach);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(detachResult));
  const std::optional<TaskSnapshot> detached = readTask(handle, rootId);
  QVERIFY(detached.has_value());
  if (!detached.has_value()) {
    return;
  }
  QVERIFY(!detached->parentTaskId.has_value());

  std::future<hcb::TaskMutationResult> createOtherListRoot = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-other"), .title = QStringLiteral("Other list root")});
  const hcb::TaskMutationResult otherListRootResult = awaitResult(createOtherListRoot);
  QVERIFY(std::holds_alternative<hcb::TaskMutationReceipt>(otherListRootResult));
  if (!std::holds_alternative<hcb::TaskMutationReceipt>(otherListRootResult)) {
    return;
  }
  const QString otherListRootId = std::get<hcb::TaskMutationReceipt>(otherListRootResult).taskId;
  const std::optional<std::optional<QString>> crossListParent{
      std::optional<QString>(otherListRootId)};
  std::future<hcb::TaskMutationResult> attachAcrossLists =
      service.update(hcb::TaskUpdateInput{.taskId = rootId, .parentTaskId = crossListParent});
  const hcb::TaskMutationResult attachAcrossListsResult = awaitResult(attachAcrossLists);
  QVERIFY(std::holds_alternative<hcb::AppError>(attachAcrossListsResult));
  QCOMPARE(std::get<hcb::AppError>(attachAcrossListsResult).code(), hcb::AppErrorCode::Validation);

  const std::optional<std::optional<QString>> invalidParent{std::optional<QString>(rootId)};
  std::future<hcb::TaskMutationResult> nestParent =
      service.update(hcb::TaskUpdateInput{.taskId = parentId, .parentTaskId = invalidParent});
  const hcb::TaskMutationResult nestParentResult = awaitResult(nestParent);
  QVERIFY(std::holds_alternative<hcb::AppError>(nestParentResult));
  QCOMPARE(std::get<hcb::AppError>(nestParentResult).code(), hcb::AppErrorCode::Validation);
}

void TaskMutationServiceTest::rejectsInvalidAndUnavailableMutations() {
  QTemporaryDir temporaryDirectory;
  QVERIFY(temporaryDirectory.isValid());
  const std::optional<hcb::FilePath> databasePath = databasePathFor(temporaryDirectory);
  QVERIFY(databasePath.has_value());
  if (!databasePath.has_value()) {
    return;
  }
  const FixedClock clock(hcb::WallTimePoint{std::chrono::milliseconds{1'753'408'000'123}});
  hcb::TaskMutationService service(*databasePath, clock);
  verifyReady(service);
  hcb::SqliteConnectionResult connectionResult =
      hcb::SqliteConnectionFactory::open(*databasePath, hcb::SqliteOpenMode::ReadWriteCreate);
  QVERIFY(std::holds_alternative<hcb::SqliteConnection>(connectionResult));
  if (!std::holds_alternative<hcb::SqliteConnection>(connectionResult)) {
    return;
  }
  hcb::SqliteConnection connection = std::move(std::get<hcb::SqliteConnection>(connectionResult));
  seed(connection);

  std::future<hcb::TaskMutationResult> invalidTitle = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-active"), .title = QStringLiteral("   ")});
  const hcb::TaskMutationResult invalidTitleResult = awaitResult(invalidTitle);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidTitleResult));
  QCOMPARE(std::get<hcb::AppError>(invalidTitleResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> invalidDue = service.create(
      hcb::TaskCreateInput{.taskListId = QStringLiteral("list-active"),
                           .title = QStringLiteral("Task"),
                           .due = hcb::TaskDue{.at = QStringLiteral("2026-07-26T09:30:00.000Z"),
                                               .timeZone = QStringLiteral("Invalid/TimeZone")}});
  const hcb::TaskMutationResult invalidDueResult = awaitResult(invalidDue);
  QVERIFY(std::holds_alternative<hcb::AppError>(invalidDueResult));
  QCOMPARE(std::get<hcb::AppError>(invalidDueResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> unavailableList = service.create(hcb::TaskCreateInput{
      .taskListId = QStringLiteral("list-deleted"), .title = QStringLiteral("Task")});
  const hcb::TaskMutationResult unavailableListResult = awaitResult(unavailableList);
  QVERIFY(std::holds_alternative<hcb::AppError>(unavailableListResult));
  QCOMPARE(std::get<hcb::AppError>(unavailableListResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> emptyUpdate =
      service.update(hcb::TaskUpdateInput{.taskId = QStringLiteral("missing-task")});
  const hcb::TaskMutationResult emptyUpdateResult = awaitResult(emptyUpdate);
  QVERIFY(std::holds_alternative<hcb::AppError>(emptyUpdateResult));
  QCOMPARE(std::get<hcb::AppError>(emptyUpdateResult).code(), hcb::AppErrorCode::Validation);

  std::future<hcb::TaskMutationResult> unavailableTask =
      service.setCompleted(QStringLiteral("missing-task"), true);
  const hcb::TaskMutationResult unavailableTaskResult = awaitResult(unavailableTask);
  QVERIFY(std::holds_alternative<hcb::AppError>(unavailableTaskResult));
  QCOMPARE(std::get<hcb::AppError>(unavailableTaskResult).code(), hcb::AppErrorCode::Validation);
}

QTEST_GUILESS_MAIN(TaskMutationServiceTest)

#include "TaskMutationServiceTest.moc"
