#include "core/SyncScheduler.h"

#include <algorithm>
#include <condition_variable>
#include <exception>
#include <mutex>
#include <optional>
#include <thread>
#include <utility>

namespace hcb {
namespace {

struct WaitingSyncRequest final {
  SyncScheduleTrigger trigger;
  std::shared_ptr<std::promise<SyncSchedulerResult>> completion;
};

[[nodiscard]] AppError cancelledError() {
  return AppError(AppErrorCode::Cancelled, QStringLiteral("Sync scheduler is stopped"));
}

[[nodiscard]] AppError executionError() {
  return AppError(AppErrorCode::Network, QStringLiteral("Scheduled sync execution failed"));
}

[[nodiscard]] std::vector<SyncScheduleTrigger>
coalescedTriggers(const std::vector<WaitingSyncRequest>& requests) {
  std::vector<SyncScheduleTrigger> triggers;
  for (const WaitingSyncRequest& request : requests) {
    if (std::find(triggers.cbegin(), triggers.cend(), request.trigger) == triggers.cend()) {
      triggers.push_back(request.trigger);
    }
  }
  return triggers;
}

void complete(const std::vector<WaitingSyncRequest>& requests,
              const SyncSchedulerResult& result) noexcept {
  for (const WaitingSyncRequest& request : requests) {
    if (request.completion != nullptr) {
      try {
        request.completion->set_value(result);
      } catch (const std::future_error&) {
        std::terminate();
      }
    }
  }
}

} // namespace

struct SyncScheduler::State final {
  explicit State(SyncSchedulerExecutor executorValue) : executor(std::move(executorValue)) {}

  std::mutex mutex;
  std::condition_variable timerWake;
  SyncSchedulerExecutor executor;
  std::vector<WaitingSyncRequest> pending;
  std::thread periodicThread;
  std::chrono::milliseconds interval{0};
  bool online{true};
  bool running{false};
  bool periodic{false};
  bool stopped{false};
};

SyncScheduler::SyncScheduler(SyncSchedulerExecutor executor)
    : state_(std::make_shared<State>(std::move(executor))) {}

SyncScheduler::~SyncScheduler() { stop(); }

std::future<SyncSchedulerResult> SyncScheduler::request(SyncScheduleTrigger trigger) {
  auto completion = std::make_shared<std::promise<SyncSchedulerResult>>();
  std::future<SyncSchedulerResult> future = completion->get_future();
  bool cancelled = false;
  {
    std::lock_guard<std::mutex> lock(state_->mutex);
    cancelled = state_->stopped;
    if (!cancelled) {
      state_->pending.push_back({.trigger = trigger, .completion = completion});
    }
  }
  if (cancelled) {
    completion->set_value(cancelledError());
  } else {
    startNext(state_);
  }
  return future;
}

void SyncScheduler::setOnline(bool online) {
  {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->stopped) {
      return;
    }
    state_->online = online;
  }
  if (online) {
    startNext(state_);
  }
}

bool SyncScheduler::startPeriodic(std::chrono::milliseconds interval) {
  if (interval <= std::chrono::milliseconds::zero()) {
    return false;
  }
  {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->stopped || state_->periodic || state_->periodicThread.joinable()) {
      return false;
    }
    state_->interval = interval;
    state_->periodic = true;
  }
  try {
    std::thread periodicThread([state = state_] {
      std::unique_lock<std::mutex> lock(state->mutex);
      while (!state->stopped && state->periodic) {
        const bool interrupted = state->timerWake.wait_for(
            lock, state->interval, [state] { return state->stopped || !state->periodic; });
        if (interrupted) {
          break;
        }
        lock.unlock();
        enqueuePeriodic(state);
        lock.lock();
      }
    });
    {
      std::lock_guard<std::mutex> lock(state_->mutex);
      if (!state_->stopped) {
        state_->periodicThread = std::move(periodicThread);
        return true;
      }
    }
    periodicThread.join();
  } catch (...) {
    std::lock_guard<std::mutex> lock(state_->mutex);
    state_->periodic = false;
    return false;
  }
  return false;
}

void SyncScheduler::stop() {
  std::vector<WaitingSyncRequest> pending;
  std::thread periodicThread;
  {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->stopped) {
      return;
    }
    state_->stopped = true;
    state_->periodic = false;
    pending = std::move(state_->pending);
    periodicThread = std::move(state_->periodicThread);
  }
  state_->timerWake.notify_all();
  if (periodicThread.joinable()) {
    periodicThread.join();
  }
  complete(pending, SyncSchedulerResult(cancelledError()));
}

SyncSchedulerSnapshot SyncScheduler::snapshot() const {
  std::lock_guard<std::mutex> lock(state_->mutex);
  return {.online = state_->online,
          .running = state_->running,
          .pending = !state_->pending.empty(),
          .periodic = state_->periodic,
          .stopped = state_->stopped};
}

void SyncScheduler::enqueuePeriodic(const std::shared_ptr<State>& state) {
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->stopped) {
      return;
    }
    state->pending.push_back({.trigger = SyncScheduleTrigger::Periodic, .completion = nullptr});
  }
  startNext(state);
}

void SyncScheduler::startNext(const std::shared_ptr<State>& state) {
  std::vector<WaitingSyncRequest> requests;
  SyncSchedulerRequest request;
  {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->stopped || !state->online || state->running || state->pending.empty()) {
      return;
    }
    state->running = true;
    requests = std::move(state->pending);
    state->pending.clear();
    request.triggers = coalescedTriggers(requests);
  }
  try {
    std::thread([state, requests = std::move(requests), request = std::move(request)]() mutable {
      std::optional<AppError> error;
      try {
        error = state->executor(request);
      } catch (...) {
        error = executionError();
      }
      const SyncSchedulerResult result =
          error.has_value() ? SyncSchedulerResult(*error)
                            : SyncSchedulerResult(SyncSchedulerRun{.triggers = request.triggers});
      complete(requests, result);
      {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->running = false;
      }
      startNext(state);
    }).detach();
  } catch (...) {
    {
      std::lock_guard<std::mutex> lock(state->mutex);
      state->running = false;
    }
    complete(requests, SyncSchedulerResult(executionError()));
    startNext(state);
  }
}

} // namespace hcb
