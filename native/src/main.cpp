#include <QGuiApplication>
#include <QQmlApplicationEngine>

#include "app/AppPaths.h"
#include "app/AppServices.h"

int main(int argc, char* argv[]) {
  QGuiApplication application(argc, argv);
  QCoreApplication::setOrganizationName("Hot Cross Buns");
  QCoreApplication::setOrganizationDomain("gongahkia.github.io");
  QCoreApplication::setApplicationName("Hot Cross Buns");

  const hcb::AppServices services(hcb::AppPaths::discover());
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
