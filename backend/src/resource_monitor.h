#pragma once
#include <windows.h>
#include <cstdint>
#include <mutex>

struct SystemStats
{
    double cpu_percent = 0.0;
    std::uint64_t ram_used_mb = 0;
    std::uint64_t ram_total_mb = 0;
    double ram_percent = 0.0;
    double process_working_set_mb = 0.0;
    std::uint64_t disk_used_gb = 0;
    std::uint64_t disk_total_gb = 0;
    double disk_percent = 0.0;

        // Chi so tai nguyen backend trong qua trinh phan tich video
    double video_cpu_percent = 0.0;
    double video_ram_percent = 0.0;
    double video_disk_read_mb = 0.0;
    double video_disk_write_mb = 0.0;
};

class ResourceMonitor
{
public:
    SystemStats sample();
    static double getThreadCpuTimeMs();
    
    static double getThreadCpuTimeMs(HANDLE threadHandle);


private:
    std::mutex mutex_;
    std::uint64_t previous_idle_ = 0;
    std::uint64_t previous_total_ = 0;
         // Moc thoi gian de tinh CPU cua tien trinh backend
    std::uint64_t previous_process_cpu_ = 0;
    std::uint64_t previous_process_wall_time_ = 0;
};
