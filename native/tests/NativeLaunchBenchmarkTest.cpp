#include <QtTest>

#include "core/NativeLaunchBenchmark.h"

#include <QJsonDocument>
#include <QJsonObject>

class NativeLaunchBenchmarkTest final : public QObject {
  Q_OBJECT

private slots:
  void summarizesSamples();
  void rejectsEmptySamples();
};

void NativeLaunchBenchmarkTest::summarizesSamples() {
  const auto result = hcb::NativeLaunchBenchmark::summarize({11, 2, 7});

  QVERIFY(result.has_value());
  QCOMPARE(result->minimumMilliseconds, 2);
  QCOMPARE(result->medianMilliseconds, 7);
  QCOMPARE(result->maximumMilliseconds, 11);
  QCOMPARE(result->samplesMilliseconds, std::vector<qint64>({2, 7, 11}));

  const QJsonObject json =
      QJsonDocument::fromJson(hcb::NativeLaunchBenchmark::toJson(*result)).object();
  QCOMPARE(json.value(QStringLiteral("schema_version")).toInt(), 1);
  QCOMPARE(json.value(QStringLiteral("iterations")).toInt(), 3);
  QCOMPARE(json.value(QStringLiteral("median_ms")).toInt(), 7);
}

void NativeLaunchBenchmarkTest::rejectsEmptySamples() {
  QVERIFY(!hcb::NativeLaunchBenchmark::summarize({}).has_value());
}

QTEST_MAIN(NativeLaunchBenchmarkTest)
#include "NativeLaunchBenchmarkTest.moc"
