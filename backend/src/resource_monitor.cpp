#include "resource_monitor.h"

#include <windows.h>
#include <psapi.h>
#include <algorithm>

namespace
{
std::uint64_t fileTimeToUint64(const FILETIME& value)
{
    ULARGE_INTEGER result;
    result.LowPart = value.dwLowDateTime;
    result.HighPart = value.dwHighDateTime;
    return result.QuadPart;
}
}

SystemStats ResourceMonitor::sample()
{
    std::lock_guard<std::mutex> lock(mutex_);
    SystemStats stats;

    FILETIME idleTime{};
    FILETIME kernelTime{};
    FILETIME userTime{};
    if(GetSystemTimes(&idleTime, &kernelTime, &userTime))
    {
        const std::uint64_t idle = fileTimeToUint64(idleTime);
        const std::uint64_t total =
            fileTimeToUint64(kernelTime) + fileTimeToUint64(userTime);

        if(previous_total_ > 0 && total > previous_total_)
        {
            const std::uint64_t totalDelta = total - previous_total_;
            const std::uint64_t idleDelta = idle - previous_idle_;
            stats.cpu_percent =
                100.0 * static_cast<double>(totalDelta - idleDelta) /
                static_cast<double>(totalDelta);
        }

        previous_idle_ = idle;
        previous_total_ = total;
    }

    // Do CPU cua tien trinh backend (server.exe)
    FILETIME creationTime{};
    FILETIME exitTime{};
    FILETIME processKernelTime{};
    FILETIME processUserTime{};
    FILETIME currentTime{};

    if(GetProcessTimes(
        GetCurrentProcess(),
        &creationTime,
        &exitTime,
        &processKernelTime,
        &processUserTime
    ))
    {
        GetSystemTimeAsFileTime(&currentTime);

        const std::uint64_t processCpuTime =
            fileTimeToUint64(processKernelTime) +
            fileTimeToUint64(processUserTime);

        const std::uint64_t wallTime =
            fileTimeToUint64(currentTime);

        if(previous_process_wall_time_ > 0 &&
           wallTime > previous_process_wall_time_ &&
           processCpuTime >= previous_process_cpu_)
        {
            const double cpuDelta = static_cast<double>(
                processCpuTime - previous_process_cpu_
            );

            const double wallDelta = static_cast<double>(
                wallTime - previous_process_wall_time_
            );

            const DWORD processorCount =
                GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);

            if(processorCount > 0)
            {
                stats.video_cpu_percent = std::clamp(
                    100.0 * cpuDelta /
                    (wallDelta * static_cast<double>(processorCount)),
                    0.0,
                    100.0
                );
            }
        }

        previous_process_cpu_ = processCpuTime;
        previous_process_wall_time_ = wallTime;
    }


    MEMORYSTATUSEX memory{};
    memory.dwLength = sizeof(memory);
    if(GlobalMemoryStatusEx(&memory))
    {
        stats.ram_total_mb = memory.ullTotalPhys / (1024ULL * 1024ULL);
        stats.ram_used_mb =
            (memory.ullTotalPhys - memory.ullAvailPhys) / (1024ULL * 1024ULL);
        stats.ram_percent = static_cast<double>(memory.dwMemoryLoad);
    }

    PROCESS_MEMORY_COUNTERS_EX processMemory{};
    if(GetProcessMemoryInfo(
        GetCurrentProcess(),
        reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&processMemory),
        sizeof(processMemory)
    ))
    {
        stats.process_working_set_mb =
            static_cast<double>(processMemory.WorkingSetSize) /
            (1024.0 * 1024.0);

                    // Ty le RAM cua backend so voi tong RAM vat ly
        if(stats.ram_total_mb > 0)
        {
            stats.video_ram_percent =
                100.0 * stats.process_working_set_mb /
                static_cast<double>(stats.ram_total_mb);
        }
    }

    
    // Tong luong I/O cua tien trinh backend
    IO_COUNTERS processIo{};

    if(GetProcessIoCounters(GetCurrentProcess(), &processIo))
    {
        stats.video_disk_read_mb =
            static_cast<double>(processIo.ReadTransferCount) /
            (1024.0 * 1024.0);

        stats.video_disk_write_mb =
            static_cast<double>(processIo.WriteTransferCount) /
            (1024.0 * 1024.0);
    }


    ULARGE_INTEGER freeBytes{};
    ULARGE_INTEGER totalBytes{};
    if(GetDiskFreeSpaceExW(nullptr, &freeBytes, &totalBytes, nullptr))
    {
        const auto usedBytes = totalBytes.QuadPart - freeBytes.QuadPart;
        stats.disk_total_gb = totalBytes.QuadPart / (1024ULL * 1024ULL * 1024ULL);
        stats.disk_used_gb = usedBytes / (1024ULL * 1024ULL * 1024ULL);
        if(totalBytes.QuadPart > 0)
        {
            stats.disk_percent =
                100.0 * static_cast<double>(usedBytes) /
                static_cast<double>(totalBytes.QuadPart);
        }
    }

    return stats;
}

double ResourceMonitor::getThreadCpuTimeMs()
{
    FILETIME creationTime{};
    FILETIME exitTime{};
    FILETIME kernelTime{};
    FILETIME userTime{};

    if (!GetThreadTimes(
        GetCurrentThread(),
        &creationTime,
        &exitTime,
        &kernelTime,
        &userTime
    ))
    {
        return -1.0;
    }

    const std::uint64_t cpuTime =
        fileTimeToUint64(kernelTime) +
        fileTimeToUint64(userTime);

    return static_cast<double>(cpuTime) / 10000.0;
}

double ResourceMonitor::getThreadCpuTimeMs(HANDLE threadHandle)
{
    if (threadHandle == nullptr ||
        threadHandle == INVALID_HANDLE_VALUE)
    {
        return -1.0;
    }

    FILETIME creationTime{};
    FILETIME exitTime{};
    FILETIME kernelTime{};
    FILETIME userTime{};

    if (!GetThreadTimes(
        threadHandle,
        &creationTime,
        &exitTime,
        &kernelTime,
        &userTime
    ))
    {
        return -1.0;
    }

    const std::uint64_t cpuTime =
        fileTimeToUint64(kernelTime) +
        fileTimeToUint64(userTime);

    return static_cast<double>(cpuTime) / 10000.0;
}


