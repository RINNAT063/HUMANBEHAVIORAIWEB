
#include "database.h"

#include <pqxx/pqxx>
#include <iostream>
#include <stdexcept>
#include <crow/json.h>
#include <utility>
#include <openssl/evp.h>
#include <array>
#include <fstream>
#include <iomanip>
#include <memory>
#include <sstream>

// ==========================================
// 1. KIEM TRA KET NOI POSTGRESQL
// ==========================================
namespace
{
std::string calculateVideoSha256(const std::string& filePath)
{
    std::ifstream file(filePath, std::ios::binary);

    if(!file)
    {
        throw std::runtime_error(
            "Cannot open video for SHA-256: " + filePath
        );
    }

    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> ctx(
        EVP_MD_CTX_new(),
        &EVP_MD_CTX_free
    );

    if(!ctx || EVP_DigestInit_ex(ctx.get(), EVP_sha256(), nullptr) != 1)
    {
        throw std::runtime_error("Cannot initialize SHA-256");
    }

    std::array<char, 65536> buffer{};

    while(file)
    {
        file.read(buffer.data(), buffer.size());

        const std::streamsize size = file.gcount();

        if(size > 0 &&
           EVP_DigestUpdate(
               ctx.get(),
               buffer.data(),
               static_cast<std::size_t>(size)
           ) != 1)
        {
            throw std::runtime_error("SHA-256 update failed");
        }
    }

    if(!file.eof())
    {
        throw std::runtime_error("Cannot read video for SHA-256");
    }

    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int digestLength = 0;

    if(EVP_DigestFinal_ex(
        ctx.get(),
        digest,
        &digestLength
    ) != 1)
    {
        throw std::runtime_error("SHA-256 calculation failed");
    }

    std::ostringstream result;

    result << std::hex << std::setfill('0');

    for(unsigned int i = 0; i < digestLength; ++i)
    {
        result << std::setw(2)
               << static_cast<unsigned int>(digest[i]);
    }

    return result.str();
}
}

void Database::testConnection()
{
    pqxx::connection conn;
    pqxx::work tx(conn);

    auto result =
        tx.exec("SELECT COUNT(*) FROM videos");

    std::cout
        << "[DATABASE] Connected successfully!\n"
        << "[DATABASE] Videos: "
        << result[0][0].as<long long>()
        << "\n";

    tx.commit();
}

// ==========================================
// 2. LUU VIDEO VA TAO JOB
// ==========================================

void Database::createJob(
    const std::string& taskId,
    const std::string& filename,
    const std::string& filePath,
    std::int64_t sizeBytes
)
{
    
    const std::string videoHash = calculateVideoSha256(filePath);

    pqxx::connection conn;
    pqxx::work tx(conn);

    // Luu thong tin video
    tx.exec(
        R"(
            INSERT INTO videos
            (id, original_filename, stored_path, size_bytes, content_sha256)
            VALUES ($1, $2, $3, $4, $5)
        )",
        pqxx::params{
            taskId,
            filename,
            filePath,
            sizeBytes,
            videoHash
        }
    );

    // Tao cong viec cho Queue
    tx.exec(
        R"(
            INSERT INTO processing_jobs
            (id, video_id, status)
            VALUES ($1, $2, 'pending')
        )",
        pqxx::params{
            taskId,
            taskId
        }
    );

    tx.commit();

    std::cout
        << "[DATABASE] Created job: "
        << taskId << "\n";
}

// ==========================================
// 3. CAP NHAT TRANG THAI JOB
// ==========================================

