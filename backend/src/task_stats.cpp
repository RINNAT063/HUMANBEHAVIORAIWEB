#include "task_stats.h"

#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>

std::string taskStatusToString(TaskStatus status)
{
    switch(status)
    {
        case TaskStatus::Pending: return "pending";
        case TaskStatus::Running: return "running";
        case TaskStatus::Completed: return "completed";
        case TaskStatus::Failed: return "failed";
    }

    return "unknown";
}

std::string currentTimestamp()
{
    const auto now = std::chrono::system_clock::now();
    const std::time_t value = std::chrono::system_clock::to_time_t(now);
    std::tm localTime{};
    localtime_s(&localTime, &value);

    std::ostringstream stream;
    stream << std::put_time(&localTime, "%Y-%m-%dT%H:%M:%S");
    return stream.str();
}
