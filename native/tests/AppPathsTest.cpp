#include <QtTest>

#include "app/AppPaths.h"

class AppPathsTest final : public QObject {
  Q_OBJECT

private slots:
  void discoversStableApplicationDirectories();
};

void AppPathsTest::discoversStableApplicationDirectories() {
  const std::optional<hcb::AppPaths> discoveredPaths = hcb::AppPaths::discover();
  QVERIFY(discoveredPaths.has_value());
  if (!discoveredPaths.has_value()) {
    return;
  }
  const hcb::AppPaths& paths = *discoveredPaths;

  QVERIFY(!paths.dataDirectory().nativePath().isEmpty());
  QVERIFY(!paths.cacheDirectory().nativePath().isEmpty());
}

QTEST_MAIN(AppPathsTest)
#include "AppPathsTest.moc"
