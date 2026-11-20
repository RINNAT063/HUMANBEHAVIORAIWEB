#pragma once

#include <string>
#include <cstdint>

class Database
{
public:
    static void testConnection();

    static void createJob(
        const std::string& taskId,
        const std::string& filename,
        const std::string& filePath,
        std::int64_t sizeBytes
    );

    static void updateJobStatus(
        const std::string& taskId,
        const std::string& status,
        std::int64_t durationMs = 0,
        const std::string& errorMessage = ""
    );

    static void saveAnalysisResult(
        const std::string& taskId,
        int peopleCount,
        int totalActions,
        const std::string& analysisJson
    );

    static void saveResourceSample(
        const std::string& taskId,
        double cpuPercent,
        double ramPercent,
        double ramUsedMb,
        double processWorkingSetMb,
        double diskPercent,
        double diskUsedGb
    );
    
        // HAM MOI: Luu tai nguyen backend khi phan tich video
    

static void saveVideoResourceSample(
    const std::string& taskId,
    double backendCpuPercent,
    double backendRamPercent,
    double backendRamMb,
    double processIoReadMb,
    double processIoWriteMb,
    double videoThreadCpuPercent,
    double videoRamDeltaMb
);



    static std::string getOverviewStats(int hours);
    static std::string getOverviewChart(int hours);
    
    static std::string getVideoResourceSamples(const std::string& taskId);

    static std::string getOverviewJobs(int hours);
    static std::string getOverviewQueue();
    static std::string getOverviewRamRuns(int hours);
};
