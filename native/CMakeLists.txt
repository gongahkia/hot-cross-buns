set(HCB_NATIVE_SOURCES
  src/app/ApplicationLifecycle.h
  src/app/AppPaths.cpp
  src/app/AppPaths.h
  src/app/AppServices.cpp
  src/app/AppServices.h
  src/core/AppError.h
  src/core/Cancellation.h
  src/core/Clock.h
  src/core/FeatureCapabilityRegistry.h
  src/core/SettingsRegistry.h
)

qt_add_executable(hcb_native
  MACOSX_BUNDLE
  WIN32
  src/main.cpp
  ${HCB_NATIVE_SOURCES}
)

qt_add_qml_module(hcb_native
  URI HCB
  VERSION 1.0
  QML_FILES
    qml/Main.qml
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
  )
  target_link_libraries(hcb_core_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_core_tests PRIVATE src)
  hcb_enable_warnings(hcb_core_tests)
  hcb_enable_sanitizers(hcb_core_tests)
  add_test(NAME hcb_core_tests COMMAND hcb_core_tests)

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

  qt_add_executable(hcb_settings_registry_tests
    tests/SettingsRegistryTest.cpp
    src/core/SettingsRegistry.h
  )
  target_link_libraries(hcb_settings_registry_tests PRIVATE Qt6::Core Qt6::Test)
  target_include_directories(hcb_settings_registry_tests PRIVATE src)
  hcb_enable_warnings(hcb_settings_registry_tests)
  hcb_enable_sanitizers(hcb_settings_registry_tests)
  add_test(NAME hcb_settings_registry_tests COMMAND hcb_settings_registry_tests)

  qt_add_executable(hcb_qml_tests tests/QmlTestMain.cpp)
  target_compile_definitions(hcb_qml_tests PRIVATE
    QUICK_TEST_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/qml"
  )
  target_link_libraries(hcb_qml_tests PRIVATE Qt6::Qml Qt6::QuickTest)
  hcb_enable_warnings(hcb_qml_tests)
  hcb_enable_sanitizers(hcb_qml_tests)
  add_test(NAME hcb_qml_tests COMMAND hcb_qml_tests -platform offscreen)
endif()

set(hcb_static_analysis_dependencies hcb_native)
if(BUILD_TESTING)
  list(APPEND hcb_static_analysis_dependencies
    hcb_core_tests
    hcb_cancellation_tests
    hcb_clock_tests
    hcb_application_lifecycle_tests
    hcb_feature_capability_registry_tests
    hcb_settings_registry_tests
    hcb_qml_tests
  )
endif()
hcb_add_static_analysis_target(${hcb_static_analysis_dependencies})
hcb_add_format_check_target()
if(BUILD_TESTING)
  hcb_add_bootstrap_check(
    hcb_native
    hcb_core_tests
    hcb_cancellation_tests
    hcb_clock_tests
    hcb_application_lifecycle_tests
    hcb_feature_capability_registry_tests
    hcb_settings_registry_tests
    hcb_qml_tests
  )
endif()
