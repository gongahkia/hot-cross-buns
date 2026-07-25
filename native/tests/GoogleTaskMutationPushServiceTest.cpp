#include <QtTest/QTest>

#include "core/Clock.h"
#include "core/GoogleHttpClient.h"
#include "core/GoogleTaskMutationPushService.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/SyncBackoffPolicy.h"
#include "support/MockNetworkAccessManager.h"
#include "support/TemporarySqliteDatabase.h"

#include <QDateTime>
#include <QCoreApplication>
#include <QEventLoop>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimeZone>
#include <QUrlQuery>

#include <chrono>
#include <future>
#include <memory>
#include <optional>
#include <thread>
#include <utility>
#include <variant>

using namespace std::chrono_literals;

class GoogleTaskMutationPushServiceTest final : public QObject {
  Q_OBJECT

private slots:
  void pushesCreateUpdateAndDeleteMutations();
  void recordsPermanentAndRetriableFailures();
};

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

template <typename Result> [[nodiscard]] Result awaitResult(std::future<Result>& future) {
  const auto deadline = std::chrono::steady_clock::now() + 1s;
  while (future.wait_for(0ms) != std::future_status::ready &&
         std::chrono::steady_clock::now() < deadline) {
    QCoreApplication::processEvents(QEventLoop::AllEvents, 10);
    std::this_thread::sleep_for(1ms);
  }
  if (future.wait_for(0ms) != std::future_status::ready) {
    qFatal("task mutation push request timed out");
  }
  return future.get();
}

[[nodiscard]] std::unique_ptr<hcb::test::TemporarySqliteDatabase> createDatabase() {
  hcb::test::TemporarySqliteDatabaseResult result = hcb::test::TemporarySqliteDatabase::create();
  if (!std::holds_alternative<std::unique_ptr<hcb::test::TemporarySqliteDatabase>>(result)) {
    return nullptr;
  }
  return std::move(std::get<std::unique_ptr<hcb::test::TemporarySqliteDatabase>>(result));
}

void verifyReady(hcb::OptimisticMutationCoordinator& coordinator) {
  const std::shared_future<hcb::SqliteWriteResult> ready = coordinator.ready();
  QCOMPARE(ready.wait_for(2s), std::future_status::ready);
  QVERIFY(!ready.get().has_value());
}

[[nodiscard]] hcb::PendingMutation
enqueue(hcb::OptimisticMutationCoordinator& coordinator, QString operation, QJsonObject payload) {
  std::future<hcb::PendingMutationResult> future =
      coordinator.enqueue({.resource = hcb::PendingMutationResource::Task,
                           .resourceId = QStringLiteral("task-local"),
                           .operation = std::move(operation),
                           .payload = std::move(payload)});
  const hcb::PendingMutationResult result = awaitResult(future);
  if (!std::holds_alternative<hcb::PendingMutation>(result)) {
    qFatal("task mutation enqueue failed");
  }
  return std::get<hcb::PendingMutation>(result);
}

[[nodiscard]] hcb::PendingMutation find(hcb::OptimisticMutationCoordinator& coordinator,
                                        const QString& mutationId) {
  std::future<hcb::PendingMutationLookupResult> future = coordinator.find(mutationId);
  const hcb::PendingMutationLookupResult result = awaitResult(future);
  if (!std::holds_alternative<std::optional<hcb::PendingMutation>>(result) ||
      !std::get<std::optional<hcb::PendingMutation>>(result).has_value()) {
    qFatal("task mutation was not found");
  }
  return *std::get<std::optional<hcb::PendingMutation>>(result);
}

[[nodiscard]] hcb::GoogleTaskMutationPushResult push(hcb::GoogleTaskMutationPushService& service) {
  std::future<hcb::GoogleTaskMutationPushResultOrError> future =
      service.pushDue(QStringLiteral("access-token"));
  const hcb::GoogleTaskMutationPushResultOrError result = awaitResult(future);
  if (!std::holds_alternative<hcb::GoogleTaskMutationPushResult>(result)) {
    qFatal("task mutation push failed");
  }
  return std::get<hcb::GoogleTaskMutationPushResult>(result);
}

} // namespace

