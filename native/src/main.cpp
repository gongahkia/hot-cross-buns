#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QTimer>
#include <QVariant>

#include <optional>
#include <utility>

#include "app/AppPaths.h"
#include "app/AppServices.h"
#include "core/Clock.h"
#include "core/SettingsRegistry.h"
#include "core/StartupTimingTracker.h"
#include "core/StructuredLogger.h"
#include "core/UiTransitionTimingTracker.h"

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
  hcb::UiTransitionTimingTracker transitionTimings(clock, logger);
  QQmlApplicationEngine engine;
  engine.setInitialProperties(
      {{QStringLiteral("transitionTimings"), QVariant::fromValue(&transitionTimings)}});

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

  if (qEnvironmentVariable("HCB_BENCHMARK_EXIT_AFTER_LOAD") == QStringLiteral("1")) {
    startupTimings.mark(u"benchmark.exit.scheduled");
    QTimer::singleShot(0, &application, &QCoreApplication::quit);
  }

  Q_UNUSED(services);
  return application.exec();
}