void Database::updateJobStatus(
    const std::string& taskId,
    const std::string& status,
    std::int64_t durationMs,
    const std::string& errorMessage
)
{
    if (
        status != "running" &&
        status != "completed" &&
        status != "failed"
    )
    {
        throw std::invalid_argument(
            "Invalid job status"
        );
    }

    pqxx::connection conn;
    pqxx::work tx(conn);

    auto result = tx.exec(
        R"(
            UPDATE processing_jobs
            SET
                status = $2::VARCHAR(20),

                started_at =
                    CASE
                        WHEN $2::VARCHAR(20) = 'running'
                        THEN COALESCE(started_at, NOW())
                        ELSE started_at
                    END,

                finished_at =
                    CASE
                        WHEN $2::VARCHAR(20) IN ('completed', 'failed')
                        THEN NOW()
                        ELSE finished_at
                    END,

                duration_ms =
                    CASE
                        WHEN $2::VARCHAR(20) IN ('completed', 'failed')
                        THEN $3::BIGINT
                        ELSE duration_ms
                    END,

                error_message =
                    CASE
                        WHEN $2::VARCHAR(20) = 'failed'
                        THEN $4::TEXT
                        ELSE error_message
                    END

            WHERE id = $1;
        )",
        pqxx::params{
            taskId,
            status,
            durationMs,
            errorMessage
        }
    );

    if (result.affected_rows() != 1)
    {
        throw std::runtime_error(
            "Database job not found: " + taskId
        );
    }

    tx.commit();

    std::cout
        << "[DATABASE] Job "
        << taskId
        << " -> "
        << status
        << "\n";
}

// ==========================================
// 4. LUU KET QUA PHAN TICH GEMINI
// ==========================================

void Database::saveAnalysisResult(
    const std::string& taskId,
    int peopleCount,
    int totalActions,
    const std::string& analysisJson
)
{
    if (peopleCount < 0 || totalActions < 0)
    {
        throw std::invalid_argument(
            "Invalid analysis counts"
        );
    }

    pqxx::connection conn;
    pqxx::work tx(conn);

    tx.exec(
        R"(
            INSERT INTO analysis_results
            (
                job_id,
                people_count,
                total_actions,
                analysis_json
            )
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (job_id)
            DO UPDATE SET
                people_count = EXCLUDED.people_count,
                total_actions = EXCLUDED.total_actions,
                analysis_json = EXCLUDED.analysis_json
        )",
        pqxx::params{
            taskId,
            peopleCount,
            totalActions,
            analysisJson
        }
    );

    tx.commit();

    std::cout
        << "[DATABASE] Analysis saved: "
        << taskId
        << " | People: "
        << peopleCount
        << " | Actions: "
        << totalActions
        << "\n";
}

// ==========================================
// 5. LUU MAU TAI NGUYEN CPU / RAM / DISK
// ==========================================

void Database::saveResourceSample(
    const std::string& taskId,
    double cpuPercent,
    double ramPercent,
    double ramUsedMb,
    double processWorkingSetMb,
    double diskPercent,
    double diskUsedGb
)
{
    pqxx::connection conn;
    pqxx::work tx(conn);

    tx.exec(
        R"(
            INSERT INTO resource_samples
            (
                job_id,
                sampled_at,
                system_cpu_percent,
                system_ram_percent,
                system_ram_used_mb,
                process_working_set_mb,
                disk_percent,
                disk_used_gb
            )
            VALUES
            (
                $1,
                NOW(),
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
            )
        )",
        pqxx::params{
            taskId,
            cpuPercent,
            ramPercent,
            ramUsedMb,
            processWorkingSetMb,
            diskPercent,
            diskUsedGb
        }
    );

    tx.commit();
}




void Database::saveVideoResourceSample(
    const std::string& taskId,
    double backendCpuPercent,
    double backendRamPercent,
    double backendRamMb,
    double processIoReadMb,
    double processIoWriteMb,
    double videoThreadCpuPercent,
    double videoRamDeltaMb
)
{
    pqxx::connection conn;
    pqxx::work tx(conn);

    tx.exec(
        R"(
            INSERT INTO public.video_resource_samples
            (
                job_id,
                sampled_at,
                backend_cpu_percent,
                backend_ram_percent,
                backend_ram_mb,
                process_io_read_mb,
                process_io_write_mb,
                video_thread_cpu_percent,
                video_ram_delta_mb
            )
            VALUES (
                $1, NOW(), $2, $3, $4, $5, $6,
                NULLIF($7, -1.0), $8
            )
        )",
        pqxx::params{
            taskId,
            backendCpuPercent,
            backendRamPercent,
            backendRamMb,
            processIoReadMb,
            processIoWriteMb,
            videoThreadCpuPercent,
            videoRamDeltaMb
        }
    );

    tx.commit();
}



