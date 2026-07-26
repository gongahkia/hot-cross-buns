#pragma once

#include "core/AppError.h"
#include "core/TaskMutationService.h"

#include <QList>
#include <QString>

#include <cstdint>
#include <future>
#include <optional>
#include <variant>

namespace hcb {

enum class TaskBulkAction : std::uint8_t {
  Complete,
  Reopen,
  Delete,
  MoveToList,
  SetDue,
  ClearDue,
  SetPriority,
  Reparent
};

enum class TaskBulkItemOutcome : std::uint8_t {
  Queued,
  Skipped,
  Failed
};

struct TaskBulkMutationInput final {
  TaskBulkAction action{TaskBulkAction::Complete};
  QList<QString> taskIds;
  std::optional<QString> taskListId;
  std::optional<TaskDue> due;
  std::optional<TaskPriority> priority;
  std::optional<QString> parentTaskId;
};

struct TaskBulkMutationItem final {
  QString taskId;
  TaskBulkItemOutcome outcome{TaskBulkItemOutcome::Skipped};
  QString message;
};

struct TaskBulkMutationSummary final {
  int requested{0};
  int eligible{0};
  int applied{0};
  int queued{0};
  int conflicted{0};
  int failed{0};
  int skipped{0};
  QList<TaskBulkMutationItem> items;
};

using TaskBulkMutationResult = std::variant<TaskBulkMutationSummary, AppError>;

class TaskBulkMutationService final {
public:
  explicit TaskBulkMutationService(TaskMutationService& taskMutationService);
  TaskBulkMutationService(const TaskBulkMutationService&) = delete;
  TaskBulkMutationService& operator=(const TaskBulkMutationService&) = delete;

  [[nodiscard]] std::future<TaskBulkMutationResult> execute(TaskBulkMutationInput input);

private:
  TaskMutationService& taskMutationService_;
};

} // namespace hcb
