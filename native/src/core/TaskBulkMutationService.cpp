#include "core/TaskBulkMutationService.h"

#include <QDateTime>
#include <QHash>
#include <QSet>

#include <deque>
#include <future>
#include <optional>
#include <utility>
#include <variant>

namespace hcb {
namespace {

constexpr qsizetype kMaximumTaskCount = 500;
constexpr qsizetype kMaximumIdentifierLength = 256;
constexpr qsizetype kMaximumInFlightWrites = 4;

template <typename Result> [[nodiscard]] std::future<Result> readyFuture(Result result) {
  std::promise<Result> completion;
  std::future<Result> future = completion.get_future();
  completion.set_value(std::move(result));
  return future;
}

[[nodiscard]] AppError validationError(QString message) {
  return AppError(AppErrorCode::Validation, std::move(message));
}

[[nodiscard]] bool isValidIdentifier(const QString& value) {
  return !value.isEmpty() && value == value.trimmed() && value.size() <= kMaximumIdentifierLength &&
         !value.contains(QChar::Null);
}

[[nodiscard]] bool isValidPriority(TaskPriority priority) {
  switch (priority) {
  case TaskPriority::None:
  case TaskPriority::Low:
  case TaskPriority::Medium:
  case TaskPriority::High:
    return true;
  }
  return false;
}

[[nodiscard]] bool isValidDue(const TaskDue& due) {
  if (!due.at.has_value()) {
    return !due.timeZone.has_value();
  }
  return !due.at->isEmpty() && QDateTime::fromString(*due.at, Qt::ISODate).isValid() &&
         (!due.timeZone.has_value() || !due.timeZone->trimmed().isEmpty());
}

[[nodiscard]] std::optional<AppError> validate(const TaskBulkMutationInput& input) {
  if (input.taskIds.isEmpty() || input.taskIds.size() > kMaximumTaskCount) {
    return validationError(QStringLiteral("Bulk task selection is invalid"));
  }
  QSet<QString> uniqueIds;
  for (const QString& taskId : input.taskIds) {
    if (!isValidIdentifier(taskId) || uniqueIds.contains(taskId)) {
      return validationError(QStringLiteral("Bulk task selection is invalid"));
    }
    uniqueIds.insert(taskId);
  }
  if (input.action == TaskBulkAction::MoveToList &&
      (!input.taskListId.has_value() || !isValidIdentifier(*input.taskListId))) {
    return validationError(QStringLiteral("Bulk task destination is invalid"));
  }
  if (input.action == TaskBulkAction::SetDue &&
      (!input.due.has_value() || !input.due->at.has_value() || !isValidDue(*input.due))) {
    return validationError(QStringLiteral("Bulk task due date is invalid"));
  }
  if (input.action == TaskBulkAction::SetPriority &&
      (!input.priority.has_value() || !isValidPriority(*input.priority))) {
    return validationError(QStringLiteral("Bulk task priority is invalid"));
  }
  if (input.action == TaskBulkAction::Reparent && input.parentTaskId.has_value() &&
      (!isValidIdentifier(*input.parentTaskId) || uniqueIds.contains(*input.parentTaskId))) {
    return validationError(QStringLiteral("Bulk task parent is invalid"));
  }
  return std::nullopt;
}

[[nodiscard]] std::future<TaskMutationResult>
submit(TaskMutationService& service, const TaskBulkMutationInput& input, const QString& taskId) {
  switch (input.action) {
  case TaskBulkAction::Complete:
    return service.setCompleted(taskId, true);
  case TaskBulkAction::Reopen:
    return service.setCompleted(taskId, false);
  case TaskBulkAction::Delete:
    return service.remove(taskId);
  case TaskBulkAction::MoveToList:
    return service.moveToTaskList(taskId, *input.taskListId);
  case TaskBulkAction::SetDue:
    return service.update({.taskId = taskId, .due = input.due});
  case TaskBulkAction::ClearDue:
    return service.update({.taskId = taskId, .due = TaskDue{}});
  case TaskBulkAction::SetPriority:
    return service.update({.taskId = taskId, .priority = input.priority});
  case TaskBulkAction::Reparent: {
    const std::optional<std::optional<QString>> parent =
        input.parentTaskId.has_value()
            ? std::optional<std::optional<QString>>(input.parentTaskId)
            : std::optional<std::optional<QString>>(std::optional<QString>{});
    return service.update({.taskId = taskId, .parentTaskId = parent});
  }
  }
  return readyFuture(TaskMutationResult(validationError(QStringLiteral("Bulk task action is invalid"))));
}

[[nodiscard]] std::optional<QString>
ineligibility(const TaskBulkMutationInput& input,
              const TaskMutationSnapshot& task,
              const QHash<QString, TaskMutationSnapshot>& snapshots,
              const QSet<QString>& selectedIds) {
  switch (input.action) {
  case TaskBulkAction::Complete:
    return task.completed ? std::optional<QString>(QStringLiteral("Task is already completed"))
                          : std::nullopt;
  case TaskBulkAction::Reopen:
    return !task.completed ? std::optional<QString>(QStringLiteral("Task is already active"))
                           : std::nullopt;
  case TaskBulkAction::Delete:
    for (const QString& selectedId : selectedIds) {
      const auto selected = snapshots.constFind(selectedId);
      if (selected != snapshots.cend() && selected->parentTaskId == task.taskId) {
        return QStringLiteral("Selection includes a direct subtask");
      }
    }
    return std::nullopt;
  case TaskBulkAction::MoveToList:
    if (task.taskListId == *input.taskListId) {
      return QStringLiteral("Task is already in that list");
    }
    return task.hasActiveChildren
               ? std::optional<QString>(QStringLiteral("Task with subtasks cannot move between lists"))
               : std::nullopt;
  case TaskBulkAction::SetDue:
    return task.dueAt == input.due->at && task.dueTimeZone == input.due->timeZone
               ? std::optional<QString>(QStringLiteral("Task already has that due date"))
               : std::nullopt;
  case TaskBulkAction::ClearDue:
    return !task.dueAt.has_value() ? std::optional<QString>(QStringLiteral("Task has no due date"))
                                   : std::nullopt;
  case TaskBulkAction::SetPriority:
    return task.priority == *input.priority
               ? std::optional<QString>(QStringLiteral("Task already has that priority"))
               : std::nullopt;
  case TaskBulkAction::Reparent:
    if (task.hasActiveChildren) {
      return QStringLiteral("Task with subtasks cannot be reparented");
    }
    if (!input.parentTaskId.has_value()) {
      return !task.parentTaskId.has_value()
                 ? std::optional<QString>(QStringLiteral("Task is already top level"))
                 : std::nullopt;
    }
    const auto parent = snapshots.constFind(*input.parentTaskId);
    if (parent == snapshots.cend()) {
      return QStringLiteral("Parent task is unavailable");
    }
    if (parent->parentTaskId.has_value() || parent->taskListId != task.taskListId) {
      return QStringLiteral("Parent task is not a compatible top-level task");
    }
    return task.parentTaskId == *input.parentTaskId
               ? std::optional<QString>(QStringLiteral("Task already has that parent"))
               : std::nullopt;
  }
  return QStringLiteral("Bulk task action is invalid");
}

void recordResult(TaskBulkMutationSummary& summary,
                  TaskBulkMutationItem& item,
                  TaskMutationResult result) {
  if (std::holds_alternative<TaskMutationReceipt>(result)) {
    item.outcome = TaskBulkItemOutcome::Queued;
    item.message = QStringLiteral("Queued for Google sync");
    ++summary.queued;
    return;
  }
  const AppError& error = std::get<AppError>(result);
  if (error.code() == AppErrorCode::Validation || error.code() == AppErrorCode::Cancelled) {
    item.outcome = TaskBulkItemOutcome::Skipped;
    item.message = error.message();
    ++summary.skipped;
    return;
  }
  item.outcome = TaskBulkItemOutcome::Failed;
  item.message = error.message();
  ++summary.failed;
}

} // namespace

TaskBulkMutationService::TaskBulkMutationService(TaskMutationService& taskMutationService)
    : taskMutationService_(taskMutationService) {}

std::future<TaskBulkMutationResult> TaskBulkMutationService::execute(TaskBulkMutationInput input) {
  if (const std::optional<AppError> error = validate(input); error.has_value()) {
    return readyFuture(TaskBulkMutationResult(*error));
  }
  try {
    return std::async(std::launch::async,
                      [this, input = std::move(input)]() mutable -> TaskBulkMutationResult {
                        QList<QString> inspectedIds = input.taskIds;
                        if (input.action == TaskBulkAction::Reparent && input.parentTaskId.has_value()) {
                          inspectedIds.append(*input.parentTaskId);
                        }
                        TaskMutationSnapshotResult inspected =
                            taskMutationService_.inspect(std::move(inspectedIds)).get();
                        if (std::holds_alternative<AppError>(inspected)) {
                          return std::get<AppError>(std::move(inspected));
                        }
                        QHash<QString, TaskMutationSnapshot> snapshots;
                        for (TaskMutationSnapshot& task :
                             std::get<QList<TaskMutationSnapshot>>(inspected)) {
                          snapshots.insert(task.taskId, std::move(task));
                        }
                        QSet<QString> selectedIds;
                        for (const QString& taskId : input.taskIds) {
                          selectedIds.insert(taskId);
                        }
                        TaskBulkMutationSummary summary{
                            .requested = static_cast<int>(input.taskIds.size())};
                        summary.items.reserve(input.taskIds.size());
                        struct PendingWrite final {
                          qsizetype itemIndex;
                          std::future<TaskMutationResult> future;
                        };
                        std::deque<PendingWrite> pending;
                        const auto collectFirst = [&summary, &pending] {
                          PendingWrite write = std::move(pending.front());
                          pending.pop_front();
                          recordResult(summary, summary.items[write.itemIndex], write.future.get());
                        };
                        for (const QString& taskId : input.taskIds) {
                          TaskBulkMutationItem item{.taskId = taskId};
                          const auto task = snapshots.constFind(taskId);
                          if (task == snapshots.cend()) {
                            item.message = QStringLiteral("Task is no longer available");
                            ++summary.skipped;
                            summary.items.append(std::move(item));
                            continue;
                          }
                          if (const std::optional<QString> reason =
                                  ineligibility(input, *task, snapshots, selectedIds);
                              reason.has_value()) {
                            item.message = *reason;
                            ++summary.skipped;
                            summary.items.append(std::move(item));
                            continue;
                          }
                          const qsizetype itemIndex = summary.items.size();
                          summary.items.append(std::move(item));
                          ++summary.eligible;
                          pending.push_back({.itemIndex = itemIndex,
                                             .future = submit(taskMutationService_, input, taskId)});
                          if (pending.size() >= static_cast<std::size_t>(kMaximumInFlightWrites)) {
                            collectFirst();
                          }
                        }
                        while (!pending.empty()) {
                          collectFirst();
                        }
                        return summary;
                      });
  } catch (...) {
    return readyFuture(TaskBulkMutationResult(
        AppError(AppErrorCode::Database, QStringLiteral("Bulk task mutation could not start"))));
  }
}

} // namespace hcb
