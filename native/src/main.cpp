#include <QGuiApplication>
#include <QQmlApplicationEngine>

#include <optional>
#include <utility>

#include "app/AppPaths.h"
#include "app/AppServices.h"

int main(int argc, char* argv[]) {
  QGuiApplication application(argc, argv);
  QCoreApplication::setOrganizationName("Hot Cross Buns");
  QCoreApplication::setOrganizationDomain("gongahkia.github.io");
  QCoreApplication::setApplicationName("Hot Cross Buns");

  std::optional<hcb::AppPaths> paths = hcb::AppPaths::discover();
  if (!paths.has_value()) {
    return 1;
  }
  const hcb::AppServices services(std::move(*paths));
  QQmlApplicationEngine engine;

  QObject::connect(
      &engine,
      &QQmlApplicationEngine::objectCreationFailed,
      &application,
      [] { QCoreApplication::exit(1); },
      Qt::QueuedConnection);
  engine.loadFromModule("HCB", "Main");

  if (engine.rootObjects().isEmpty()) {
    return 1;
  }

  Q_UNUSED(services);
  return application.exec();
}
