#include <QtTest/QTest>

#include "core/Clock.h"
#include "core/GoogleCalendarEventMutationPushService.h"
#include "core/GoogleHttpClient.h"
#include "core/OptimisticMutationCoordinator.h"
#include "core/SyncBackoffPolicy.h"
#include "support/MockNetworkAccessManager.h"
#include "support/TemporarySqliteDatabase.h"

#include <QCoreApplication>
#include <QEventLoop>
#include <QJsonDocument>
#include <QJsonObject>

#include <chrono>
#include <future>
#include <memory>
#include <optional>
#include <thread>
#include <utility>
#include <variant>

using namespace std::chrono_literals;

class GoogleCalendarEventMutationPushServiceTest final : public QObject {
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
    qFatal("event mutation push request timed out");
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
      coordinator.enqueue({.resource = hcb::PendingMutationResource::Event,
                           .resourceId = QStringLiteral("event-local"),
                           .operation = std::move(operation),
                           .payload = std::move(payload)});
  const hcb::PendingMutationResult result = awaitResult(future);
  if (!std::holds_alternative<hcb::PendingMutation>(result)) {
    qFatal("event mutation enqueue failed");
  }
  return std::get<hcb::PendingMutation>(result);
}

[[nodiscard]] hcb::PendingMutation find(hcb::OptimisticMutationCoordinator& coordinator,
                                        const QString& mutationId) {
  std::future<hcb::PendingMutationLookupResult> future = coordinator.find(mutationId);
  const hcb::PendingMutationLookupResult result = awaitResult(future);
  if (!std::holds_alternative<std::optional<hcb::PendingMutation>>(result) ||
      !std::get<std::optional<hcb::PendingMutation>>(result).has_value()) {
    qFatal("event mutation was not found");
  }
  return *std::get<std::optional<hcb::PendingMutation>>(result);
}

[[nodiscard]] hcb::GoogleCalendarEventMutationPushResult
push(hcb::GoogleCalendarEventMutationPushService& service) {
  std::future<hcb::GoogleCalendarEventMutationPushResultOrError> future =
      service.pushDue(QStringLiteral("access-token"));
  const hcb::GoogleCalendarEventMutationPushResultOrError result = awaitResult(future);
  if (!std::holds_alternative<hcb::GoogleCalendarEventMutationPushResult>(result)) {
    qFatal("event mutation push failed");
  }
  return std::get<hcb::GoogleCalendarEventMutationPushResult>(result);
}

} // namespace

void GoogleCalendarEventMutationPushServiceTest::pushesCreateUpdateAndDeleteMutations() {
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
      QStringLiteral("event.create"),
      {{QStringLiteral("calendarId"), QStringLiteral("calendar-1")},
       {QStringLiteral("event"),
        QJsonObject{
            {QStringLiteral("summary"), QStringLiteral(" Planning/Q3 ")},
            {QStringLiteral("description"), QStringLiteral("draft")},
            {QStringLiteral("location"), QStringLiteral("HQ")},
            {QStringLiteral("start"),
             QJsonObject{{QStringLiteral("dateTime"), QStringLiteral("2026-08-01T09:00:00")},
                         {QStringLiteral("timeZone"), QStringLiteral("Asia/Singapore")}}},
            {QStringLiteral("end"),
             QJsonObject{{QStringLiteral("dateTime"), QStringLiteral("2026-08-01T10:00:00")},
                         {QStringLiteral("timeZone"), QStringLiteral("Asia/Singapore")}}}}}});
  const hcb::PendingMutation updated =
      enqueue(coordinator,
              QStringLiteral("event.update"),
              {{QStringLiteral("calendarId"), QStringLiteral("calendar-1")},
               {QStringLiteral("remoteEventId"), QStringLiteral("remote-1")},
               {QStringLiteral("etag"), QStringLiteral("etag-1")},
               {QStringLiteral("event"),
                QJsonObject{{QStringLiteral("description"), QJsonValue::Null},
                            {QStringLiteral("location"), QStringLiteral("Remote")}}}});
  const hcb::PendingMutation removed =
      enqueue(coordinator,
              QStringLiteral("event.delete"),
              {{QStringLiteral("calendarId"), QStringLiteral("calendar-1")},
               {QStringLiteral("remoteEventId"), QStringLiteral("remote-1")},
               {QStringLiteral("etag"), QStringLiteral("etag-1")}});
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.body = QByteArray("{}")});
  manager.enqueue({.body = QByteArray("{}")});
  manager.enqueue({.body = QByteArray()});
  hcb::GoogleHttpClient httpClient(nullptr, &manager);
  hcb::GoogleCalendarEventMutationPushService service(
      coordinator, httpClient, clock, hcb::SyncBackoffPolicy{});

  const hcb::GoogleCalendarEventMutationPushResult result = push(service);
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
  QCOMPARE(createRequest->request.url().path(),
           QStringLiteral("/calendar/v3/calendars/calendar-1/events"));
  const QJsonObject createBody = QJsonDocument::fromJson(createRequest->body).object();
  QCOMPARE(createBody.value(QStringLiteral("summary")).toString(), QStringLiteral("Planning/Q3"));
  QCOMPARE(createBody.value(QStringLiteral("start"))
               .toObject()
               .value(QStringLiteral("dateTime"))
               .toString(),
           QStringLiteral("2026-08-01T01:00:00.000Z"));
  QCOMPARE(updateRequest->request.url().path(),
           QStringLiteral("/calendar/v3/calendars/calendar-1/events/remote-1"));
  QCOMPARE(updateRequest->request.rawHeader("If-Match"), QByteArray("etag-1"));
  const QJsonObject updateBody = QJsonDocument::fromJson(updateRequest->body).object();
  QVERIFY(updateBody.value(QStringLiteral("description")).isNull());
  QCOMPARE(updateBody.value(QStringLiteral("location")).toString(), QStringLiteral("Remote"));
  QCOMPARE(deleteRequest->request.url().path(),
           QStringLiteral("/calendar/v3/calendars/calendar-1/events/remote-1"));
  QCOMPARE(deleteRequest->request.rawHeader("If-Match"), QByteArray("etag-1"));
  QCOMPARE(find(coordinator, created.id).status, hcb::PendingMutationStatus::Applied);
  QCOMPARE(find(coordinator, updated.id).status, hcb::PendingMutationStatus::Applied);
  QCOMPARE(find(coordinator, removed.id).status, hcb::PendingMutationStatus::Applied);
}

