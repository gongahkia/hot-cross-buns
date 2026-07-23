#include <QtTest>

#include "app/ApplicationLifecycle.h"

class ApplicationLifecycleTest final : public QObject {
  Q_OBJECT

private slots:
  void startsAndStopsInOrder();
  void supportsStopDuringStartup();
  void recoversFromFailureThroughShutdown();
  void preservesStoppingStateWhenFailureArrivesLate();
  void rejectsInvalidTransitions();
};

void ApplicationLifecycleTest::startsAndStopsInOrder() {
  hcb::ApplicationLifecycle lifecycle;

  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Starting);
  QVERIFY(lifecycle.markReady());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Ready);
  QVERIFY(lifecycle.requestStop());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopping);
  QVERIFY(lifecycle.markStopped());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopped);
}

void ApplicationLifecycleTest::supportsStopDuringStartup() {
  hcb::ApplicationLifecycle lifecycle;

  QVERIFY(lifecycle.requestStop());
  QVERIFY(lifecycle.markStopped());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopped);
}

void ApplicationLifecycleTest::recoversFromFailureThroughShutdown() {
  hcb::ApplicationLifecycle lifecycle;

  QVERIFY(lifecycle.fail());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Failed);
  QVERIFY(lifecycle.requestStop());
  QVERIFY(lifecycle.markStopped());
}

void ApplicationLifecycleTest::preservesStoppingStateWhenFailureArrivesLate() {
  hcb::ApplicationLifecycle lifecycle;

  QVERIFY(lifecycle.markReady());
  QVERIFY(lifecycle.requestStop());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopping);
  QVERIFY(!lifecycle.fail());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopping);
  QVERIFY(lifecycle.markStopped());
  QCOMPARE(lifecycle.state(), hcb::ApplicationState::Stopped);
}

void ApplicationLifecycleTest::rejectsInvalidTransitions() {
  hcb::ApplicationLifecycle lifecycle;

  QVERIFY(!lifecycle.markStopped());
  QVERIFY(lifecycle.markReady());
  QVERIFY(!lifecycle.markReady());
  QVERIFY(lifecycle.requestStop());
  QVERIFY(!lifecycle.requestStop());
  QVERIFY(lifecycle.markStopped());
  QVERIFY(!lifecycle.fail());
}

QTEST_MAIN(ApplicationLifecycleTest)
#include "ApplicationLifecycleTest.moc"
