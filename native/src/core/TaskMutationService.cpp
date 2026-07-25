#include "core/TaskMutationService.h"

#include "data/LocalSchema.h"
#include "sqlite3.h"

#include <QByteArray>
#include <QDateTime>
#include <QString>
#include <QTimeZone>
#include <QUuid>

#include <chrono>
#include <future>
#include <initializer_list>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr qsizetype kMaximumIdentifierLength = 256;
constexpr qsizetype kMaximumTitleLength = 500;
constexpr qsizetype kMaximumNotesLength = 10'000;
constexpr qsizetype kMaximumTimestampLength = 64;
constexpr qsizetype kMaximumTimeZoneLength = 128;

[[nodiscard]] AppError databaseError(const QString& message, int result) {
  return AppError(AppErrorCode::Database, message.arg(result));
}

[[nodiscard]] AppError validationError(QString message) {
  return AppError(AppErrorCode::Validation, std::move(message));
}

template <typename Result> [[nodiscard]] std::future<Result> readyFuture(Result result) {
  std::promise<Result> completion;
  std::future<Result> future = completion.get_future();
  completion.set_value(std::move(result));
  return future;
}

[[nodiscard]] bool isValidRequiredText(const QString& value, qsizetype maximumLength) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= maximumLength &&
         !value.contains(QChar::Null);
}

[[nodiscard]] bool isValidNotes(const std::optional<QString>& value) {
  return !value.has_value() ||
         (value->size() <= kMaximumNotesLength && !value->contains(QChar::Null));
}

[[nodiscard]] bool isValidTimestamp(const QString& value) {
  return isValidRequiredText(value, kMaximumTimestampLength) &&
         QDateTime::fromString(value, Qt::ISODate).isValid();
}

[[nodiscard]] bool isValidDue(const std::optional<TaskDue>& due) {
  if (!due.has_value()) {
    return true;
  }
  if (!due->at.has_value()) {
    return !due->timeZone.has_value();
  }
  if (!isValidTimestamp(*due->at)) {
    return false;
  }
  if (!due->timeZone.has_value()) {
    return true;
  }
  return isValidRequiredText(*due->timeZone, kMaximumTimeZoneLength) &&
         QTimeZone(due->timeZone->toUtf8()).isValid();
}

[[nodiscard]] QString priorityText(TaskPriority priority) {
  switch (priority) {
  case TaskPriority::None:
    return QStringLiteral("none");
  case TaskPriority::Low:
    return QStringLiteral("low");
  case TaskPriority::Medium:
    return QStringLiteral("medium");
  case TaskPriority::High:
    return QStringLiteral("high");
  }
  return {};
}

[[nodiscard]] bool isValidPriority(TaskPriority priority) {
  return !priorityText(priority).isEmpty();
}

[[nodiscard]] QString timestamp(const Clock& clock) {
  const auto milliseconds =
      std::chrono::duration_cast<std::chrono::milliseconds>(clock.wallNow().time_since_epoch());
  return QDateTime::fromMSecsSinceEpoch(milliseconds.count(), QTimeZone::UTC)
      .toString(Qt::ISODateWithMs);
}

