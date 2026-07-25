#include <QtTest/QTest>

#include "core/TimelineModel.h"

class TimelineModelTest final : public QObject {
  Q_OBJECT

private slots:
  void laysOutDayAndWeekItemsInDisplayTimeZone();
  void buildsMoveInputInDisplayTimeZone();
  void clearsInvalidRanges();
};

void TimelineModelTest::laysOutDayAndWeekItemsInDisplayTimeZone() {
  const QTimeZone timeZone(QByteArrayLiteral("America/Los_Angeles"));
  QVERIFY(timeZone.isValid());
  hcb::TimelineModel model;
  model.setRange(QDate(2026, 8, 1),
                 2,
                 {{.id = QStringLiteral("all-day"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("All day"),
                   .startAt = QStringLiteral("2026-08-01T07:00:00.000Z"),
                   .endAt = QStringLiteral("2026-08-04T07:00:00.000Z"),
                   .allDay = true,
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")},
                  {.id = QStringLiteral("event-a"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("A"),
                   .startAt = QStringLiteral("2026-08-01T16:00:00.000Z"),
                   .endAt = QStringLiteral("2026-08-01T17:00:00.000Z"),
                   .allDay = false,
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")},
                  {.id = QStringLiteral("event-b"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("B"),
                   .startAt = QStringLiteral("2026-08-01T16:30:00.000Z"),
                   .endAt = QStringLiteral("2026-08-01T17:30:00.000Z"),
                   .allDay = false,
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")},
                  {.id = QStringLiteral("overnight"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("Overnight"),
                   .startAt = QStringLiteral("2026-08-02T06:30:00.000Z"),
                   .endAt = QStringLiteral("2026-08-02T07:30:00.000Z"),
                   .allDay = false,
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")}},
                 timeZone,
                 1);

  QCOMPARE(model.rowCount(), 5);
  QCOMPARE(model.data(model.index(0, 0), hcb::TimelineModel::IdRole).toString(),
           QStringLiteral("all-day"));
  QCOMPARE(model.data(model.index(0, 0), hcb::TimelineModel::AllDayRole).toBool(), true);
  QCOMPARE(model.data(model.index(0, 0), hcb::TimelineModel::DaySpanRole).toInt(), 2);
  QCOMPARE(model.data(model.index(0, 0), hcb::TimelineModel::EndsAfterRangeRole).toBool(), true);

  QCOMPARE(model.data(model.index(1, 0), hcb::TimelineModel::IdRole).toString(),
           QStringLiteral("event-a"));
  QCOMPARE(model.data(model.index(1, 0), hcb::TimelineModel::StartMinuteRole).toInt(), 9 * 60);
  QCOMPARE(model.data(model.index(1, 0), hcb::TimelineModel::LaneIndexRole).toInt(), 0);
  QCOMPARE(model.data(model.index(1, 0), hcb::TimelineModel::LaneCountRole).toInt(), 2);
  QCOMPARE(model.data(model.index(2, 0), hcb::TimelineModel::IdRole).toString(),
           QStringLiteral("event-b"));
  QCOMPARE(model.data(model.index(2, 0), hcb::TimelineModel::LaneIndexRole).toInt(), 1);

  QCOMPARE(model.data(model.index(3, 0), hcb::TimelineModel::IdRole).toString(),
           QStringLiteral("overnight"));
  QCOMPARE(model.data(model.index(3, 0), hcb::TimelineModel::DayIndexRole).toInt(), 0);
  QCOMPARE(model.data(model.index(3, 0), hcb::TimelineModel::DurationMinutesRole).toInt(), 30);
  QCOMPARE(model.data(model.index(4, 0), hcb::TimelineModel::DayIndexRole).toInt(), 1);
  QCOMPARE(model.data(model.index(4, 0), hcb::TimelineModel::StartMinuteRole).toInt(), 0);
  QCOMPARE(model.roleNames().value(hcb::TimelineModel::StartsBeforeRangeRole),
           QByteArrayLiteral("startsBeforeRange"));
}

void TimelineModelTest::buildsMoveInputInDisplayTimeZone() {
  const QTimeZone timeZone(QByteArrayLiteral("America/Los_Angeles"));
  QVERIFY(timeZone.isValid());
  hcb::TimelineModel model;
  model.setRange(QDate(2026, 3, 7),
                 2,
                 {{.id = QStringLiteral("event-a"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("A"),
                   .startAt = QStringLiteral("2026-03-07T18:00:00.000Z"),
                   .endAt = QStringLiteral("2026-03-07T19:00:00.000Z"),
                   .allDay = false,
                   .updatedAt = QStringLiteral("2026-03-01T00:00:00.000Z")}},
                 timeZone,
                 1);

  const QVariantMap move = model.moveInput(QStringLiteral("event-a"), 1, 3 * 60);
  QCOMPARE(move.value(QStringLiteral("id")).toString(), QStringLiteral("event-a"));
  QCOMPARE(move.value(QStringLiteral("startAt")).toString(),
           QStringLiteral("2026-03-08T10:00:00.000Z"));
  QCOMPARE(move.value(QStringLiteral("endAt")).toString(),
           QStringLiteral("2026-03-08T11:00:00.000Z"));
  QCOMPARE(move.value(QStringLiteral("allDay")).toBool(), false);
  QVERIFY(model.moveInput(QStringLiteral("event-a"), -1, 0).isEmpty());
  QVERIFY(model.moveInput(QStringLiteral("event-a"), 2, 0).isEmpty());
  QVERIFY(model.moveInput(QStringLiteral("event-a"), 0, 24 * 60).isEmpty());
  QVERIFY(model.moveInput(QStringLiteral("missing"), 0, 0).isEmpty());
}

void TimelineModelTest::clearsInvalidRanges() {
  hcb::TimelineModel model;
  model.setRange(QDate(2026, 8, 1), 8, {}, QTimeZone::utc(), 1);
  QCOMPARE(model.rowCount(), 0);
  QVERIFY(!model.data(model.index(0, 0), Qt::DisplayRole).isValid());
}

QTEST_GUILESS_MAIN(TimelineModelTest)

#include "TimelineModelTest.moc"
