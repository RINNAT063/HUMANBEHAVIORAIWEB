cmake_minimum_required(VERSION 3.16)

project(HumanBehaviorAI)

# libpqxx 8 yeu cau C++20
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Duong dan thu vien MSYS2 UCRT64
list(PREPEND CMAKE_PREFIX_PATH "D:/msys2/ucrt64")

# Tim cac thu vien
find_package(OpenSSL REQUIRED)
find_package(cpr REQUIRED)
find_package(libpqxx CONFIG REQUIRED)

# Duong dan thu vien header Crow
include_directories(
    ${CMAKE_SOURCE_DIR}/Crow/include
)

# Cac file C++ tao thanh server.exe
add_executable(
    server

    src/main.cpp
    src/gemini_service.cpp
    src/task_stats.cpp
    src/task_manager.cpp
    src/resource_monitor.cpp
    src/database.cpp
)

# Lien ket cac thu vien
target_link_libraries(
    server PRIVATE

    ws2_32
    mswsock
    psapi
    cpr::cpr
    pqxx
    OpenSSL::Crypto
)