[[nodiscard]] std::optional<AppError>
bindText(sqlite3_stmt* statement, int index, const QString& value) {
  const QByteArray utf8 = value.toUtf8();
  const int result = sqlite3_bind_text(
      statement, index, utf8.constData(), static_cast<int>(utf8.size()), SQLITE_TRANSIENT);
  if (result != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task binding failed (%1)"), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
bindOptionalText(sqlite3_stmt* statement, int index, const std::optional<QString>& value) {
  if (!value.has_value()) {
    const int result = sqlite3_bind_null(statement, index);
    if (result != SQLITE_OK) {
      return databaseError(QStringLiteral("SQLite task binding failed (%1)"), result);
    }
    return std::nullopt;
  }
  return bindText(statement, index, *value);
}

[[nodiscard]] std::optional<AppError> bindInteger(sqlite3_stmt* statement, int index, int value) {
  const int result = sqlite3_bind_int(statement, index, value);
  if (result != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task binding failed (%1)"), result);
  }
  return std::nullopt;
}

[[nodiscard]] std::optional<AppError>
bindAll(sqlite3_stmt* statement, const std::initializer_list<std::optional<AppError>>& results) {
  for (const std::optional<AppError>& result : results) {
    if (result.has_value()) {
      sqlite3_finalize(statement);
      return result;
    }
  }
  return std::nullopt;
}

[[nodiscard]] std::variant<TaskCreateInput, AppError> canonicalize(TaskCreateInput input) {
  input.title = input.title.trimmed();
  if (!isValidRequiredText(input.taskListId, kMaximumIdentifierLength) ||
      (input.parentTaskId.has_value() &&
       !isValidRequiredText(*input.parentTaskId, kMaximumIdentifierLength)) ||
      !isValidRequiredText(input.title, kMaximumTitleLength) || !isValidNotes(input.notes) ||
      !isValidDue(input.due) || !isValidPriority(input.priority)) {
    return validationError(QStringLiteral("Task create input is invalid"));
  }
  return input;
}

[[nodiscard]] std::variant<TaskUpdateInput, AppError> canonicalize(TaskUpdateInput input) {
  if (input.title.has_value()) {
    *input.title = input.title->trimmed();
  }
  if (!isValidRequiredText(input.taskId, kMaximumIdentifierLength) ||
      (input.parentTaskId.has_value() && input.parentTaskId->has_value() &&
       !isValidRequiredText(**input.parentTaskId, kMaximumIdentifierLength)) ||
      (input.title.has_value() && !isValidRequiredText(*input.title, kMaximumTitleLength)) ||
      !isValidNotes(input.notes) || !isValidDue(input.due) ||
      (input.priority.has_value() && !isValidPriority(*input.priority)) ||
      (!input.parentTaskId.has_value() && !input.title.has_value() && !input.notes.has_value() &&
       !input.due.has_value() && !input.priority.has_value())) {
    return validationError(QStringLiteral("Task update input is invalid"));
  }
  return input;
}

[[nodiscard]] TaskMutationResult createStoredTask(SqliteConnection& connection,
                                                  const TaskCreateInput& input,
                                                  const QString& taskId,
                                                  const QString& remoteId,
                                                  const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite task connection is unavailable"));
  }
  constexpr char sql[] = R"(
INSERT INTO local_tasks (
  id, task_list_id, remote_id, parent_task_id, title, notes, state, due_at, due_time_zone,
  sort_order, is_hidden, priority, created_at, updated_at
)
SELECT ?1, lists.id, ?3, ?4, ?5, ?6, 'active', ?7, ?8,
       COALESCE((SELECT MAX(tasks.sort_order) + 1
                 FROM local_tasks AS tasks
                 WHERE tasks.task_list_id = lists.id
                   AND ((?4 IS NULL AND tasks.parent_task_id IS NULL)
                        OR tasks.parent_task_id = ?4)
                   AND tasks.deleted_at IS NULL), 0),
       0, ?9, ?10, ?10
FROM local_task_lists AS lists
WHERE lists.id = ?2
  AND lists.deleted_at IS NULL
  AND (?4 IS NULL OR EXISTS (SELECT 1
                             FROM local_tasks AS parent
                             WHERE parent.id = ?4
                               AND parent.task_list_id = lists.id
                               AND parent.parent_task_id IS NULL
                               AND parent.deleted_at IS NULL))
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite task create preparation failed (%1)"),
                         prepareResult);
  }
  const std::optional<QString> dueAt = input.due.has_value() ? input.due->at : std::nullopt;
  const std::optional<QString> dueTimeZone =
      input.due.has_value() ? input.due->timeZone : std::nullopt;
  if (const std::optional<AppError> error =
          bindAll(statement,
                  {bindText(statement, 1, taskId),
                   bindText(statement, 2, input.taskListId),
                   bindText(statement, 3, remoteId),
                   bindOptionalText(statement, 4, input.parentTaskId),
                   bindText(statement, 5, input.title),
                   bindOptionalText(statement, 6, input.notes),
                   bindOptionalText(statement, 7, dueAt),
                   bindOptionalText(statement, 8, dueTimeZone),
                   bindText(statement, 9, priorityText(input.priority)),
                   bindText(statement, 10, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite task create failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task create finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Task list is unavailable for task creation"));
  }
  return TaskMutationReceipt{.taskId = taskId, .updatedAt = updatedAt};
}

[[nodiscard]] TaskMutationResult updateStoredTask(SqliteConnection& connection,
                                                  const TaskUpdateInput& input,
                                                  const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite task connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_tasks
SET parent_task_id = CASE WHEN ?2 = 1 THEN ?3 ELSE parent_task_id END,
    sort_order = CASE WHEN ?2 = 1 THEN COALESCE((SELECT MAX(sibling.sort_order) + 1
                                                  FROM local_tasks AS sibling
                                                  WHERE sibling.task_list_id = local_tasks.task_list_id
                                                    AND sibling.id != local_tasks.id
                                                    AND sibling.deleted_at IS NULL
                                                    AND ((?3 IS NULL AND sibling.parent_task_id IS NULL)
                                                         OR sibling.parent_task_id = ?3)), 0)
                      ELSE sort_order END,
    title = CASE WHEN ?4 = 1 THEN ?5 ELSE title END,
    notes = CASE WHEN ?6 = 1 THEN ?7 ELSE notes END,
    due_at = CASE WHEN ?8 = 1 THEN ?9 ELSE due_at END,
    due_time_zone = CASE WHEN ?8 = 1 THEN ?10 ELSE due_time_zone END,
    priority = CASE WHEN ?11 = 1 THEN ?12 ELSE priority END,
    updated_at = ?13
WHERE id = ?1
  AND deleted_at IS NULL
  AND (?2 = 0 OR NOT EXISTS (SELECT 1
                             FROM local_tasks AS descendant
                             WHERE descendant.parent_task_id = local_tasks.id
                               AND descendant.deleted_at IS NULL))
  AND (?2 = 0 OR ?3 IS NULL OR EXISTS (SELECT 1
                                        FROM local_tasks AS parent
                                        WHERE parent.id = ?3
                                          AND parent.id != local_tasks.id
                                          AND parent.task_list_id = local_tasks.task_list_id
                                          AND parent.parent_task_id IS NULL
                                          AND parent.deleted_at IS NULL))
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite task update preparation failed (%1)"),
                         prepareResult);
  }
  const std::optional<QString> dueAt = input.due.has_value() ? input.due->at : std::nullopt;
  const std::optional<QString> dueTimeZone =
      input.due.has_value() ? input.due->timeZone : std::nullopt;
  const QString priority = input.priority.has_value() ? priorityText(*input.priority) : QString();
  const std::optional<QString> parentTaskId =
      input.parentTaskId.has_value() ? *input.parentTaskId : std::nullopt;
  if (const std::optional<AppError> error =
          bindAll(statement,
                  {bindText(statement, 1, input.taskId),
                   bindInteger(statement, 2, input.parentTaskId.has_value()),
                   bindOptionalText(statement, 3, parentTaskId),
                   bindInteger(statement, 4, input.title.has_value()),
                   bindOptionalText(statement, 5, input.title),
                   bindInteger(statement, 6, input.notes.has_value()),
                   bindOptionalText(statement, 7, input.notes),
                   bindInteger(statement, 8, input.due.has_value()),
                   bindOptionalText(statement, 9, dueAt),
                   bindOptionalText(statement, 10, dueTimeZone),
                   bindInteger(statement, 11, input.priority.has_value()),
                   bindText(statement, 12, priority),
                   bindText(statement, 13, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite task update failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task update finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Task is unavailable for update"));
  }
  return TaskMutationReceipt{.taskId = input.taskId, .updatedAt = updatedAt};
}

[[nodiscard]] TaskMutationResult setStoredTaskCompletion(SqliteConnection& connection,
                                                         const QString& taskId,
                                                         bool completed,
                                                         const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite task connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_tasks
SET state = ?2,
    completed_at = ?3,
    updated_at = ?4
WHERE id = ?1 AND deleted_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite task completion preparation failed (%1)"),
                         prepareResult);
  }
  const std::optional<QString> completedAt =
      completed ? std::optional<QString>(updatedAt) : std::nullopt;
  if (const std::optional<AppError> error = bindAll(
          statement,
          {bindText(statement, 1, taskId),
           bindText(
               statement, 2, completed ? QStringLiteral("completed") : QStringLiteral("active")),
           bindOptionalText(statement, 3, completedAt),
           bindText(statement, 4, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite task completion failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task completion finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Task is unavailable for completion"));
  }
  return TaskMutationReceipt{.taskId = taskId, .updatedAt = updatedAt};
}

[[nodiscard]] TaskMutationResult
removeStoredTask(SqliteConnection& connection, const QString& taskId, const QString& updatedAt) {
  sqlite3* const handle = connection.nativeHandle();
  if (handle == nullptr) {
    return AppError(AppErrorCode::Database,
                    QStringLiteral("SQLite task connection is unavailable"));
  }
  constexpr char sql[] = R"(
UPDATE local_tasks
SET deleted_at = ?2,
    updated_at = ?2
WHERE id = ?1 AND deleted_at IS NULL
)";
  sqlite3_stmt* statement = nullptr;
  const int prepareResult =
      sqlite3_prepare_v3(handle, sql, -1, SQLITE_PREPARE_PERSISTENT, &statement, nullptr);
  if (prepareResult != SQLITE_OK) {
    sqlite3_finalize(statement);
    return databaseError(QStringLiteral("SQLite task deletion preparation failed (%1)"),
                         prepareResult);
  }
  if (const std::optional<AppError> error =
          bindAll(statement, {bindText(statement, 1, taskId), bindText(statement, 2, updatedAt)});
      error.has_value()) {
    return *error;
  }
  const int stepResult = sqlite3_step(statement);
  const int changedRows = sqlite3_changes(handle);
  const int finalizeResult = sqlite3_finalize(statement);
  if (stepResult != SQLITE_DONE) {
    return databaseError(QStringLiteral("SQLite task deletion failed (%1)"), stepResult);
  }
  if (finalizeResult != SQLITE_OK) {
    return databaseError(QStringLiteral("SQLite task deletion finalization failed (%1)"),
                         finalizeResult);
  }
  if (changedRows != 1) {
    return validationError(QStringLiteral("Task is unavailable for deletion"));
  }
  return TaskMutationReceipt{.taskId = taskId, .updatedAt = updatedAt};
}

} // namespace

TaskMutationService::TaskMutationService(FilePath databasePath, const Clock& clock)
    : clock_(clock), writerQueue_(std::move(databasePath)),
      initialization_(writerQueue_
                          .enqueue([](SqliteConnection& connection) -> SqliteWriteResult {
                            const SqliteMigrationRunResultOrError result =
                                LocalSchema::initialize(connection);
                            return std::holds_alternative<AppError>(result)
                                       ? std::optional<AppError>(std::get<AppError>(result))
                                       : std::nullopt;
                          })
                          .share()) {}

std::shared_future<SqliteWriteResult> TaskMutationService::ready() const { return initialization_; }

std::future<TaskMutationResult> TaskMutationService::create(TaskCreateInput input) {
  const std::variant<TaskCreateInput, AppError> canonical = canonicalize(std::move(input));
  if (std::holds_alternative<AppError>(canonical)) {
    return readyFuture(TaskMutationResult(std::get<AppError>(canonical)));
  }
  const QString localId = QUuid::createUuid().toString(QUuid::WithoutBraces);
  const QString taskId = QStringLiteral("task:") + localId;
  const QString remoteId = QStringLiteral("pending:") + localId;
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::get<TaskCreateInput>(canonical), taskId, remoteId, updatedAt](
          SqliteConnection& connection) {
        return createStoredTask(connection, input, taskId, remoteId, updatedAt);
      });
}

