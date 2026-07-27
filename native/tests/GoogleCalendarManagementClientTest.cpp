#include <QtTest/QTest>

#include "core/GoogleCalendarManagementClient.h"
#include "core/GoogleHttpClient.h"
#include "support/MockNetworkAccessManager.h"

#include <QJsonDocument>
#include <QJsonObject>

#include <chrono>
#include <future>
#include <variant>

class GoogleCalendarManagementClientTest final : public QObject {
  Q_OBJECT

private slots:
  void createsCalendar();
  void subscribesCalendar();
  void rejectsInvalidInputBeforeNetwork();
};

void GoogleCalendarManagementClientTest::createsCalendar() {
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.body = QByteArray("{\"id\":\"calendar-created\"}")});
  hcb::GoogleHttpClient http(nullptr, &manager);
  hcb::GoogleCalendarManagementClient client(http);

  std::future<hcb::GoogleCalendarManagementResultOrError> future = client.create(
      {.title = QStringLiteral("Team"),
       .description = QStringLiteral("Planning"),
       .timeZone = QStringLiteral("Asia/Singapore")},
      QStringLiteral("access-token"));
  QTRY_VERIFY_WITH_TIMEOUT(
      future.wait_for(std::chrono::milliseconds::zero()) == std::future_status::ready, 1'000);
  const hcb::GoogleCalendarManagementResultOrError result = future.get();
  QVERIFY(std::holds_alternative<hcb::GoogleCalendarManagementResult>(result));
  QCOMPARE(std::get<hcb::GoogleCalendarManagementResult>(result).calendarId,
           QStringLiteral("calendar-created"));
  QCOMPARE(manager.requests().size(), 1);
  const hcb::test::CapturedNetworkRequest& request = manager.requests().constFirst();
  QCOMPARE(request.operation, QNetworkAccessManager::PostOperation);
  QCOMPARE(request.request.url().path(), QStringLiteral("/calendar/v3/calendars"));
  QCOMPARE(request.request.rawHeader("Authorization"), QByteArray("Bearer access-token"));
  const QJsonObject body = QJsonDocument::fromJson(request.body).object();
  QCOMPARE(body.value(QStringLiteral("summary")).toString(), QStringLiteral("Team"));
  QCOMPARE(body.value(QStringLiteral("description")).toString(), QStringLiteral("Planning"));
  QCOMPARE(body.value(QStringLiteral("timeZone")).toString(), QStringLiteral("Asia/Singapore"));
}

void GoogleCalendarManagementClientTest::subscribesCalendar() {
  hcb::test::MockNetworkAccessManager manager;
  manager.enqueue({.body = QByteArray("{\"id\":\"calendar-shared\"}")});
  hcb::GoogleHttpClient http(nullptr, &manager);
  hcb::GoogleCalendarManagementClient client(http);

  std::future<hcb::GoogleCalendarManagementResultOrError> future = client.subscribe(
      {.calendarId = QStringLiteral("calendar-shared"), .selected = false, .hidden = true,
       .colorId = QStringLiteral("4")},
      QStringLiteral("access-token"));
  QTRY_VERIFY_WITH_TIMEOUT(
      future.wait_for(std::chrono::milliseconds::zero()) == std::future_status::ready, 1'000);
  const hcb::GoogleCalendarManagementResultOrError result = future.get();
  QVERIFY(std::holds_alternative<hcb::GoogleCalendarManagementResult>(result));
  QCOMPARE(manager.requests().size(), 1);
  const hcb::test::CapturedNetworkRequest& request = manager.requests().constFirst();
  QCOMPARE(request.request.url().path(), QStringLiteral("/calendar/v3/users/me/calendarList"));
  const QJsonObject body = QJsonDocument::fromJson(request.body).object();
  QCOMPARE(body.value(QStringLiteral("id")).toString(), QStringLiteral("calendar-shared"));
  QVERIFY(!body.value(QStringLiteral("selected")).toBool());
  QVERIFY(body.value(QStringLiteral("hidden")).toBool());
  QCOMPARE(body.value(QStringLiteral("colorId")).toString(), QStringLiteral("4"));
}

void GoogleCalendarManagementClientTest::rejectsInvalidInputBeforeNetwork() {
  hcb::test::MockNetworkAccessManager manager;
  hcb::GoogleHttpClient http(nullptr, &manager);
  hcb::GoogleCalendarManagementClient client(http);

  std::future<hcb::GoogleCalendarManagementResultOrError> future =
      client.create({.title = QStringLiteral(" ")}, QStringLiteral("access-token"));
  const hcb::GoogleCalendarManagementResultOrError result = future.get();
  QVERIFY(std::holds_alternative<hcb::GoogleApiError>(result));
  QCOMPARE(std::get<hcb::GoogleApiError>(result).kind(), hcb::GoogleApiErrorKind::InvalidPayload);
  QCOMPARE(manager.requests().size(), 0);
}

QTEST_GUILESS_MAIN(GoogleCalendarManagementClientTest)

#include "GoogleCalendarManagementClientTest.moc"
