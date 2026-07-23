cmake_minimum_required(VERSION 3.28)

if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "14.0" CACHE STRING "Minimum supported macOS version" FORCE)
endif()

project(HotCrossBuns VERSION 6.0.0 LANGUAGES CXX)

include(CTest)
include(cmake/HcbWarnings.cmake)
include(cmake/HcbSanitizers.cmake)
include(cmake/HcbStaticAnalysis.cmake)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(APPLE AND NOT CMAKE_PREFIX_PATH)
  foreach(hcb_qt_prefix IN ITEMS /opt/homebrew /usr/local)
    if(EXISTS "${hcb_qt_prefix}/lib/cmake/Qt6/Qt6Config.cmake")
      list(PREPEND CMAKE_PREFIX_PATH "${hcb_qt_prefix}")
      break()
    endif()
  endforeach()
endif()

find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Qml Quick QuickControls2 Test)
qt_standard_project_setup(REQUIRES 6.8)

add_subdirectory(native)
