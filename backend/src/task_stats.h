#pragma once

#include <cstdint>
#include <string>

enum class TaskStatus
{
    Pending,
    Running,
    Completed,
    Failed
};

struct TaskRecord
{
    std::string id;
    TaskStatus status = TaskStatus::Pending;
    std::string filename;
    std::string file_path;
    std::string analysis_path;
    std::uint64_t size_bytes = 0;
    std::string created_at;
    std::string started_at;
    std::string finished_at;
    std::int64_t duration_ms = 0;
    double throughput_mbps = 0.0;
    std::string error_message;
};

struct TaskCounts
{
    int pending = 0;
    int running = 0;
    int completed = 0;
    int failed = 0;
};

std::string taskStatusToString(TaskStatus status);
std::string currentTimestamp();
