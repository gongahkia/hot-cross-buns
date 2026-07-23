#include <QGuiApplication>
#include <QElapsedTimer>
#include <QQuickItem>
#include <QQmlApplicationEngine>
#include <QTextStream>
#include <QTimer>
#include <QVariant>

#include <exception>
#include <memory>
#include <optional>
#include <utility>

#include "app/AppPaths.h"
#include "app/AppServices.h"
#include "core/Clock.h"
#include "core/CommandRegistryModel.h"
#include "core/NativeProcessMemory.h"
#include "core/SettingsRegistry.h"
#include "core/StartupTimingTracker.h"
#include "core/StructuredLogger.h"
#include "core/UiTransitionTimingTracker.h"

namespace {

constexpr int kMaximumBenchmarkIdleRssDurationMilliseconds = 60'000;
constexpr int kCommandPaletteBenchmarkTimeoutMilliseconds = 5'000;

void scheduleCommandPaletteBenchmark(QGuiApplication& application, QObject* rootObject) {
  QTimer::singleShot(0, &application, [&application, rootObject] {
    auto timer = std::make_shared<QElapsedTimer>();
    timer->start();
    if (!QMetaObject::invokeMethod(rootObject, "openCommandPalette")) {
      QCoreApplication::exit(3);
      return;
    }

    auto* pollTimer = new QTimer(&application);
    pollTimer->setInterval(1);
    QObject::connect(pollTimer, &QTimer::timeout, &application, [rootObject, timer, pollTimer] {
      const auto* query = rootObject->findChild<QQuickItem*>("commandPaletteQuery");
      if (query != nullptr && query->hasActiveFocus()) {
        QTextStream(stdout) << "HCB_COMMAND_PALETTE_OPEN_MS=" << timer->elapsed() << Qt::endl;
        pollTimer->stop();
        pollTimer->deleteLater();
        QCoreApplication::quit();
        return;
      }
      if (timer->elapsed() >= kCommandPaletteBenchmarkTimeoutMilliseconds) {
        pollTimer->stop();
        pollTimer->deleteLater();
        QCoreApplication::exit(3);
        return;
      }
    });
    pollTimer->start();
  });
}

} // namespace

int runApplication(int argc, char* argv[]) {
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
  hcb::CommandRegistryModel navigationCommands;
  hcb::UiTransitionTimingTracker transitionTimings(clock, logger);
  QQmlApplicationEngine engine;
  engine.setInitialProperties(
      {{QStringLiteral("navigationCommands"), QVariant::fromValue(&navigationCommands)},
       {QStringLiteral("transitionTimings"), QVariant::fromValue(&transitionTimings)}});

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

  const bool benchmarkCommandPalette =
      qEnvironmentVariable("HCB_BENCHMARK_COMMAND_PALETTE_AFTER_LOAD") == QStringLiteral("1");
  bool idleRssDurationValid = false;
  const int idleRssDuration =
      qEnvironmentVariable("HCB_BENCHMARK_IDLE_RSS_AFTER_MS").toInt(&idleRssDurationValid);
  if (idleRssDurationValid && idleRssDuration > 0 &&
      idleRssDuration <= kMaximumBenchmarkIdleRssDurationMilliseconds) {
    startupTimings.mark(u"benchmark.idle_rss.scheduled");
    QTimer::singleShot(idleRssDuration, &application, [] {
      const auto residentBytes = hcb::NativeProcessMemory::residentBytes();
      if (residentBytes.has_value()) {
        QTextStream(stdout) << "HCB_IDLE_RSS_BYTES=" << *residentBytes << Qt::endl;
        QCoreApplication::quit();
        return;
      }
      QCoreApplication::exit(2);
    });
  } else if (benchmarkCommandPalette) {
    startupTimings.mark(u"benchmark.command_palette.scheduled");
    scheduleCommandPaletteBenchmark(application, engine.rootObjects().constFirst());
  } else if (qEnvironmentVariable("HCB_BENCHMARK_EXIT_AFTER_LOAD") == QStringLiteral("1")) {
    startupTimings.mark(u"benchmark.exit.scheduled");
    QTimer::singleShot(0, &application, &QCoreApplication::quit);
  }

  Q_UNUSED(services);
  return application.exec();
}

int main(int argc, char* argv[]) {
  try {
    return runApplication(argc, argv);
  } catch (const std::exception& exception) {
    QTextStream(stderr) << "Fatal native startup exception: " << exception.what() << Qt::endl;
  } catch (...) {
    QTextStream(stderr) << "Fatal native startup exception" << Qt::endl;
  }
  return 1;
}