std::string Database::getOverviewStats(int hours)
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    const auto summary = tx.exec(
        R"(
            SELECT
                COALESCE(AVG(system_cpu_percent), 0) AS cpu_avg,
                COALESCE(MAX(system_cpu_percent), 0) AS cpu_peak,
                COALESCE(AVG(system_ram_percent), 0) AS ram_avg,
                COALESCE(MAX(system_ram_percent), 0) AS ram_peak,
                COALESCE(AVG(disk_percent), 0) AS disk_avg,
                COALESCE(MAX(disk_percent), 0) AS disk_peak,
                COUNT(*) AS sample_count
            FROM resource_samples
            WHERE sampled_at >=
                NOW() - make_interval(hours => $1::integer)
        )",
        pqxx::params{hours}
    );

    const auto latest = tx.exec(
        R"(
            SELECT
                system_cpu_percent,
                system_ram_percent,
                disk_percent
            FROM resource_samples
            WHERE sampled_at >=
                NOW() - make_interval(hours => $1::integer)
            ORDER BY sampled_at DESC, id DESC
            LIMIT 1
        )",
        pqxx::params{hours}
    );

    crow::json::wvalue result;

    result["hours"] = hours;
    result["sample_count"] =
        summary[0]["sample_count"].as<std::int64_t>();

    result["cpu"]["average"] =
        summary[0]["cpu_avg"].as<double>();
    result["cpu"]["peak"] =
        summary[0]["cpu_peak"].as<double>();

    result["ram"]["average"] =
        summary[0]["ram_avg"].as<double>();
    result["ram"]["peak"] =
        summary[0]["ram_peak"].as<double>();

    result["disk"]["average"] =
        summary[0]["disk_avg"].as<double>();
    result["disk"]["peak"] =
        summary[0]["disk_peak"].as<double>();

    // Neu chua co du lieu, tra ve 0
    double cpuLatest = 0;
    double ramLatest = 0;
    double diskLatest = 0;

    if(!latest.empty())
    {
        cpuLatest =
            latest[0]["system_cpu_percent"].as<double>(0);
        ramLatest =
            latest[0]["system_ram_percent"].as<double>(0);
        diskLatest =
            latest[0]["disk_percent"].as<double>(0);
    }

    result["cpu"]["latest"] = cpuLatest;
    result["ram"]["latest"] = ramLatest;
    result["disk"]["latest"] = diskLatest;

    tx.commit();

    return result.dump();
}

std::string Database::getOverviewChart(int hours)
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    // Gom du lieu thanh khoang 300 moc thoi gian
    // de bieu do 24h khong qua nang
    const double bucketSeconds =
        static_cast<double>(hours) * 3600.0 / 300.0;

    const auto rows = tx.exec(
        R"(
            SELECT
                TO_CHAR(
                    MIN(sampled_at) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                ) AS sample_time,
                AVG(system_cpu_percent) AS cpu,
                AVG(system_ram_percent) AS ram
            FROM resource_samples
            WHERE sampled_at >=
                NOW() - make_interval(hours => $1::integer)
            GROUP BY
                FLOOR(
                    EXTRACT(EPOCH FROM sampled_at)
                    / $2::double precision
                )
            ORDER BY MIN(sampled_at) ASC
        )",
        pqxx::params{hours, bucketSeconds}
    );

    crow::json::wvalue::list points;

    for(const auto& row : rows)
    {
        crow::json::wvalue point;

        point["time"] =
            row["sample_time"].as<std::string>();
        point["cpu"] = row["cpu"].as<double>(0);
        point["ram"] = row["ram"].as<double>(0);

        points.emplace_back(std::move(point));
    }

    crow::json::wvalue result;
    result["hours"] = hours;
    result["points"] = std::move(points);

    tx.commit();

    return result.dump();
}

