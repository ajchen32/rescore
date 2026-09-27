cmake_minimum_required(VERSION 3.22.1)
project(piano_pdf_parser_core)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(
  piano_pdf_parser_core
  SHARED
  src/main/cpp/jni_bridge.cpp
  ../cpp/slicer.cpp
)

target_include_directories(
  piano_pdf_parser_core
  PRIVATE
  ../cpp
  src/main/cpp
)

find_library(log-lib log)

target_link_libraries(
  piano_pdf_parser_core
  ${log-lib}
)
