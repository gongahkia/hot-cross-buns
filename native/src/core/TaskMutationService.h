#pragma once

#include "core/AppError.h"
#include "core/Clock.h"
#include "core/FilePath.h"
#include "data/SqliteWriterQueue.h"

#include <QString>

#include <cstdint>
#include <future>
#include <optional>
#include <variant>

namespace hcb {

enum class TaskPriority : std::uint8_t {
  None,
  Low,
  Medium,
  High
};

struct TaskDue final {
  std::optional<QString> at;
  std::optional<QString> timeZone;
};

struct TaskCreateInput final {
  QString taskListId;
  std::optional<QString> parentTaskId;
  QString title;
  std::optional<QString> notes;
  std::optional<TaskDue> due;
  TaskPriority priority{TaskPriority::None};
};

struct TaskUpdateInput final {
  QString taskId;
  std::optional<std::optional<QString>> parentTaskId;
  std::optional<QString> title;
  std::optional<QString> notes;
  std::optional<TaskDue> due;
  std::optional<TaskPriority> priority;
};

struct TaskMutationReceipt final {
  QString taskId;
  QString updatedAt;
};

struct TaskRemoteReconciliationInput final {
  QString localTaskId;
  QString remoteTaskId;
  std::optional<QString> remoteEtag;
};

using TaskMutationResult = std::variant<TaskMutationReceipt, AppError>;
using TaskRemoteIdResult = std::variant<std::optional<QString>, AppError>;

class TaskMutationService final {
public:
  TaskMutationService(FilePath databasePath, const Clock& clock);
  TaskMutationService(const TaskMutationService&) = delete;
  TaskMutationService& operator=(const TaskMutationService&) = delete;

  [[nodiscard]] std::shared_future<SqliteWriteResult> ready() const;
  [[nodiscard]] std::future<TaskMutationResult> create(TaskCreateInput input);
  [[nodiscard]] std::future<TaskMutationResult> update(TaskUpdateInput input);
  [[nodiscard]] std::future<TaskMutationResult> moveToTaskList(QString taskId, QString taskListId);
  [[nodiscard]] std::future<TaskMutationResult> setCompleted(QString taskId, bool completed);
  [[nodiscard]] std::future<TaskMutationResult> remove(QString taskId);
  [[nodiscard]] std::future<TaskMutationResult>
  reconcileGoogleTask(TaskRemoteReconciliationInput input);
  [[nodiscard]] std::future<TaskRemoteIdResult> remoteTaskId(QString taskId);

private:
  const Clock& clock_;
  SqliteWriterQueue writerQueue_;
  std::shared_future<SqliteWriteResult> initialization_;
};

} // namespace hcb
