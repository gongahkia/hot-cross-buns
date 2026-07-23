set(HCB_NATIVE_SOURCES
  src/app/AppPaths.cpp
  src/app/AppPaths.h
  src/app/AppServices.cpp
  src/app/AppServices.h
  src/core/AppError.h
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
  add_test(NAME hcb_core_tests COMMAND hcb_core_tests)
endif()
