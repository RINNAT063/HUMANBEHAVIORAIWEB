#include "task_manager.h"
#include "gemini_service.h"
#include "database.h"
#include "resource_monitor.h"

#include <iostream>
#include <algorithm>
#include <chrono>
#include <crow/json.h>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <memory>
#include <utility>
#include <random>
#include <sstream>
#include <stdexcept>

namespace
{
class ResourceSamplingSession
{
public:
    

explicit ResourceSamplingSession(
    const std::string& taskId,
    HANDLE videoThreadHandle
)
{
    HANDLE samplerThreadHandle = nullptr;

    if (!DuplicateHandle(
        GetCurrentProcess(),
        videoThreadHandle,
        GetCurrentProcess(),
        &samplerThreadHandle,
        THREAD_QUERY_INFORMATION,
        FALSE,
        0
    ))
    {
        throw std::runtime_error(
            "Cannot duplicate thread handle for sampler"
        );
    }

    try
    {
        worker_ = std::thread([this, taskId, samplerThreadHandle]()
        {
            
        std::unique_ptr<void, decltype(&CloseHandle)> ownedThreadHandle(
        samplerThreadHandle,
        &CloseHandle
        );  

            // Bo do rieng cho du lieu lich su
            ResourceMonitor historyMonitor;

            // Tao moc ban dau de tinh CPU
            
SystemStats initialVideoStats = historyMonitor.sample();
const double initialVideoRamMb = initialVideoStats.process_working_set_mb;

            
            double previousVideoCpuMs =
            ResourceMonitor::getThreadCpuTimeMs(samplerThreadHandle);

            auto previousVideoSampleTime =
            std::chrono::steady_clock::now();


            std::unique_lock<std::mutex> lock(mutex_);

            while(!stopping_)
            {
                // Moi 2 giay lay mot mau
                if(condition_.wait_for(
                    lock,
                    std::chrono::seconds(2),
                    [this] { return stopping_; }
                ))
                {
                    break;
                }

                lock.unlock();

                try
                {
                    SystemStats stats = historyMonitor.sample();
                    
const double videoRamDeltaMb =
    stats.process_working_set_mb - initialVideoRamMb;

                    
const double currentVideoCpuMs =
    ResourceMonitor::getThreadCpuTimeMs(samplerThreadHandle);

const auto currentVideoSampleTime =
    std::chrono::steady_clock::now();

const double elapsedMs =
    std::chrono::duration<double, std::milli>(
        currentVideoSampleTime - previousVideoSampleTime
    ).count();


double videoThreadCpuPercent = -1.0;


if (previousVideoCpuMs >= 0.0 &&
    currentVideoCpuMs >= 0.0 &&
    elapsedMs > 0.0)
{
    videoThreadCpuPercent =
        ((currentVideoCpuMs - previousVideoCpuMs) / elapsedMs) * 100.0;

    videoThreadCpuPercent =
        std::clamp(videoThreadCpuPercent, 0.0, 100.0);
}

previousVideoCpuMs = currentVideoCpuMs;
previousVideoSampleTime = currentVideoSampleTime;


                    Database::saveResourceSample(
                        taskId,
                        stats.cpu_percent,
                        stats.ram_percent,
                        static_cast<double>(stats.ram_used_mb),
                        stats.process_working_set_mb,
                        stats.disk_percent,
                        static_cast<double>(stats.disk_used_gb)
                    );
                    
                    


Database::saveVideoResourceSample(
    taskId,
    stats.video_cpu_percent,
    stats.video_ram_percent,
    stats.process_working_set_mb,
    stats.video_disk_read_mb,
    stats.video_disk_write_mb,
    videoThreadCpuPercent,
    videoRamDeltaMb
);


           

                }
                catch(const std::exception& e)
                {
                    std::cerr
                        << "[RESOURCE HISTORY ERROR] "
                        << taskId << ": "
                        << e.what()
                        << std::endl;
                }

                lock.lock();
            }

        
        });

    }
    catch (...)
    {
        CloseHandle(samplerThreadHandle);
        throw;
    }
}

~ResourceSamplingSession()

    {
        stop();
    }

    void stop()
    {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            stopping_ = true;
        }

        condition_.notify_all();

        if(worker_.joinable())
        {
            worker_.join();
        }
    }

    ResourceSamplingSession(const ResourceSamplingSession&) = delete;
    ResourceSamplingSession& operator=(const ResourceSamplingSession&) = delete;

private:
    std::mutex mutex_;
    std::condition_variable condition_;
    std::thread worker_;
    bool stopping_ = false;
};
}

