#pragma once

#include "core/AppError.h"
#include "core/FilePath.h"
#include "data/SqliteConnection.h"

#include <condition_variable>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <optional>
#include <thread>

namespace hcb {

using SqliteWriteResult = std::optional<AppError>;
using SqliteWriteTask = std::function<SqliteWriteResult(SqliteConnection& connection)>;

class SqliteWriterQueue final {
public:
  explicit SqliteWriterQueue(FilePath databasePath);
  SqliteWriterQueue(const SqliteWriterQueue&) = delete;
  SqliteWriterQueue& operator=(const SqliteWriterQueue&) = delete;
  ~SqliteWriterQueue();

  [[nodiscard]] std::shared_future<SqliteWriteResult> ready() const;
  [[nodiscard]] std::future<SqliteWriteResult> enqueue(SqliteWriteTask task);
  void shutdown();

private:
  struct PendingTask final {
    SqliteWriteTask task;
    std::promise<SqliteWriteResult> completion;
  };

  void run(FilePath databasePath);
  void failStartup(AppError error);

  std::mutex mutex_;
  std::condition_variable workAvailable_;
  std::deque<PendingTask> pendingTasks_;
  std::optional<AppError> startupError_;
  bool accepting_{true};
  std::promise<SqliteWriteResult> readyPromise_;
  std::shared_future<SqliteWriteResult> readyFuture_;
  std::thread worker_;
};

} // namespace hcb