std::string Database::getOverviewJobs(int hours)
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    const auto rows = tx.exec(
        R"(
            SELECT
                j.id,                
                CASE
                    WHEN copies.duplicate_number > 1
                    THEN v.original_filename
                         || ' [' || copies.duplicate_number::text || ']'
                    ELSE v.original_filename
                END AS original_filename,
                COALESCE(v.thumbnail_path, '') AS thumbnail_path,
                j.status,
                COALESCE(j.duration_ms, 0) AS duration_ms,
                COALESCE(r.people_count, 0) AS people_count,
                COALESCE(r.total_actions, 0) AS total_actions,
                COALESCE(j.error_message, '') AS error_message,
                TO_CHAR(
                    j.queued_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                ) AS queued_at
            FROM processing_jobs j
            JOIN videos v
                ON v.id = j.video_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS duplicate_number
                FROM videos earlier
                WHERE v.content_sha256 IS NOT NULL
                  AND earlier.content_sha256 = v.content_sha256
                  AND (
                      earlier.uploaded_at < v.uploaded_at
                      OR (
                          earlier.uploaded_at = v.uploaded_at
                          AND earlier.id <= v.id
                      )
                  )
            ) copies ON TRUE
            LEFT JOIN analysis_results r
                ON r.job_id = j.id
            WHERE j.queued_at >=
                NOW() - make_interval(hours => $1::integer)
            ORDER BY j.queued_at DESC
            LIMIT 100
        )",
        pqxx::params{hours}
    );

    crow::json::wvalue::list jobs;

    for(const auto& row : rows)
    {
        crow::json::wvalue job;

        job["id"] = row["id"].as<std::string>();
        job["filename"] =
            row["original_filename"].as<std::string>();
        job["thumbnail_path"] =
            row["thumbnail_path"].as<std::string>();
        job["status"] =
            row["status"].as<std::string>();
        job["duration_ms"] =
            row["duration_ms"].as<std::int64_t>();
        job["people_count"] =
            row["people_count"].as<int>();
        job["total_actions"] =
            row["total_actions"].as<int>();
        job["error_message"] =
            row["error_message"].as<std::string>();
        job["queued_at"] =
            row["queued_at"].as<std::string>();

        jobs.emplace_back(std::move(job));
    }

    crow::json::wvalue result;
    result["hours"] = hours;
    result["jobs"] = std::move(jobs);

    tx.commit();

    return result.dump();
}

std::string Database::getOverviewQueue()
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    const auto rows = tx.exec(
        R"(
            SELECT
                COUNT(*) FILTER (
                    WHERE status = 'pending'
                ) AS pending,
                COUNT(*) FILTER (
                    WHERE status = 'running'
                ) AS running,
                COUNT(*) FILTER (
                    WHERE status = 'completed'
                ) AS completed,
                COUNT(*) FILTER (
                    WHERE status = 'failed'
                ) AS failed
            FROM processing_jobs
        )"
    );

    crow::json::wvalue result;

    result["pending"] =
        rows[0]["pending"].as<std::int64_t>();
    result["running"] =
        rows[0]["running"].as<std::int64_t>();
    result["completed"] =
        rows[0]["completed"].as<std::int64_t>();
    result["failed"] =
        rows[0]["failed"].as<std::int64_t>();

    tx.commit();

    return result.dump();
}

