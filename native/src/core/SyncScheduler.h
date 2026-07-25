#pragma once

#include "core/AppError.h"

#include <chrono>
#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <variant>
#include <vector>

namespace hcb {

enum class SyncScheduleTrigger : std::uint8_t {
  Startup,
  Manual,
  NetworkRestored,
  Periodic
};

struct SyncSchedulerRequest final {
  std::vector<SyncScheduleTrigger> triggers;
};

struct SyncSchedulerRun final {
  std::vector<SyncScheduleTrigger> triggers;
};

struct SyncSchedulerSnapshot final {
  bool online{true};
  bool running{false};
  bool pending{false};
  bool periodic{false};
  bool stopped{false};
};

using SyncSchedulerExecutor =
    std::function<std::optional<AppError>(const SyncSchedulerRequest& request)>;
using SyncSchedulerResult = std::variant<SyncSchedulerRun, AppError>;

class SyncScheduler final {
public:
  explicit SyncScheduler(SyncSchedulerExecutor executor);
  ~SyncScheduler();
  SyncScheduler(const SyncScheduler&) = delete;
  SyncScheduler& operator=(const SyncScheduler&) = delete;

  [[nodiscard]] std::future<SyncSchedulerResult> request(SyncScheduleTrigger trigger);
  void setOnline(bool online);
  [[nodiscard]] bool startPeriodic(std::chrono::milliseconds interval);
  void stop();
  [[nodiscard]] SyncSchedulerSnapshot snapshot() const;

private:
  struct State;

  static void enqueuePeriodic(const std::shared_ptr<State>& state);
  static void startNext(const std::shared_ptr<State>& state);

  std::shared_ptr<State> state_;
};

} // namespace hcb
