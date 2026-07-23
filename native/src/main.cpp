#include <QGuiApplication>
#include <QQmlApplicationEngine>

#include <optional>
#include <utility>

#include "app/AppPaths.h"
#include "app/AppServices.h"
#include "core/Clock.h"
#include "core/SettingsRegistry.h"
#include "core/StartupTimingTracker.h"
#include "core/StructuredLogger.h"

int main(int argc, char* argv[]) {
  hcb::SystemClock clock;
  hcb::StructuredLogger logger(clock);
  hcb::StartupTimingTracker startupTimings(clock, logger);
  QGuiApplication application(argc, argv);
  QCoreApplication::setOrganizationName("Hot Cross Buns");
  QCoreApplication::setOrganizationDomain("gongahkia.github.io");
  QCoreApplication::setApplicationName("Hot Cross Buns");
  startupTimings.mark(u"application.initialized");

  std::optional<hcb::AppPaths> paths = hcb::AppPaths::discover();
  if (!paths.has_value()) {
    startupTimings.mark(u"paths.unavailable");
    return 1;
  }
  startupTimings.mark(u"paths.discovered");
  hcb::SettingsRegistry settings;
  const hcb::AppServices services(std::move(*paths), clock, settings);
  startupTimings.mark(u"core.services.initialized");
  QQmlApplicationEngine engine;

  QObject::connect(
      &engine,
      &QQmlApplicationEngine::objectCreationFailed,
      &application,
      [] { QCoreApplication::exit(1); },
      Qt::QueuedConnection);
  engine.loadFromModule("HCB", "Main");

  if (engine.rootObjects().isEmpty()) {
    startupTimings.mark(u"qml.load.failed");
    return 1;
  }
  startupTimings.mark(u"qml.loaded");

  Q_UNUSED(services);
  return application.exec();
}