std::string Database::getOverviewRamRuns(int hours)
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    const auto rows = tx.exec(
        R"(
            SELECT
                j.id AS job_id,

                CASE
                    WHEN copies.duplicate_number > 1
                    THEN v.original_filename
                         || ' [' || copies.duplicate_number::text || ']'
                    ELSE v.original_filename
                END AS original_filename,
                
                TO_CHAR(
                    j.started_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                ) AS started_at,

                (ARRAY_AGG(
                    rs.system_ram_percent
                    ORDER BY rs.sampled_at ASC, rs.id ASC
                ))[1] AS ram_before,

                MAX(rs.system_ram_percent) AS ram_peak,

                (ARRAY_AGG(
                    rs.system_ram_percent
                    ORDER BY rs.sampled_at DESC, rs.id DESC
                ))[1] AS ram_after,

                COUNT(*) AS sample_count

            FROM processing_jobs j

            JOIN videos v
                ON v.id = j.video_id
            
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS duplicate_number
                FROM videos earlier
                WHERE v.content_sha256 IS NOT NULL
                  AND earlier.content_sha256 = v.content_sha256
                  AND (
                      earlier.uploaded_at < v.uploaded_at
                      OR (
                          earlier.uploaded_at = v.uploaded_at
                          AND earlier.id <= v.id
                      )
                  )
            ) copies ON TRUE

            JOIN resource_samples rs
                ON rs.job_id = j.id

            WHERE j.queued_at >=
                NOW() - make_interval(hours => $1::integer)

              AND j.status IN ('completed', 'failed')

            GROUP BY j.id, v.original_filename, j.queued_at, j.started_at, copies.duplicate_number

            HAVING COUNT(*) >= 2

            ORDER BY j.queued_at DESC

            LIMIT 8
        )",
        pqxx::params{hours}
    );

    crow::json::wvalue::list runs;

    for(const auto& row : rows)
    {
        crow::json::wvalue run;

        run["job_id"] =
            row["job_id"].as<std::string>();

        run["filename"] =
            row["original_filename"].as<std::string>();
        
        run["started_at"] =
            row["started_at"].as<std::string>("");

        run["before"] =
            row["ram_before"].as<double>(0);

        run["peak"] =
            row["ram_peak"].as<double>(0);

        run["after"] =
            row["ram_after"].as<double>(0);

        run["sample_count"] =
            row["sample_count"].as<std::int64_t>();

        runs.emplace_back(std::move(run));
    }

    crow::json::wvalue result;
    result["hours"] = hours;
    result["runs"] = std::move(runs);

    tx.commit();

    return result.dump();
}

std::string Database::getVideoResourceSamples(const std::string& taskId)
{
    pqxx::connection conn;
    pqxx::read_transaction tx(conn);

    const auto rows = tx.exec(
        R"(
            
SELECT
    sampled_at,
    backend_cpu_percent,
    backend_ram_percent,
    backend_ram_mb,
    process_io_read_mb,
    process_io_write_mb,
    video_thread_cpu_percent,
    video_ram_delta_mb
FROM public.video_resource_samples


            WHERE job_id = $1
            ORDER BY sampled_at ASC, id ASC
        )",
        pqxx::params{taskId}
    );

    crow::json::wvalue::list samples;

    for (const auto& row : rows)
    {
        crow::json::wvalue sample;

        sample["sampled_at"] =
            row["sampled_at"].as<std::string>();

        sample["cpu_percent"] =
            row["backend_cpu_percent"].as<double>(0);

if (row["video_thread_cpu_percent"].is_null())
{
    sample["video_thread_cpu_percent"] = nullptr;
}
else
{
    sample["video_thread_cpu_percent"] =
        row["video_thread_cpu_percent"].as<double>();
}

if (row["video_ram_delta_mb"].is_null())
{
    sample["video_ram_delta_mb"] = nullptr;
}
else
{
    sample["video_ram_delta_mb"] =
        row["video_ram_delta_mb"].as<double>();
}


        sample["ram_percent"] =
            row["backend_ram_percent"].as<double>(0);

        sample["ram_mb"] =
            row["backend_ram_mb"].as<double>(0);

        sample["io_read_mb"] =
            row["process_io_read_mb"].as<double>(0);

        sample["io_write_mb"] =
            row["process_io_write_mb"].as<double>(0);

        samples.emplace_back(std::move(sample));
    }

    crow::json::wvalue result;

    result["job_id"] = taskId;
    result["samples"] = std::move(samples);

    tx.commit();

    return result.dump();
}

