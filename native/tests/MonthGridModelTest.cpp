#include <QtTest/QTest>

#include "core/MonthGridModel.h"

class MonthGridModelTest final : public QObject {
  Q_OBJECT

private slots:
  void buildsSundayFirstGridAndAssignsEndExclusiveEventSpans();
  void clearsForInvalidMonthOrTimeZone();
};

void MonthGridModelTest::buildsSundayFirstGridAndAssignsEndExclusiveEventSpans() {
  hcb::MonthGridModel model;
  model.setMonth(QDate(2026, 8, 1),
                 {{.id = QStringLiteral("multi"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("Multi day"),
                   .startAt = QStringLiteral("2026-08-30T00:00:00.000Z"),
                   .endAt = QStringLiteral("2026-09-02T00:00:00.000Z"),
                   .allDay = true,
                   .colorId = QStringLiteral("7"),
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")},
                  {.id = QStringLiteral("overnight"),
                   .calendarId = QStringLiteral("calendar-a"),
                   .status = QStringLiteral("confirmed"),
                   .title = QStringLiteral("Overnight"),
                   .startAt = QStringLiteral("2026-08-31T23:00:00.000Z"),
                   .endAt = QStringLiteral("2026-09-01T00:00:00.000Z"),
                   .allDay = false,
                   .updatedAt = QStringLiteral("2026-07-25T00:00:00.000Z")}},
                 QTimeZone::utc());

  QCOMPARE(model.rowCount(), 6);
  QCOMPARE(model.columnCount(), 7);
  const QModelIndex first = model.index(0, 0);
  QCOMPARE(model.data(first, hcb::MonthGridModel::DateRole).toString(),
           QStringLiteral("2026-07-26"));
  QCOMPARE(model.data(first, hcb::MonthGridModel::OutsideMonthRole).toBool(), true);

  const QModelIndex august31 = model.index(5, 1);
  QCOMPARE(model.data(august31, hcb::MonthGridModel::DateRole).toString(),
           QStringLiteral("2026-08-31"));
  QCOMPARE(model.data(august31, hcb::MonthGridModel::EventCountRole).toInt(), 2);
  const QVariantList august31Events =
      model.data(august31, hcb::MonthGridModel::EventsRole).toList();
  QCOMPARE(august31Events.size(), 2);
  QCOMPARE(august31Events.at(0).toMap().value(QStringLiteral("id")).toString(),
           QStringLiteral("multi"));
  QCOMPARE(august31Events.at(1).toMap().value(QStringLiteral("id")).toString(),
           QStringLiteral("overnight"));

  const QModelIndex september1 = model.index(5, 2);
  QCOMPARE(model.data(september1, hcb::MonthGridModel::OutsideMonthRole).toBool(), true);
  QCOMPARE(model.data(september1, hcb::MonthGridModel::EventCountRole).toInt(), 1);
  QCOMPARE(model.data(september1, hcb::MonthGridModel::EventsRole)
               .toList()
               .at(0)
               .toMap()
               .value(QStringLiteral("id"))
               .toString(),
           QStringLiteral("multi"));
  QCOMPARE(model.roleNames().value(hcb::MonthGridModel::OutsideMonthRole),
           QByteArrayLiteral("outsideMonth"));
}

void MonthGridModelTest::clearsForInvalidMonthOrTimeZone() {
  hcb::MonthGridModel model;
  model.setMonth(QDate(), {}, QTimeZone::utc());
  QCOMPARE(model.rowCount(), 0);
  QCOMPARE(model.columnCount(), 7);
  QVERIFY(!model.data(model.index(0, 0), Qt::DisplayRole).isValid());

  model.setMonth(QDate(2026, 8, 1), {}, QTimeZone());
  QCOMPARE(model.rowCount(), 0);
}

QTEST_GUILESS_MAIN(MonthGridModelTest)

#include "MonthGridModelTest.moc"
