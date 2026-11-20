#include "crow.h"
#include "crow/multipart.h"
#include "database.h"
#include "resource_monitor.h"
#include "task_manager.h"

#include <exception>
#include <algorithm>
#include <stdexcept>
#include <string>
#include <windows.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <utility>
namespace
{
    int getOverviewHours(const crow::request& req)
    {
        const char* value = req.url_params.get("hours");

        // Mac dinh xem 1 gio
        const std::string hours = value ? value : "1";

        if(hours == "1") return 1;
        if(hours == "6") return 6;
        if(hours == "12") return 12;
        if(hours == "24") return 24;

        throw std::invalid_argument(
            "hours must be 1, 6, 12 or 24"
        );
    }

    void addCors(crow::response& response)
    {
        response.add_header("Access-Control-Allow-Origin", "*");
        response.add_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.add_header("Access-Control-Allow-Headers", "Content-Type");
    }

    crow::response jsonResponse(crow::json::wvalue value, int status = 200)
    {
        crow::response response(status, value);
        response.add_header("Content-Type", "application/json; charset=utf-8");
        addCors(response);
        return response;
    }
    
    crow::response overviewResponse(
        const std::string& body,
        int status = 200
    )
    {
        crow::response response(status, body);
        response.add_header(
            "Content-Type",
            "application/json; charset=utf-8"
        );
        addCors(response);
        return response;
    }

    crow::response overviewError(
        const std::string& message,
        int status
    )
    {
        crow::json::wvalue error;
        error["status"] = "error";
        error["message"] = message;

        return jsonResponse(std::move(error), status);
    }

    crow::json::wvalue taskToJson(const TaskRecord& task, bool includeAnalysis)
    {
        crow::json::wvalue value;
        value["id"] = task.id;
        value["status"] = taskStatusToString(task.status);
        value["filename"] = task.filename;
        value["size_bytes"] = static_cast<std::int64_t>(task.size_bytes);
        value["created_at"] = task.created_at;
        value["started_at"] = task.started_at;
        value["finished_at"] = task.finished_at;
        value["duration_ms"] = task.duration_ms;
        value["throughput_mbps"] = task.throughput_mbps;
        value["error_message"] = task.error_message;

        if(includeAnalysis && task.status == TaskStatus::Completed)
        {
            std::ifstream input(task.analysis_path, std::ios::binary);
            value["analysis"] = input
                ? std::string(
                    (std::istreambuf_iterator<char>(input)),
                    std::istreambuf_iterator<char>()
                )
                : "";
        }

        return value;
    }

    crow::json::wvalue countsToJson(const TaskCounts& counts)
    {
        crow::json::wvalue value;
        value["pending"] = counts.pending;
        value["running"] = counts.running;
        value["completed"] = counts.completed;
        value["failed"] = counts.failed;
        return value;
    }
}