TaskManager::TaskManager()
{
    worker_ = std::thread(&TaskManager::workerLoop, this);
}

TaskManager::~TaskManager()
{
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    condition_.notify_all();

    if(worker_.joinable())
    {
        worker_.join();
    }
}

TaskRecord TaskManager::enqueue(
    const std::string& filename,
    const std::string& videoData
)
{
    TaskRecord task;
    task.id = createTaskId();
    task.filename = filename;
    task.file_path = "../uploads/" + task.id + ".mp4";
    task.analysis_path = "../uploads/" + task.id + ".json";
    task.size_bytes = videoData.size();
    task.created_at = currentTimestamp();

    std::filesystem::create_directories("../uploads");
    std::ofstream video(task.file_path, std::ios::binary);
    if(!video)
    {
        throw std::runtime_error("Cannot save uploaded video");
    }
    video.write(videoData.data(), static_cast<std::streamsize>(videoData.size()));
    if(!video)
    {
        throw std::runtime_error("Cannot write uploaded video");
    }
    
    video.close();

    if(!video)
    {
        std::filesystem::remove(task.file_path);
        throw std::runtime_error("Cannot finalize uploaded video");
    }

    try
    {
        Database::createJob(
            task.id,
            task.filename,
            task.file_path,
            static_cast<std::int64_t>(task.size_bytes)
        );
    }
    catch(...)
    {
        std::filesystem::remove(task.file_path);
        throw;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        tasks_[task.id] = task;
        order_.push_back(task.id);
        queue_.push_back(task.id);
    }

    condition_.notify_one();
    return task;
}

std::optional<TaskRecord> TaskManager::get(const std::string& id) const
{
    std::lock_guard<std::mutex> lock(mutex_);
    const auto iterator = tasks_.find(id);
    if(iterator == tasks_.end())
    {
        return std::nullopt;
    }

    return iterator->second;
}

std::vector<TaskRecord> TaskManager::list(std::size_t limit) const
{
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<TaskRecord> result;
    result.reserve(std::min(limit, order_.size()));

    for(auto iterator = order_.rbegin();
        iterator != order_.rend() && result.size() < limit;
        ++iterator)
    {
        result.push_back(tasks_.at(*iterator));
    }

    return result;
}

TaskCounts TaskManager::countsByStatus() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    TaskCounts counts;
    for(const auto& entry : tasks_)
    {
        switch(entry.second.status)
        {
            case TaskStatus::Pending: ++counts.pending; break;
            case TaskStatus::Running: ++counts.running; break;
            case TaskStatus::Completed: ++counts.completed; break;
            case TaskStatus::Failed: ++counts.failed; break;
        }
    }
    return counts;
}

void TaskManager::fail(const std::string& id, const std::string& message)
{
    std::lock_guard<std::mutex> lock(mutex_);
    const auto iterator = tasks_.find(id);
    if(iterator == tasks_.end())
    {
        return;
    }

    iterator->second.status = TaskStatus::Failed;
    iterator->second.error_message = message;
    iterator->second.finished_at = currentTimestamp();
}

void TaskManager::workerLoop()
{
    while(true)
    {
        std::string id;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            condition_.wait(lock, [this] {
                return stopping_ || !queue_.empty();
            });

            if(stopping_ && queue_.empty())
            {
                return;
            }

            id = queue_.front();
            queue_.pop_front();
        }

        processTask(id);
    }
}

