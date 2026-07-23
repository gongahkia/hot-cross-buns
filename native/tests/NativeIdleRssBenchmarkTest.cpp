#include <QtTest>

#include "core/NativeIdleRssBenchmark.h"
#include "core/NativeProcessMemory.h"

class NativeIdleRssBenchmarkTest final : public QObject {
  Q_OBJECT

private slots:
  void parsesResidentBytes();
  void rejectsInvalidResidentBytes();
  void reportsCurrentProcessResidentBytes();
};

void NativeIdleRssBenchmarkTest::parsesResidentBytes() {
  const auto bytes = hcb::NativeIdleRssBenchmark::parseResidentBytes(
      QByteArrayLiteral("ignored\nHCB_IDLE_RSS_BYTES=1048576\n"));

  QVERIFY(bytes.has_value());
  QCOMPARE(*bytes, quint64{1'048'576});
}

void NativeIdleRssBenchmarkTest::rejectsInvalidResidentBytes() {
  QVERIFY(!hcb::NativeIdleRssBenchmark::parseResidentBytes(QByteArrayLiteral("HCB_IDLE_RSS_BYTES=0"))
                .has_value());
  QVERIFY(!hcb::NativeIdleRssBenchmark::parseResidentBytes(QByteArrayLiteral("HCB_IDLE_RSS_BYTES=x"))
                .has_value());
}

void NativeIdleRssBenchmarkTest::reportsCurrentProcessResidentBytes() {
  const auto bytes = hcb::NativeProcessMemory::residentBytes();

  QVERIFY(bytes.has_value());
  QVERIFY(*bytes > 0);
}

QTEST_MAIN(NativeIdleRssBenchmarkTest)
#include "NativeIdleRssBenchmarkTest.moc"
