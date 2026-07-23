set(HCB_NATIVE_SOURCES
  src/app/ApplicationLifecycle.h
  src/app/AppPaths.cpp
  src/app/AppPaths.h
  src/app/AppServices.cpp
  src/app/AppServices.h
  src/core/AppError.h
  src/core/Cancellation.h
  src/core/Clock.h
  src/core/CommandRegistryModel.cpp
  src/core/CommandRegistryModel.h
  src/core/DiagnosticsJsonExporter.cpp
  src/core/DiagnosticsJsonExporter.h
  src/core/DiagnosticsSnapshot.cpp
  src/core/DiagnosticsSnapshot.h
  src/core/FilePath.h
  src/core/FeatureCapabilityRegistry.h
  src/core/GoogleApiError.cpp
  src/core/GoogleApiError.h
  src/core/NativeProcessMemory.cpp
  src/core/NativeProcessMemory.h
  src/core/NativeCapabilityReport.cpp
  src/core/NativeCapabilityReport.h
  src/core/PkceAuthorization.cpp
  src/core/PkceAuthorization.h
  src/core/SettingsRegistry.h
  src/core/SecretRedactor.cpp
  src/core/SecretRedactor.h
  src/core/StructuredLogger.cpp
  src/core/StructuredLogger.h
  src/core/SyncBackoffPolicy.cpp
  src/core/SyncBackoffPolicy.h
  src/core/StartupTimingTracker.cpp
  src/core/StartupTimingTracker.h
  src/core/UiTransitionTimingTracker.cpp
  src/core/UiTransitionTimingTracker.h
)

qt_add_executable(hcb_native
  MACOSX_BUNDLE
  WIN32
  src/main.cpp
  ${HCB_NATIVE_SOURCES}
)

set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(hcb_native
  URI HCB
  VERSION 1.0
  QML_FILES
    qml/AccessibleButton.qml
    qml/AccessibleNavigationButton.qml
    qml/Main.qml
    qml/NavigationSidebar.qml
    qml/Theme.qml
)

target_link_libraries(hcb_native PRIVATE
  Qt6::Core
  Qt6::Gui
  Qt6::Qml
  Qt6::Quick
  Qt6::QuickControls2
)

target_include_directories(hcb_native PRIVATE src)
hcb_enable_warnings(hcb_native)
hcb_enable_sanitizers(hcb_native)
if(WIN32)
  target_link_libraries(hcb_native PRIVATE Psapi)
endif()

qt_add_executable(hcb_launch_benchmark
  benchmarks/NativeLaunchBenchmarkMain.cpp
  src/core/NativeLaunchBenchmark.cpp
  src/core/NativeLaunchBenchmark.h
)
target_link_libraries(hcb_launch_benchmark PRIVATE Qt6::Core)
target_include_directories(hcb_launch_benchmark PRIVATE src)
hcb_enable_warnings(hcb_launch_benchmark)
hcb_enable_sanitizers(hcb_launch_benchmark)

qt_add_executable(hcb_idle_rss_benchmark
  benchmarks/NativeIdleRssBenchmarkMain.cpp
  src/core/NativeIdleRssBenchmark.cpp
  src/core/NativeIdleRssBenchmark.h
)
target_link_libraries(hcb_idle_rss_benchmark PRIVATE Qt6::Core)
target_include_directories(hcb_idle_rss_benchmark PRIVATE src)
hcb_enable_warnings(hcb_idle_rss_benchmark)
hcb_enable_sanitizers(hcb_idle_rss_benchmark)

qt_add_executable(hcb_command_palette_benchmark
  benchmarks/NativeCommandPaletteBenchmarkMain.cpp
  src/core/NativeCommandPaletteBenchmark.cpp
  src/core/NativeCommandPaletteBenchmark.h
)
target_link_libraries(hcb_command_palette_benchmark PRIVATE Qt6::Core)
target_include_directories(hcb_command_palette_benchmark PRIVATE src)
hcb_enable_warnings(hcb_command_palette_benchmark)
hcb_enable_sanitizers(hcb_command_palette_benchmark)

qt_add_executable(hcb_small_performance_fixture
  benchmarks/NativeSmallPerformanceFixtureMain.cpp
  src/core/NativePerformanceFixture.cpp
  src/core/NativePerformanceFixture.h
)
target_link_libraries(hcb_small_performance_fixture PRIVATE Qt6::Core)
target_include_directories(hcb_small_performance_fixture PRIVATE src)
hcb_enable_warnings(hcb_small_performance_fixture)
hcb_enable_sanitizers(hcb_small_performance_fixture)

