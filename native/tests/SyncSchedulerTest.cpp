#include <QtTest/QTest>

#include "core/SyncScheduler.h"

#include <chrono>
#include <condition_variable>
#include <future>
#include <mutex>
#include <optional>
#include <utility>
#include <variant>
#include <vector>

using namespace std::chrono_literals;

class SyncSchedulerTest final : public QObject {
  Q_OBJECT

private slots:
  void defersOfflineRequestsUntilOnline();
  void coalescesOfflineWorkAfterReconnect();
  void serializesAndCoalescesRequests();
  void runsPeriodicallyAndStops();
  void propagatesExecutorFailures();
  void recoversFromOnlineFailureAfterReconnect();
  void rejectsRequestsAfterStop();
};

namespace {

struct ExecutorProbe final {
  std::mutex mutex;
  std::condition_variable wake;
  std::vector<hcb::SyncSchedulerRequest> requests;
  bool blockFirst{false};
  bool released{false};

  [[nodiscard]] std::optional<hcb::AppError> execute(const hcb::SyncSchedulerRequest& request) {
    std::unique_lock<std::mutex> lock(mutex);
    requests.push_back(request);
    wake.notify_all();
    if (blockFirst && requests.size() == 1) {
      wake.wait(lock, [this] { return released; });
    }
    return std::nullopt;
  }

  [[nodiscard]] bool awaitRequests(std::size_t count) {
    std::unique_lock<std::mutex> lock(mutex);
    return wake.wait_for(lock, 2s, [this, count] { return requests.size() >= count; });
  }

  void releaseFirst() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      released = true;
    }
    wake.notify_all();
  }
};

[[nodiscard]] hcb::SyncSchedulerRun awaitRun(std::future<hcb::SyncSchedulerResult>& future) {
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("sync scheduler request timed out");
  }
  const hcb::SyncSchedulerResult result = future.get();
  if (!std::holds_alternative<hcb::SyncSchedulerRun>(result)) {
    qFatal("sync scheduler request failed");
  }
  return std::get<hcb::SyncSchedulerRun>(result);
}

} // namespace

void SyncSchedulerTest::defersOfflineRequestsUntilOnline() {
  ExecutorProbe probe;
  hcb::SyncScheduler scheduler(
      [&probe](const hcb::SyncSchedulerRequest& request) { return probe.execute(request); });
  scheduler.setOnline(false);
  std::future<hcb::SyncSchedulerResult> future =
      scheduler.request(hcb::SyncScheduleTrigger::Startup);
  QCOMPARE(future.wait_for(50ms), std::future_status::timeout);
  const hcb::SyncSchedulerSnapshot offline = scheduler.snapshot();
  QVERIFY(!offline.online);
  QVERIFY(offline.pending);
  scheduler.setOnline(true);
  const hcb::SyncSchedulerRun run = awaitRun(future);
  QCOMPARE(run.triggers, std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Startup});
  QVERIFY(probe.awaitRequests(1));
}

void SyncSchedulerTest::coalescesOfflineWorkAfterReconnect() {
  ExecutorProbe probe;
  hcb::SyncScheduler scheduler(
      [&probe](const hcb::SyncSchedulerRequest& request) { return probe.execute(request); });
  scheduler.setOnline(false);
  std::future<hcb::SyncSchedulerResult> manual =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  std::future<hcb::SyncSchedulerResult> periodic =
      scheduler.request(hcb::SyncScheduleTrigger::Periodic);
  QCOMPARE(manual.wait_for(50ms), std::future_status::timeout);
  QCOMPARE(periodic.wait_for(50ms), std::future_status::timeout);
  scheduler.setOnline(true);
  const std::vector<hcb::SyncScheduleTrigger> expected{hcb::SyncScheduleTrigger::Manual,
                                                       hcb::SyncScheduleTrigger::Periodic};
  QCOMPARE(awaitRun(manual).triggers, expected);
  QCOMPARE(awaitRun(periodic).triggers, expected);
  QVERIFY(probe.awaitRequests(1));
  std::lock_guard<std::mutex> lock(probe.mutex);
  QCOMPARE(probe.requests.size(), std::size_t{1});
  QCOMPARE(probe.requests.front().triggers, expected);
}

