#include <QtTest>

#include <QDir>

#include "app/AppPaths.h"

class AppPathsTest final : public QObject {
  Q_OBJECT

private slots:
  void discoversStableApplicationDirectories();
};

void AppPathsTest::discoversStableApplicationDirectories() {
  const hcb::AppPaths paths = hcb::AppPaths::discover();

  QVERIFY(!paths.dataDirectory().isEmpty());
  QVERIFY(!paths.cacheDirectory().isEmpty());
  QVERIFY(QDir::isAbsolutePath(paths.dataDirectory()));
  QVERIFY(QDir::isAbsolutePath(paths.cacheDirectory()));
}

QTEST_MAIN(AppPathsTest)
#include "AppPathsTest.moc"