void GoogleTaskMutationPushServiceTest::pushesCreateUpdateAndDeleteMutations() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  FixedClock clock;
  hcb::OptimisticMutationCoordinator coordinator(database->databasePath(), clock);
  verifyReady(coordinator);
  const hcb::PendingMutation created = enqueue(
      coordinator,
      QStringLiteral("task.create"),
      {{QStringLiteral("taskListId"), QStringLiteral("list-1")},
       {QStringLiteral("parentTaskId"), QStringLiteral("parent-1")},
       {QStringLiteral("previousTaskId"), QStringLiteral("previous-1")},
       {QStringLiteral("task"),
        QJsonObject{{QStringLiteral("title"), QStringLiteral(" Write report ")},
                    {QStringLiteral("notes"), QStringLiteral("draft")},
                    {QStringLiteral("status"), QStringLiteral("needsAction")},
                    {QStringLiteral("due"), QStringLiteral("2026-08-01T18:30:00+08:00")}}}});
  const hcb::PendingMutation updated =
      enqueue(coordinator,
              QStringLiteral("task.update"),
              {{QStringLiteral("taskListId"), QStringLiteral("list-1")},
               {QStringLiteral("remoteTaskId"), QStringLiteral("remote-1")},
               {QStringLiteral("etag"), QStringLiteral("etag-1")},
               {QStringLiteral("task"),
                QJsonObject{{QStringLiteral("status"), QStringLiteral("completed")},
                            {QStringLiteral("due"), QJsonValue::Null}}}});
  const hcb::PendingMutation removed =
      enqueue(coordinator,
              QStringLiteral("task.delete"),
              {{QStringLiteral("taskListId"), QStringLiteral("list-1")},
               {QStringLiteral("remoteTaskId"), QStringLiteral("remote-1")},
               {QStringLiteral("etag"), QStringLiteral("etag-1")}});
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.body = QByteArray("{}")});
  manager.enqueue({.body = QByteArray("{}")});
  manager.enqueue({.body = QByteArray()});
  hcb::GoogleHttpClient httpClient(nullptr, &manager);
  hcb::GoogleTaskMutationPushService service(
      coordinator, httpClient, clock, hcb::SyncBackoffPolicy{});

  const hcb::GoogleTaskMutationPushResult result = push(service);
  QCOMPARE(result.applied, 3);
  QCOMPARE(result.failed, 0);
  QCOMPARE(manager.requests().size(), 3);
  const hcb::test::CapturedNetworkRequest* createRequest = nullptr;
  const hcb::test::CapturedNetworkRequest* updateRequest = nullptr;
  const hcb::test::CapturedNetworkRequest* deleteRequest = nullptr;
  for (const hcb::test::CapturedNetworkRequest& request : manager.requests()) {
    if (request.operation == QNetworkAccessManager::PostOperation) {
      createRequest = &request;
    } else if (request.operation == QNetworkAccessManager::CustomOperation) {
      updateRequest = &request;
    } else if (request.operation == QNetworkAccessManager::DeleteOperation) {
      deleteRequest = &request;
    }
  }
  QVERIFY(createRequest != nullptr);
  QVERIFY(updateRequest != nullptr);
  QVERIFY(deleteRequest != nullptr);
  if (createRequest == nullptr || updateRequest == nullptr || deleteRequest == nullptr) {
    return;
  }
  QCOMPARE(createRequest->request.url().path(), QStringLiteral("/tasks/v1/lists/list-1/tasks"));
  const QUrlQuery createQuery(createRequest->request.url());
  QCOMPARE(createQuery.queryItemValue(QStringLiteral("parent")), QStringLiteral("parent-1"));
  QCOMPARE(createQuery.queryItemValue(QStringLiteral("previous")), QStringLiteral("previous-1"));
  const QJsonObject createBody = QJsonDocument::fromJson(createRequest->body).object();
  QCOMPARE(createBody.value(QStringLiteral("title")).toString(), QStringLiteral("Write report"));
  QCOMPARE(createBody.value(QStringLiteral("due")).toString(),
           QStringLiteral("2026-08-01T00:00:00.000Z"));
  QCOMPARE(updateRequest->request.url().path(),
           QStringLiteral("/tasks/v1/lists/list-1/tasks/remote-1"));
  QCOMPARE(updateRequest->request.rawHeader("If-Match"), QByteArray("etag-1"));
  const QJsonObject updateBody = QJsonDocument::fromJson(updateRequest->body).object();
  QCOMPARE(updateBody.value(QStringLiteral("status")).toString(), QStringLiteral("completed"));
  QVERIFY(updateBody.value(QStringLiteral("due")).isNull());
  QCOMPARE(deleteRequest->request.url().path(),
           QStringLiteral("/tasks/v1/lists/list-1/tasks/remote-1"));
  QCOMPARE(deleteRequest->request.rawHeader("If-Match"), QByteArray("etag-1"));
  QCOMPARE(find(coordinator, created.id).status, hcb::PendingMutationStatus::Applied);
  QCOMPARE(find(coordinator, updated.id).status, hcb::PendingMutationStatus::Applied);
  QCOMPARE(find(coordinator, removed.id).status, hcb::PendingMutationStatus::Applied);
}