qt_add_executable(hcb_medium_performance_fixture
  benchmarks/NativeMediumPerformanceFixtureMain.cpp
  src/core/NativePerformanceFixture.cpp
  src/core/NativePerformanceFixture.h
)
target_link_libraries(hcb_medium_performance_fixture PRIVATE Qt6::Core)
target_include_directories(hcb_medium_performance_fixture PRIVATE src)
hcb_enable_warnings(hcb_medium_performance_fixture)
hcb_enable_sanitizers(hcb_medium_performance_fixture)

qt_add_executable(hcb_event15k_performance_fixture
  benchmarks/Native15kEventPerformanceFixtureMain.cpp
  src/core/NativePerformanceFixture.cpp
  src/core/NativePerformanceFixture.h
)
target_link_libraries(hcb_event15k_performance_fixture PRIVATE Qt6::Core)
target_include_directories(hcb_event15k_performance_fixture PRIVATE src)
hcb_enable_warnings(hcb_event15k_performance_fixture)
hcb_enable_sanitizers(hcb_event15k_performance_fixture)

qt_add_executable(hcb_performance_report
  benchmarks/NativePerformanceReportMain.cpp
  src/core/NativeIdleRssBenchmark.cpp
  src/core/NativeIdleRssBenchmark.h
  src/core/NativeLaunchBenchmark.cpp
  src/core/NativeLaunchBenchmark.h
  src/core/NativePerformanceReport.cpp
  src/core/NativePerformanceReport.h
)
target_link_libraries(hcb_performance_report PRIVATE Qt6::Core)
target_include_directories(hcb_performance_report PRIVATE src)
hcb_enable_warnings(hcb_performance_report)
hcb_enable_sanitizers(hcb_performance_report)

set_target_properties(hcb_native PROPERTIES
  OUTPUT_NAME "Hot Cross Buns"
  WIN32_EXECUTABLE TRUE
  MACOSX_BUNDLE TRUE
)