int main()
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    
    try
    {
        Database::testConnection();
    }
    catch(const std::exception& error)
    {
        std::cerr
            << "[DATABASE ERROR] "
            << error.what()
            << std::endl;

        return 1;
    }


    crow::SimpleApp app;
    TaskManager taskManager;
    ResourceMonitor resourceMonitor;

    CROW_ROUTE(app, "/upload")
    .methods("POST"_method)
    ([&taskManager](const crow::request& req)
    {
        try
        {
            crow::multipart::message msg(req);
            auto part = msg.get_part_by_name("video");
            if(part.body.empty())
            {
                crow::json::wvalue error;
                error["status"] = "error";
                error["message"] = "Video is required";
                return jsonResponse(std::move(error), 400);
            }
            
            const auto& disposition =
                part.get_header_object("Content-Disposition");

            const auto filenameIt =
                disposition.params.find("filename");

            std::string filename =
                filenameIt != disposition.params.end()
                    ? filenameIt->second
                    : "video.mp4";

            std::replace(
                filename.begin(),
                filename.end(),
                '\\',
                '/'
            );

            const auto lastSlash = filename.find_last_of('/');

            if(lastSlash != std::string::npos)
            {
                filename = filename.substr(lastSlash + 1);
            }

            if(filename.empty())
            {
                filename = "video.mp4";
            }

            const TaskRecord task =
                taskManager.enqueue(filename, part.body);

            crow::json::wvalue result;
            result["status"] = "accepted";
            result["task_id"] = task.id;
            result["size"] = static_cast<std::int64_t>(task.size_bytes);
            return jsonResponse(std::move(result), 202);
        }
        catch(const std::exception& e)
        {
            crow::json::wvalue error;
            error["status"] = "error";
            error["message"] = e.what();
            return jsonResponse(std::move(error), 500);
        }
    });

    CROW_ROUTE(app, "/api/tasks")
    ([&taskManager]()
    {
        crow::json::wvalue result;
        crow::json::wvalue::list tasks;
        for(const auto& task : taskManager.list())
        {
            tasks.emplace_back(taskToJson(task, false));
        }
        result["tasks"] = std::move(tasks);
        result["counts"] = countsToJson(taskManager.countsByStatus());
        return jsonResponse(std::move(result));
    });

    CROW_ROUTE(app, "/api/tasks/<string>")
    ([&taskManager](const std::string& id)
    {
        const auto task = taskManager.get(id);
        if(!task)
        {
            crow::json::wvalue error;
            error["status"] = "error";
            error["message"] = "Task not found";
            return jsonResponse(std::move(error), 404);
        }
        return jsonResponse(taskToJson(*task, true));
    });

    CROW_ROUTE(app, "/api/stats")
    ([&taskManager, &resourceMonitor]()
    {
        const SystemStats stats = resourceMonitor.sample();
        crow::json::wvalue result;
        result["system"]["cpu_percent"] = stats.cpu_percent;
        result["system"]["ram_used_mb"] =
            static_cast<std::int64_t>(stats.ram_used_mb);
        result["system"]["ram_total_mb"] =
            static_cast<std::int64_t>(stats.ram_total_mb);
        result["system"]["ram_percent"] = stats.ram_percent;
        result["system"]["disk_used_gb"] =
            static_cast<std::int64_t>(stats.disk_used_gb);
        result["system"]["disk_total_gb"] =
            static_cast<std::int64_t>(stats.disk_total_gb);
        result["system"]["disk_percent"] = stats.disk_percent;
        result["process"]["working_set_mb"] = stats.process_working_set_mb;
        result["tasks"] = countsToJson(taskManager.countsByStatus());
        return jsonResponse(std::move(result));
    });
    
    
    // API lay du lieu tai nguyen backend trong luc phan tich video
    CROW_ROUTE(app, "/api/video-resources/<string>")
    .methods("GET"_method)
    ([](const std::string& taskId)
    {
        try
        {
            return overviewResponse(
                Database::getVideoResourceSamples(taskId)
            );
        }
        catch(const std::exception& e)
        {
            std::cerr
                << "[VIDEO RESOURCES] "
                << e.what()
                << std::endl;

            return overviewError(
                "Cannot load video resource samples",
                500
            );
        }
    });


    CROW_ROUTE(app, "/api/overview/stats")
    .methods("GET"_method)
    ([](const crow::request& req)
    {
        try
        {
            const int hours = getOverviewHours(req);

            return overviewResponse(
                Database::getOverviewStats(hours)
            );
        }
        catch(const std::invalid_argument& e)
        {
            return overviewError(e.what(), 400);
        }
        catch(const std::exception& e)
        {
            std::cerr << "[OVERVIEW STATS] "
                      << e.what() << std::endl;

            return overviewError("Cannot load overview stats", 500);
        }
    });

    CROW_ROUTE(app, "/api/overview/chart")
    .methods("GET"_method)
    ([](const crow::request& req)
    {
        try
        {
            const int hours = getOverviewHours(req);

            return overviewResponse(
                Database::getOverviewChart(hours)
            );
        }
        catch(const std::invalid_argument& e)
        {
            return overviewError(e.what(), 400);
        }
        catch(const std::exception& e)
        {
            std::cerr << "[OVERVIEW CHART] "
                      << e.what() << std::endl;

            return overviewError("Cannot load overview chart", 500);
        }
    });

    CROW_ROUTE(app, "/api/overview/jobs")
    .methods("GET"_method)
    ([](const crow::request& req)
    {
        try
        {
            const int hours = getOverviewHours(req);

            return overviewResponse(
                Database::getOverviewJobs(hours)
            );
        }
        catch(const std::invalid_argument& e)
        {
            return overviewError(e.what(), 400);
        }
        catch(const std::exception& e)
        {
            std::cerr << "[OVERVIEW JOBS] "
                      << e.what() << std::endl;

            return overviewError("Cannot load overview jobs", 500);
        }
    });
    
    CROW_ROUTE(app, "/api/overview/ram-runs")
    .methods("GET"_method)
    ([](const crow::request& req)
    {
        try
        {
            const int hours = getOverviewHours(req);

            return overviewResponse(
                Database::getOverviewRamRuns(hours)
            );
        }
        catch(const std::invalid_argument& e)
        {
            return overviewError(e.what(), 400);
        }
        catch(const std::exception& e)
        {
            std::cerr
                << "[OVERVIEW RAM RUNS] "
                << e.what()
                << std::endl;

            return overviewError(
                "Cannot load RAM runs",
                500
            );
        }
    });

    CROW_ROUTE(app, "/api/overview/queue")
    .methods("GET"_method)
    ([]()
    {
        try
        {
            return overviewResponse(
                Database::getOverviewQueue()
            );
        }
        catch(const std::exception& e)
        {
            std::cerr << "[OVERVIEW QUEUE] "
                      << e.what() << std::endl;

            return overviewError("Cannot load overview queue", 500);
        }
    });

    CROW_ROUTE(app, "/upload")
    .methods("OPTIONS"_method)
    ([]()
    {
        crow::response response(204);
        addCors(response);
        return response;
    });

    app.port(18080).multithreaded().run();
    return 0;
}