void GoogleTaskMutationPushServiceTest::recordsPermanentAndRetriableFailures() {
  std::unique_ptr<hcb::test::TemporarySqliteDatabase> database = createDatabase();
  QVERIFY(database != nullptr);
  if (database == nullptr) {
    return;
  }
  FixedClock clock;
  hcb::OptimisticMutationCoordinator coordinator(database->databasePath(), clock);
  verifyReady(coordinator);
  const hcb::PendingMutation invalid = enqueue(
      coordinator,
      QStringLiteral("task.create"),
      {{QStringLiteral("task"), QJsonObject{{QStringLiteral("title"), QStringLiteral("x")}}}});
  const hcb::PendingMutation rateLimited = enqueue(
      coordinator,
      QStringLiteral("task.update"),
      {{QStringLiteral("taskListId"), QStringLiteral("list-1")},
       {QStringLiteral("remoteTaskId"), QStringLiteral("remote-1")},
       {QStringLiteral("task"), QJsonObject{{QStringLiteral("title"), QStringLiteral("x")}}}});
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.status = 503,
                   .body = QByteArray("{}"),
                   .error = QNetworkReply::UnknownServerError,
                   .headers = {{QByteArray("Retry-After"), QByteArray("3")}}});
  hcb::GoogleHttpClient httpClient(nullptr, &manager);
  hcb::GoogleTaskMutationPushService service(
      coordinator,
      httpClient,
      clock,
      hcb::SyncBackoffPolicy({.baseDelayMilliseconds = 1'000,
                              .maximumDelayMilliseconds = 10'000,
                              .jitterMilliseconds = 0,
                              .maximumAttempts = 6,
                              .random = [] { return 0.0; }}));

  const hcb::GoogleTaskMutationPushResult result = push(service);
  QCOMPARE(result.applied, 0);
  QCOMPARE(result.failed, 2);
  QCOMPARE(manager.requests().size(), 1);
  const hcb::PendingMutation invalidResult = find(coordinator, invalid.id);
  QCOMPARE(invalidResult.status, hcb::PendingMutationStatus::Failed);
  QCOMPARE(invalidResult.lastErrorCode, std::optional<QString>(QStringLiteral("invalid_payload")));
  QVERIFY(!invalidResult.nextRetryAt.has_value());
  const hcb::PendingMutation rateLimitedResult = find(coordinator, rateLimited.id);
  QCOMPARE(rateLimitedResult.status, hcb::PendingMutationStatus::Failed);
  QCOMPARE(rateLimitedResult.lastErrorCode, std::optional<QString>(QStringLiteral("server")));
  QCOMPARE(rateLimitedResult.nextRetryAt,
           std::optional<QString>(QStringLiteral("2025-07-25T01:46:43.123Z")));
}

QTEST_GUILESS_MAIN(GoogleTaskMutationPushServiceTest)

#include "GoogleTaskMutationPushServiceTest.moc"