std::future<TaskMutationResult> TaskMutationService::update(TaskUpdateInput input) {
  const std::variant<TaskUpdateInput, AppError> canonical = canonicalize(std::move(input));
  if (std::holds_alternative<AppError>(canonical)) {
    return readyFuture(TaskMutationResult(std::get<AppError>(canonical)));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [input = std::get<TaskUpdateInput>(canonical), updatedAt](SqliteConnection& connection) {
        return updateStoredTask(connection, input, updatedAt);
      });
}

std::future<TaskMutationResult> TaskMutationService::setCompleted(QString taskId, bool completed) {
  if (!isValidRequiredText(taskId, kMaximumIdentifierLength)) {
    return readyFuture(
        TaskMutationResult(validationError(QStringLiteral("Task completion input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [taskId = std::move(taskId), completed, updatedAt](SqliteConnection& connection) {
        return setStoredTaskCompletion(connection, taskId, completed, updatedAt);
      });
}

std::future<TaskMutationResult> TaskMutationService::remove(QString taskId) {
  if (!isValidRequiredText(taskId, kMaximumIdentifierLength)) {
    return readyFuture(
        TaskMutationResult(validationError(QStringLiteral("Task deletion input is invalid"))));
  }
  const QString updatedAt = timestamp(clock_);
  return writerQueue_.enqueueResult(
      [taskId = std::move(taskId), updatedAt](SqliteConnection& connection) {
        return removeStoredTask(connection, taskId, updatedAt);
      });
}

} // namespace hcb
