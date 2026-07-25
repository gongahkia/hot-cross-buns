cmake_minimum_required(VERSION 3.28)

if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum supported macOS version" FORCE)
endif()

project(HotCrossBuns VERSION 6.0.0 LANGUAGES C CXX)

include(CTest)
include(cmake/HcbWarnings.cmake)
include(cmake/HcbSanitizers.cmake)
include(cmake/HcbStaticAnalysis.cmake)
include(cmake/HcbFormatting.cmake)
include(cmake/HcbBootstrap.cmake)
include(cmake/HcbNativeDependencyManifest.cmake)
include(cmake/HcbSqlite.cmake)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(HCB_NATIVE_DEPENDENCY_MANIFEST "${CMAKE_SOURCE_DIR}/native/dependencies/manifest.json"
  CACHE FILEPATH "Pinned native dependency manifest"
)
hcb_load_native_dependency_manifest("${HCB_NATIVE_DEPENDENCY_MANIFEST}")
hcb_add_sqlite_library()

if(APPLE AND NOT CMAKE_PREFIX_PATH)
  foreach(hcb_qt_prefix IN ITEMS /opt/homebrew /usr/local)
    if(EXISTS "${hcb_qt_prefix}/lib/cmake/Qt6/Qt6Config.cmake")
      list(PREPEND CMAKE_PREFIX_PATH "${hcb_qt_prefix}")
      break()
    endif()
  endforeach()
endif()

find_package(Qt6 ${HCB_NATIVE_QT_VERSION} EXACT REQUIRED
  COMPONENTS Core Gui Network Qml Quick QuickControls2 QuickTest Test
)
qt_standard_project_setup(REQUIRES ${HCB_NATIVE_QT_VERSION})

add_subdirectory(native)