void TaskManager::processTask(const std::string& id)
{
    TaskRecord task;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& stored = tasks_.at(id);
        stored.status = TaskStatus::Running;
        stored.started_at = currentTimestamp();
        task = stored;
    }

    const auto started = std::chrono::steady_clock::now();
    
    ResourceMonitor boundaryMonitor;

    auto saveBoundarySample = [&]()
    {
        const SystemStats stats = boundaryMonitor.sample();

        Database::saveResourceSample(
            id,
            stats.cpu_percent,
            stats.ram_percent,
            static_cast<double>(stats.ram_used_mb),
            stats.process_working_set_mb,
            stats.disk_percent,
            static_cast<double>(stats.disk_used_gb)
        );
    };

    std::unique_ptr<ResourceSamplingSession> historySampler;

    try
    {
        Database::updateJobStatus(
            id,
            "running"
        );
        
        try
        {
            saveBoundarySample();
        }
        catch(const std::exception& error)
        {
            std::cerr << "[RAM BEFORE ERROR] "
                      << error.what() << std::endl;
        }

        
HANDLE videoThreadHandle = nullptr;

if (!DuplicateHandle(
    GetCurrentProcess(),
    GetCurrentThread(),
    GetCurrentProcess(),
    &videoThreadHandle,
    THREAD_QUERY_INFORMATION,
    FALSE,
    0
))
{
    throw std::runtime_error(
        "Cannot duplicate video processing thread handle"
    );
}

try
{
    historySampler = std::make_unique<ResourceSamplingSession>(
        id,
        videoThreadHandle
    );
}
catch (...)
{
    CloseHandle(videoThreadHandle);
    throw;
}

CloseHandle(videoThreadHandle);


        const std::string fileUri =
            GeminiService::uploadVideoToGemini(task.file_path);

        if(fileUri.rfind("https://", 0) != 0)
        {
            throw std::runtime_error("Gemini upload failed: " + fileUri);
        }

        if(!GeminiService::waitUntilActive(fileUri))
        {
            throw std::runtime_error("Gemini file did not become ACTIVE");
        }

        
        const std::string analysis =
            GeminiService::analyzeVideo(fileUri);

        auto aiData = crow::json::load(analysis);

        if(!aiData)
        {
            throw std::runtime_error(
                "Gemini returned invalid analysis JSON"
            );
        }

        int peopleCount = 0;
        int totalActions = 0;

        if(
            aiData.has("people") &&
            aiData["people"].t() == crow::json::type::List
        )
        {
            peopleCount =
                static_cast<int>(aiData["people"].size());

            for(const auto& person : aiData["people"])
            {
                if(
                    person.has("actions") &&
                    person["actions"].t() == crow::json::type::List
                )
                {
                    totalActions +=
                        static_cast<int>(person["actions"].size());
                }
            }
        }

        std::ofstream output(task.analysis_path, std::ios::binary);
        if(!output)
        {
            throw std::runtime_error("Cannot save analysis result");
        }
        output.write(analysis.data(), static_cast<std::streamsize>(analysis.size()));

        
        output.close();

        if(!output)
        {
            throw std::runtime_error(
                "Cannot finalize analysis result"
            );
        }

        Database::saveAnalysisResult(
            id,
            peopleCount,
            totalActions,
            analysis
        );

        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started
        ).count();
        
        Database::updateJobStatus(
            id,
            "completed",
            elapsed
        );
        
        // RAM sau khi Gemini hoan thanh
        try
        {
            saveBoundarySample();
        }
        catch(const std::exception& error)
        {
            std::cerr << "[RAM AFTER ERROR] "
                      << error.what() << std::endl;
        }

        historySampler.reset();

        std::lock_guard<std::mutex> lock(mutex_);
        auto& stored = tasks_.at(id);
        stored.status = TaskStatus::Completed;
        stored.finished_at = currentTimestamp();
        stored.duration_ms = elapsed;
        if(elapsed > 0)
        {
            const double megabytes =
                static_cast<double>(stored.size_bytes) / (1024.0 * 1024.0);
            stored.throughput_mbps = megabytes / (elapsed / 1000.0);
        }
    }
    
    catch(const std::exception& error)
    {
        historySampler.reset();
        
        try
        {
            saveBoundarySample();
        }
        catch(const std::exception& sampleError)
        {
            std::cerr << "[RAM AFTER ERROR] "
                      << sampleError.what() << std::endl;
        }

        const auto elapsed =
            std::chrono::duration_cast<
                std::chrono::milliseconds
            >(
                std::chrono::steady_clock::now() - started
            ).count();

        const std::string errorMessage = error.what();

        try
        {
            Database::updateJobStatus(
                id,
                "failed",
                elapsed,
                errorMessage
            );
        }
        catch(const std::exception& dbError)
        {
            std::cerr
                << "[DATABASE ERROR] Cannot update failed job "
                << id << ": "
                << dbError.what()
                << std::endl;
        }

        {
            std::lock_guard<std::mutex> lock(mutex_);

            auto& stored = tasks_.at(id);
            stored.status = TaskStatus::Failed;
            stored.finished_at = currentTimestamp();
            stored.duration_ms = elapsed;
            stored.error_message = errorMessage;
        }
    }
}

std::string TaskManager::createTaskId()
{
    static std::atomic<unsigned long long> counter{0};
    const auto now = std::chrono::system_clock::now().time_since_epoch();
    const auto millis =
        std::chrono::duration_cast<std::chrono::milliseconds>(now).count();

    std::ostringstream stream;
    stream << std::hex << millis << "-" << ++counter;
    return stream.str();
}
