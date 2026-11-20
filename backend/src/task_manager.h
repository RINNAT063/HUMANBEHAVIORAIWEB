#pragma once

#include "task_stats.h"

#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

class TaskManager
{
public:
    TaskManager();
    ~TaskManager();

    TaskManager(const TaskManager&) = delete;
    TaskManager& operator=(const TaskManager&) = delete;

    TaskRecord enqueue(
        const std::string& filename,
        const std::string& videoData
    );

    std::optional<TaskRecord> get(const std::string& id) const;
    std::vector<TaskRecord> list(std::size_t limit = 50) const;
    TaskCounts countsByStatus() const;
    void fail(const std::string& id, const std::string& message);

private:
    void workerLoop();
    void processTask(const std::string& id);
    static std::string createTaskId();

    mutable std::mutex mutex_;
    std::condition_variable condition_;
    std::deque<std::string> queue_;
    std::unordered_map<std::string, TaskRecord> tasks_;
    std::vector<std::string> order_;
    std::thread worker_;
    bool stopping_ = false;
};