void SyncSchedulerTest::serializesAndCoalescesRequests() {
  ExecutorProbe probe;
  probe.blockFirst = true;
  hcb::SyncScheduler scheduler(
      [&probe](const hcb::SyncSchedulerRequest& request) { return probe.execute(request); });
  std::future<hcb::SyncSchedulerResult> first =
      scheduler.request(hcb::SyncScheduleTrigger::Startup);
  QVERIFY(probe.awaitRequests(1));
  std::future<hcb::SyncSchedulerResult> second =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  std::future<hcb::SyncSchedulerResult> third =
      scheduler.request(hcb::SyncScheduleTrigger::NetworkRestored);
  std::future<hcb::SyncSchedulerResult> fourth =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  QCOMPARE(second.wait_for(50ms), std::future_status::timeout);
  probe.releaseFirst();
  QCOMPARE(awaitRun(first).triggers,
           std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Startup});
  QCOMPARE(awaitRun(second).triggers,
           (std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Manual,
                                                  hcb::SyncScheduleTrigger::NetworkRestored}));
  QCOMPARE(awaitRun(third).triggers,
           (std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Manual,
                                                  hcb::SyncScheduleTrigger::NetworkRestored}));
  QCOMPARE(awaitRun(fourth).triggers,
           (std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Manual,
                                                  hcb::SyncScheduleTrigger::NetworkRestored}));
  QVERIFY(probe.awaitRequests(2));
  std::lock_guard<std::mutex> lock(probe.mutex);
  QCOMPARE(probe.requests.size(), std::size_t{2});
  QCOMPARE(probe.requests[1].triggers,
           (std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Manual,
                                                  hcb::SyncScheduleTrigger::NetworkRestored}));
}

void SyncSchedulerTest::runsPeriodicallyAndStops() {
  ExecutorProbe probe;
  hcb::SyncScheduler scheduler(
      [&probe](const hcb::SyncSchedulerRequest& request) { return probe.execute(request); });
  QVERIFY(scheduler.startPeriodic(20ms));
  QVERIFY(!scheduler.startPeriodic(20ms));
  QVERIFY(probe.awaitRequests(1));
  scheduler.stop();
  {
    std::lock_guard<std::mutex> lock(probe.mutex);
    QCOMPARE(probe.requests.front().triggers,
             std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::Periodic});
  }
  const hcb::SyncSchedulerSnapshot stopped = scheduler.snapshot();
  QVERIFY(stopped.stopped);
  QVERIFY(!stopped.periodic);
}

void SyncSchedulerTest::propagatesExecutorFailures() {
  hcb::SyncScheduler scheduler([](const hcb::SyncSchedulerRequest&) {
    return std::optional<hcb::AppError>(
        hcb::AppError(hcb::AppErrorCode::Network, QStringLiteral("offline")));
  });
  std::future<hcb::SyncSchedulerResult> future =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("failed sync scheduler request timed out");
  }
  const hcb::SyncSchedulerResult result = future.get();
  QVERIFY(std::holds_alternative<hcb::AppError>(result));
  QCOMPARE(std::get<hcb::AppError>(result).code(), hcb::AppErrorCode::Network);
}

void SyncSchedulerTest::recoversFromOnlineFailureAfterReconnect() {
  int executions = 0;
  hcb::SyncScheduler scheduler([&executions](const hcb::SyncSchedulerRequest&) {
    ++executions;
    return executions == 1 ? std::optional<hcb::AppError>(hcb::AppError(hcb::AppErrorCode::Network,
                                                                        QStringLiteral("offline")))
                           : std::optional<hcb::AppError>{};
  });
  std::future<hcb::SyncSchedulerResult> failed =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  if (failed.wait_for(2s) != std::future_status::ready) {
    qFatal("offline sync request timed out");
  }
  QVERIFY(std::holds_alternative<hcb::AppError>(failed.get()));
  scheduler.setOnline(false);
  std::future<hcb::SyncSchedulerResult> resumed =
      scheduler.request(hcb::SyncScheduleTrigger::NetworkRestored);
  QCOMPARE(resumed.wait_for(50ms), std::future_status::timeout);
  scheduler.setOnline(true);
  QCOMPARE(awaitRun(resumed).triggers,
           std::vector<hcb::SyncScheduleTrigger>{hcb::SyncScheduleTrigger::NetworkRestored});
  QCOMPARE(executions, 2);
}

void SyncSchedulerTest::rejectsRequestsAfterStop() {
  hcb::SyncScheduler scheduler(
      [](const hcb::SyncSchedulerRequest&) { return std::optional<hcb::AppError>{}; });
  scheduler.stop();
  std::future<hcb::SyncSchedulerResult> future =
      scheduler.request(hcb::SyncScheduleTrigger::Manual);
  if (future.wait_for(2s) != std::future_status::ready) {
    qFatal("stopped sync scheduler request timed out");
  }
  const hcb::SyncSchedulerResult result = future.get();
  QVERIFY(std::holds_alternative<hcb::AppError>(result));
  QCOMPARE(std::get<hcb::AppError>(result).code(), hcb::AppErrorCode::Cancelled);
}

QTEST_GUILESS_MAIN(SyncSchedulerTest)

#include "SyncSchedulerTest.moc"