if(BUILD_TESTING)
  qt_add_executable(hcb_core_tests
    tests/AppPathsTest.cpp
    src/app/AppPaths.cpp
    src/app/AppPaths.h
    src/core/AppError.h
    src/core/FilePath.h
  )
  target_link_libraries(hcb_core_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_core_tests PRIVATE src)
  hcb_enable_warnings(hcb_core_tests)
  hcb_enable_sanitizers(hcb_core_tests)
  add_test(NAME hcb_core_tests COMMAND hcb_core_tests)

  qt_add_executable(hcb_file_path_tests
    tests/FilePathTest.cpp
    src/core/FilePath.h
  )
  target_link_libraries(hcb_file_path_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_file_path_tests PRIVATE src)
  hcb_enable_warnings(hcb_file_path_tests)
  hcb_enable_sanitizers(hcb_file_path_tests)
  add_test(NAME hcb_file_path_tests COMMAND hcb_file_path_tests)

  qt_add_executable(hcb_test_bootstrap_tests
    tests/TestApplicationBootstrapTest.cpp
    tests/support/TestApplicationBootstrap.h
    src/app/AppPaths.cpp
    src/app/AppPaths.h
    src/app/AppServices.cpp
    src/app/AppServices.h
    src/core/Clock.h
    src/core/FilePath.h
    src/core/SettingsRegistry.h
  )
  target_link_libraries(hcb_test_bootstrap_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_test_bootstrap_tests PRIVATE src tests)
  hcb_enable_warnings(hcb_test_bootstrap_tests)
  hcb_enable_sanitizers(hcb_test_bootstrap_tests)
  add_test(NAME hcb_test_bootstrap_tests COMMAND hcb_test_bootstrap_tests)

  qt_add_executable(hcb_cancellation_tests
    tests/CancellationTest.cpp
    src/core/Cancellation.h
  )
  target_link_libraries(hcb_cancellation_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_cancellation_tests PRIVATE src)
  hcb_enable_warnings(hcb_cancellation_tests)
  hcb_enable_sanitizers(hcb_cancellation_tests)
  add_test(NAME hcb_cancellation_tests COMMAND hcb_cancellation_tests)

  qt_add_executable(hcb_clock_tests
    tests/ClockTest.cpp
    src/core/Clock.h
  )
  target_link_libraries(hcb_clock_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_clock_tests PRIVATE src)
  hcb_enable_warnings(hcb_clock_tests)
  hcb_enable_sanitizers(hcb_clock_tests)
  add_test(NAME hcb_clock_tests COMMAND hcb_clock_tests)

  qt_add_executable(hcb_application_lifecycle_tests
    tests/ApplicationLifecycleTest.cpp
    src/app/ApplicationLifecycle.h
  )
  target_link_libraries(hcb_application_lifecycle_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_application_lifecycle_tests PRIVATE src)
  hcb_enable_warnings(hcb_application_lifecycle_tests)
  hcb_enable_sanitizers(hcb_application_lifecycle_tests)
  add_test(NAME hcb_application_lifecycle_tests COMMAND hcb_application_lifecycle_tests)

  qt_add_executable(hcb_feature_capability_registry_tests
    tests/FeatureCapabilityRegistryTest.cpp
    src/core/FeatureCapabilityRegistry.h
  )
  target_link_libraries(hcb_feature_capability_registry_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_feature_capability_registry_tests PRIVATE src)
  hcb_enable_warnings(hcb_feature_capability_registry_tests)
  hcb_enable_sanitizers(hcb_feature_capability_registry_tests)
  add_test(NAME hcb_feature_capability_registry_tests COMMAND hcb_feature_capability_registry_tests)

  qt_add_executable(hcb_native_capability_report_tests
    tests/NativeCapabilityReportTest.cpp
    src/core/NativeCapabilityReport.cpp
    src/core/NativeCapabilityReport.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
  )
  target_link_libraries(hcb_native_capability_report_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_native_capability_report_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_capability_report_tests)
  hcb_enable_sanitizers(hcb_native_capability_report_tests)
  add_test(NAME hcb_native_capability_report_tests COMMAND hcb_native_capability_report_tests)

  qt_add_executable(hcb_command_registry_model_tests
    tests/CommandRegistryModelTest.cpp
    src/core/CommandRegistryModel.cpp
    src/core/CommandRegistryModel.h
  )
  target_link_libraries(hcb_command_registry_model_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_command_registry_model_tests PRIVATE src)
  hcb_enable_warnings(hcb_command_registry_model_tests)
  hcb_enable_sanitizers(hcb_command_registry_model_tests)
  add_test(NAME hcb_command_registry_model_tests COMMAND hcb_command_registry_model_tests)

  qt_add_executable(hcb_settings_registry_tests
    tests/SettingsRegistryTest.cpp
    src/core/SettingsRegistry.h
  )
  target_link_libraries(hcb_settings_registry_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_settings_registry_tests PRIVATE src)
  hcb_enable_warnings(hcb_settings_registry_tests)
  hcb_enable_sanitizers(hcb_settings_registry_tests)
  add_test(NAME hcb_settings_registry_tests COMMAND hcb_settings_registry_tests)

  qt_add_executable(hcb_google_api_error_tests
    tests/GoogleApiErrorTest.cpp
    src/core/GoogleApiError.cpp
    src/core/GoogleApiError.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
  )
  target_link_libraries(hcb_google_api_error_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_google_api_error_tests PRIVATE src)
  hcb_enable_warnings(hcb_google_api_error_tests)
  hcb_enable_sanitizers(hcb_google_api_error_tests)
  add_test(NAME hcb_google_api_error_tests COMMAND hcb_google_api_error_tests)

  qt_add_executable(hcb_sync_backoff_policy_tests
    tests/SyncBackoffPolicyTest.cpp
    src/core/GoogleApiError.cpp
    src/core/GoogleApiError.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/SyncBackoffPolicy.cpp
    src/core/SyncBackoffPolicy.h
  )
  target_link_libraries(hcb_sync_backoff_policy_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_sync_backoff_policy_tests PRIVATE src)
  hcb_enable_warnings(hcb_sync_backoff_policy_tests)
  hcb_enable_sanitizers(hcb_sync_backoff_policy_tests)
  add_test(NAME hcb_sync_backoff_policy_tests COMMAND hcb_sync_backoff_policy_tests)

  qt_add_executable(hcb_pkce_authorization_tests
    tests/PkceAuthorizationTest.cpp
    src/core/Clock.h
    src/core/PkceAuthorization.cpp
    src/core/PkceAuthorization.h
  )
  target_link_libraries(hcb_pkce_authorization_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_pkce_authorization_tests PRIVATE src)
  hcb_enable_warnings(hcb_pkce_authorization_tests)
  hcb_enable_sanitizers(hcb_pkce_authorization_tests)
  add_test(NAME hcb_pkce_authorization_tests COMMAND hcb_pkce_authorization_tests)

  qt_add_executable(hcb_secret_redactor_tests
    tests/SecretRedactorTest.cpp
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
  )
  target_link_libraries(hcb_secret_redactor_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_secret_redactor_tests PRIVATE src)
  hcb_enable_warnings(hcb_secret_redactor_tests)
  hcb_enable_sanitizers(hcb_secret_redactor_tests)
  add_test(NAME hcb_secret_redactor_tests COMMAND hcb_secret_redactor_tests)

  qt_add_executable(hcb_structured_logger_tests
    tests/StructuredLoggerTest.cpp
    src/core/Clock.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/StructuredLogger.cpp
    src/core/StructuredLogger.h
  )
  target_link_libraries(hcb_structured_logger_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_structured_logger_tests PRIVATE src)
  hcb_enable_warnings(hcb_structured_logger_tests)
  hcb_enable_sanitizers(hcb_structured_logger_tests)
  add_test(NAME hcb_structured_logger_tests COMMAND hcb_structured_logger_tests)

  qt_add_executable(hcb_startup_timing_tracker_tests
    tests/StartupTimingTrackerTest.cpp
    src/core/Clock.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/StructuredLogger.cpp
    src/core/StructuredLogger.h
    src/core/StartupTimingTracker.cpp
    src/core/StartupTimingTracker.h
  )
  target_link_libraries(hcb_startup_timing_tracker_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_startup_timing_tracker_tests PRIVATE src)
  hcb_enable_warnings(hcb_startup_timing_tracker_tests)
  hcb_enable_sanitizers(hcb_startup_timing_tracker_tests)
  add_test(NAME hcb_startup_timing_tracker_tests COMMAND hcb_startup_timing_tracker_tests)

  qt_add_executable(hcb_ui_transition_timing_tracker_tests
    tests/UiTransitionTimingTrackerTest.cpp
    src/core/Clock.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/StructuredLogger.cpp
    src/core/StructuredLogger.h
    src/core/UiTransitionTimingTracker.cpp
    src/core/UiTransitionTimingTracker.h
  )
  target_link_libraries(hcb_ui_transition_timing_tracker_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_ui_transition_timing_tracker_tests PRIVATE src)
  hcb_enable_warnings(hcb_ui_transition_timing_tracker_tests)
  hcb_enable_sanitizers(hcb_ui_transition_timing_tracker_tests)
  add_test(NAME hcb_ui_transition_timing_tracker_tests COMMAND hcb_ui_transition_timing_tracker_tests)

  qt_add_executable(hcb_diagnostics_snapshot_tests
    tests/DiagnosticsSnapshotTest.cpp
    src/core/Clock.h
    src/core/DiagnosticsSnapshot.cpp
    src/core/DiagnosticsSnapshot.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/StartupTimingTracker.cpp
    src/core/StartupTimingTracker.h
    src/core/StructuredLogger.cpp
    src/core/StructuredLogger.h
    src/core/UiTransitionTimingTracker.cpp
    src/core/UiTransitionTimingTracker.h
  )
  target_link_libraries(hcb_diagnostics_snapshot_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_diagnostics_snapshot_tests PRIVATE src)
  hcb_enable_warnings(hcb_diagnostics_snapshot_tests)
  hcb_enable_sanitizers(hcb_diagnostics_snapshot_tests)
  add_test(NAME hcb_diagnostics_snapshot_tests COMMAND hcb_diagnostics_snapshot_tests)

  qt_add_executable(hcb_diagnostics_json_exporter_tests
    tests/DiagnosticsJsonExporterTest.cpp
    src/core/Clock.h
    src/core/DiagnosticsJsonExporter.cpp
    src/core/DiagnosticsJsonExporter.h
    src/core/DiagnosticsSnapshot.h
    src/core/SecretRedactor.cpp
    src/core/SecretRedactor.h
    src/core/StartupTimingTracker.cpp
    src/core/StartupTimingTracker.h
    src/core/StructuredLogger.cpp
    src/core/StructuredLogger.h
    src/core/UiTransitionTimingTracker.cpp
    src/core/UiTransitionTimingTracker.h
  )
  target_link_libraries(hcb_diagnostics_json_exporter_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_diagnostics_json_exporter_tests PRIVATE src)
  hcb_enable_warnings(hcb_diagnostics_json_exporter_tests)
  hcb_enable_sanitizers(hcb_diagnostics_json_exporter_tests)
  add_test(NAME hcb_diagnostics_json_exporter_tests COMMAND hcb_diagnostics_json_exporter_tests)

  qt_add_executable(hcb_native_launch_benchmark_tests
    tests/NativeLaunchBenchmarkTest.cpp
    src/core/NativeLaunchBenchmark.cpp
    src/core/NativeLaunchBenchmark.h
  )
  target_link_libraries(hcb_native_launch_benchmark_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_native_launch_benchmark_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_launch_benchmark_tests)
  hcb_enable_sanitizers(hcb_native_launch_benchmark_tests)
  add_test(NAME hcb_native_launch_benchmark_tests COMMAND hcb_native_launch_benchmark_tests)
  add_test(NAME hcb_native_launch_benchmark
    COMMAND hcb_launch_benchmark
      --executable "$<TARGET_FILE:hcb_native>"
      --iterations 1
      --timeout-ms 15000
      -- -platform offscreen
  )

  qt_add_executable(hcb_native_idle_rss_benchmark_tests
    tests/NativeIdleRssBenchmarkTest.cpp
    src/core/NativeIdleRssBenchmark.cpp
    src/core/NativeIdleRssBenchmark.h
    src/core/NativeProcessMemory.cpp
    src/core/NativeProcessMemory.h
  )
  target_link_libraries(hcb_native_idle_rss_benchmark_tests PRIVATE Qt6::Core Qt6::Test)
  if(WIN32)
    target_link_libraries(hcb_native_idle_rss_benchmark_tests PRIVATE Psapi)
  endif()
  target_include_directories(hcb_native_idle_rss_benchmark_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_idle_rss_benchmark_tests)
  hcb_enable_sanitizers(hcb_native_idle_rss_benchmark_tests)
  add_test(NAME hcb_native_idle_rss_benchmark_tests COMMAND hcb_native_idle_rss_benchmark_tests)
  add_test(NAME hcb_native_idle_rss_benchmark
    COMMAND hcb_idle_rss_benchmark
      --executable "$<TARGET_FILE:hcb_native>"
      --idle-duration-ms 250
      --timeout-ms 15000
      -- -platform offscreen
  )

  qt_add_executable(hcb_native_command_palette_benchmark_tests
    tests/NativeCommandPaletteBenchmarkTest.cpp
    src/core/NativeCommandPaletteBenchmark.cpp
    src/core/NativeCommandPaletteBenchmark.h
  )
  target_link_libraries(hcb_native_command_palette_benchmark_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_native_command_palette_benchmark_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_command_palette_benchmark_tests)
  hcb_enable_sanitizers(hcb_native_command_palette_benchmark_tests)
  add_test(NAME hcb_native_command_palette_benchmark_tests
    COMMAND hcb_native_command_palette_benchmark_tests
  )
  add_test(NAME hcb_native_command_palette_benchmark
    COMMAND hcb_command_palette_benchmark
      --executable "$<TARGET_FILE:hcb_native>"
      --iterations 1
      --timeout-ms 15000
      -- -platform offscreen
  )

  qt_add_executable(hcb_native_performance_fixture_tests
    tests/NativePerformanceFixtureTest.cpp
    src/core/NativePerformanceFixture.cpp
    src/core/NativePerformanceFixture.h
  )
  target_link_libraries(hcb_native_performance_fixture_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_native_performance_fixture_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_performance_fixture_tests)
  hcb_enable_sanitizers(hcb_native_performance_fixture_tests)
  add_test(NAME hcb_native_performance_fixture_tests COMMAND hcb_native_performance_fixture_tests)

  qt_add_executable(hcb_native_performance_report_tests
    tests/NativePerformanceReportTest.cpp
    src/core/NativeLaunchBenchmark.h
    src/core/NativePerformanceReport.cpp
    src/core/NativePerformanceReport.h
  )
  target_link_libraries(hcb_native_performance_report_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_native_performance_report_tests PRIVATE src)
  hcb_enable_warnings(hcb_native_performance_report_tests)
  hcb_enable_sanitizers(hcb_native_performance_report_tests)
  add_test(NAME hcb_native_performance_report_tests COMMAND hcb_native_performance_report_tests)
  add_test(NAME hcb_native_performance_report
    COMMAND hcb_performance_report
      --executable "$<TARGET_FILE:hcb_native>"
      --launch-iterations 1
      --idle-duration-ms 250
      --timeout-ms 15000
      -- -platform offscreen
  )

  qt_add_executable(hcb_qml_tests tests/QmlTestMain.cpp)
  target_compile_definitions(hcb_qml_tests PRIVATE
    QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/qml"
  )
  target_link_libraries(hcb_qml_tests PRIVATE Qt6::Qml Qt6::QuickTest)
  hcb_enable_warnings(hcb_qml_tests)
  hcb_enable_sanitizers(hcb_qml_tests)
  add_test(NAME hcb_qml_tests COMMAND hcb_qml_tests -platform offscreen)

  qt_add_executable(hcb_native_qml_shell_smoke tests/NativeQmlShellSmokeTest.cpp)
  target_link_libraries(hcb_native_qml_shell_smoke PRIVATE Qt6::Core Qt6::Test)
  hcb_enable_warnings(hcb_native_qml_shell_smoke)
  hcb_enable_sanitizers(hcb_native_qml_shell_smoke)
  add_test(NAME hcb_native_qml_shell_smoke
    COMMAND hcb_native_qml_shell_smoke "$<TARGET_FILE:hcb_native>"
  )
