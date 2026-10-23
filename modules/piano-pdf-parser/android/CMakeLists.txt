cmake_minimum_required(VERSION 3.22.1)
project(piano_pdf_parser_core)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(
  piano_pdf_parser_core
  SHARED
  src/main/cpp/jni_bridge.cpp
  src/main/cpp/gray_png.cpp
  ../cpp/raster.cpp
  ../cpp/slicer.cpp
)

target_include_directories(
  piano_pdf_parser_core
  PRIVATE
  ../cpp
  src/main/cpp
)

find_library(log-lib log)
find_library(z-lib z)
find_library(jnigraphics-lib jnigraphics)

target_link_libraries(
  piano_pdf_parser_core
  ${log-lib}
  ${z-lib}
  ${jnigraphics-lib}
)