void GoogleCalendarEventMutationPushServiceTest::recordsPermanentAndRetriableFailures() {
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
      QStringLiteral("event.create"),
      {{QStringLiteral("event"), QJsonObject{{QStringLiteral("summary"), QStringLiteral("x")}}}});
  const hcb::PendingMutation unavailable = enqueue(
      coordinator,
      QStringLiteral("event.update"),
      {{QStringLiteral("calendarId"), QStringLiteral("calendar-1")},
       {QStringLiteral("remoteEventId"), QStringLiteral("remote-1")},
       {QStringLiteral("event"), QJsonObject{{QStringLiteral("summary"), QStringLiteral("x")}}}});
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.status = 503,
                   .body = QByteArray("{}"),
                   .error = QNetworkReply::UnknownServerError,
                   .headers = {{QByteArray("Retry-After"), QByteArray("3")}}});
  hcb::GoogleHttpClient httpClient(nullptr, &manager);
  hcb::GoogleCalendarEventMutationPushService service(
      coordinator,
      httpClient,
      clock,
      hcb::SyncBackoffPolicy({.baseDelayMilliseconds = 1'000,
                              .maximumDelayMilliseconds = 10'000,
                              .jitterMilliseconds = 0,
                              .maximumAttempts = 6,
                              .random = [] { return 0.0; }}));

  const hcb::GoogleCalendarEventMutationPushResult result = push(service);
  QCOMPARE(result.applied, 0);
  QCOMPARE(result.failed, 2);
  QCOMPARE(manager.requests().size(), 1);
  const hcb::PendingMutation invalidResult = find(coordinator, invalid.id);
  QCOMPARE(invalidResult.status, hcb::PendingMutationStatus::Failed);
  QCOMPARE(invalidResult.lastErrorCode, std::optional<QString>(QStringLiteral("invalid_payload")));
  QVERIFY(!invalidResult.nextRetryAt.has_value());
  const hcb::PendingMutation unavailableResult = find(coordinator, unavailable.id);
  QCOMPARE(unavailableResult.status, hcb::PendingMutationStatus::Failed);
  QCOMPARE(unavailableResult.lastErrorCode, std::optional<QString>(QStringLiteral("server")));
  QCOMPARE(unavailableResult.nextRetryAt,
           std::optional<QString>(QStringLiteral("2025-07-25T01:46:43.123Z")));
}

QTEST_GUILESS_MAIN(GoogleCalendarEventMutationPushServiceTest)

#include "GoogleCalendarEventMutationPushServiceTest.moc"