endif()

set(hcb_static_analysis_dependencies
  hcb_native
  hcb_launch_benchmark
  hcb_idle_rss_benchmark
  hcb_command_palette_benchmark
  hcb_small_performance_fixture
  hcb_medium_performance_fixture
  hcb_event15k_performance_fixture
  hcb_performance_report
)
if(BUILD_TESTING)
  list(APPEND hcb_static_analysis_dependencies
    hcb_core_tests
    hcb_file_path_tests
    hcb_test_bootstrap_tests
    hcb_cancellation_tests
    hcb_clock_tests
    hcb_application_lifecycle_tests
    hcb_feature_capability_registry_tests
    hcb_native_capability_report_tests
    hcb_command_registry_model_tests
    hcb_settings_registry_tests
    hcb_google_api_error_tests
    hcb_sync_backoff_policy_tests
    hcb_pkce_authorization_tests
    hcb_secret_redactor_tests
    hcb_structured_logger_tests
    hcb_startup_timing_tracker_tests
    hcb_ui_transition_timing_tracker_tests
    hcb_diagnostics_snapshot_tests
    hcb_diagnostics_json_exporter_tests
    hcb_native_launch_benchmark_tests
    hcb_native_idle_rss_benchmark_tests
    hcb_native_command_palette_benchmark_tests
    hcb_native_performance_fixture_tests
    hcb_native_performance_report_tests
    hcb_qml_tests
    hcb_native_qml_shell_smoke
  )
