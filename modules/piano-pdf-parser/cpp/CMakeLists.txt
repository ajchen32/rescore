cmake_minimum_required(VERSION 3.14)
project(piano_pdf_parser_slicer CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(piano_pdf_parser_slicer STATIC
  slicer.cpp
  slicer_legacy.cpp
)

target_include_directories(piano_pdf_parser_slicer PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}
)

add_executable(slicer_test
  slicer_test.cpp
)

target_link_libraries(slicer_test PRIVATE piano_pdf_parser_slicer)

add_executable(slicer_debug
  tools/slicer_debug.cpp
)

target_include_directories(slicer_debug PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/tools
)

target_link_libraries(slicer_debug PRIVATE piano_pdf_parser_slicer)

add_executable(slicer_bench
  tools/bench/bench.cpp
)

target_include_directories(slicer_bench PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/tools
)

target_link_libraries(slicer_bench PRIVATE piano_pdf_parser_slicer)
