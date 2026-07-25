#include <QtTest/QTest>

#include "core/SearchResultsModel.h"

class SearchResultsModelTest final : public QObject {
  Q_OBJECT

private slots:
  void exposesRankedSearchResultRolesAndResets();
  void rejectsInvalidIndexes();
};

void SearchResultsModelTest::exposesRankedSearchResultRolesAndResets() {
  hcb::SearchResultsModel model;
  model.setResults({{.resource = hcb::LocalSearchResource::Event,
                     .id = QStringLiteral("event-a"),
                     .title = QStringLiteral("Release review"),
                     .detail = QStringLiteral("Calendar event"),
                     .score = 96}});

  QCOMPARE(model.rowCount(), 1);
  const QModelIndex index = model.index(0, 0);
  QCOMPARE(model.data(index, Qt::DisplayRole).toString(), QStringLiteral("Release review"));
  QCOMPARE(model.data(index, hcb::SearchResultsModel::IdRole).toString(),
           QStringLiteral("event-a"));
  QCOMPARE(model.data(index, hcb::SearchResultsModel::ResourceRole).toString(),
           QStringLiteral("event"));
  QCOMPARE(model.data(index, hcb::SearchResultsModel::DetailRole).toString(),
           QStringLiteral("Calendar event"));
  QCOMPARE(model.data(index, hcb::SearchResultsModel::ScoreRole).toInt(), 96);
  QCOMPARE(model.roleNames().value(hcb::SearchResultsModel::ResourceRole),
           QByteArrayLiteral("resource"));

  model.setResults({});
  QCOMPARE(model.rowCount(), 0);
}

void SearchResultsModelTest::rejectsInvalidIndexes() {
  hcb::SearchResultsModel model;
  QVERIFY(!model.data(QModelIndex(), Qt::DisplayRole).isValid());
  QVERIFY(!model.data(model.index(0, 0), Qt::DisplayRole).isValid());
  QCOMPARE(model.rowCount(model.index(0, 0)), 0);
}

QTEST_GUILESS_MAIN(SearchResultsModelTest)

#include "SearchResultsModelTest.moc"