endif()
hcb_add_static_analysis_target(${hcb_static_analysis_dependencies})
hcb_add_format_check_target()
if(BUILD_TESTING)
  hcb_add_bootstrap_check(
    hcb_native
    hcb_launch_benchmark
    hcb_idle_rss_benchmark
    hcb_command_palette_benchmark
    hcb_small_performance_fixture
    hcb_medium_performance_fixture
    hcb_event15k_performance_fixture
    hcb_performance_report
    hcb_core_tests
    hcb_file_path_tests
    hcb_test_bootstrap_tests
    hcb_cancellation_tests
    hcb_clock_tests
    hcb_application_lifecycle_tests
    hcb_feature_capability_registry_tests
    hcb_native_capability_report_tests
    hcb_command_registry_model_tests
    hcb_settings_registry_tests
    hcb_google_api_error_tests
    hcb_sync_backoff_policy_tests
    hcb_pkce_authorization_tests
    hcb_secret_redactor_tests
    hcb_structured_logger_tests
    hcb_startup_timing_tracker_tests
    hcb_ui_transition_timing_tracker_tests
    hcb_diagnostics_snapshot_tests
    hcb_diagnostics_json_exporter_tests
    hcb_native_launch_benchmark_tests
    hcb_native_idle_rss_benchmark_tests
    hcb_native_command_palette_benchmark_tests
    hcb_native_performance_fixture_tests
    hcb_native_performance_report_tests
    hcb_qml_tests
    hcb_native_qml_shell_smoke
  )
endif()
