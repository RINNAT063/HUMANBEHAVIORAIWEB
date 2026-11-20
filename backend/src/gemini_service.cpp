#include "gemini_service.h"

#include <cpr/cpr.h>
#include <crow/json.h>
#include <thread>
#include <string>
#include <fstream>
#include <sstream>
#include <chrono>
#include <stdexcept>

const std::string MODEL =
    "gemini-2.5-flash";


std::string loadApiKey()
{
    std::ifstream file("../config.txt");

    if(!file.is_open())
    {
        throw std::runtime_error(
            "Cannot open Gemini config.txt"
        );
    }

    std::string key;
    std::getline(file, key);

    if(!key.empty() && key.back() == '\r')
    {
        key.pop_back();
    }

    if(key.empty())
    {
        throw std::runtime_error(
            "Gemini API Key is empty"
        );
    }

    return key;
}


const std::string API_KEY =
    loadApiKey();

std::string GeminiService::uploadVideoToGemini(
    const std::string& filePath
)
{
    std::ifstream file(
        filePath,
        std::ios::binary
    );

    if(!file)
    {
        throw std::runtime_error("Cannot open video file");
    }

    std::stringstream buffer;

    buffer << file.rdbuf();

    std::string videoData =
        buffer.str();

    auto startResponse = cpr::Post(
        cpr::Url{
            "https://generativelanguage.googleapis.com/upload/v1beta/files?key="
            + API_KEY
        },

        cpr::Header{
            {
                "X-Goog-Upload-Protocol",
                "resumable"
            },

            {
                "X-Goog-Upload-Command",
                "start"
            },

            {
                "X-Goog-Upload-Header-Content-Length",
                std::to_string(videoData.size())
            },

            {
                "X-Goog-Upload-Header-Content-Type",
                "video/mp4"
            },

            {
                "Content-Type",
                "application/json"
            }
        },

        cpr::Body{
            R"(
            {
                "file":
                {
                    "display_name":"video.mp4"
                }
            }
            )"
        }
    );

    std::string uploadUrl =
        startResponse.header[
            "x-goog-upload-control-url"
        ];

    if(startResponse.status_code < 200 ||
       startResponse.status_code >= 300 ||
       uploadUrl.empty())
    {
        throw std::runtime_error(
            "Gemini upload initialization failed: " + startResponse.text
        );
    }

    auto uploadResponse = cpr::Post(
        cpr::Url{
            uploadUrl
        },

        cpr::Header{
            {
                "X-Goog-Upload-Command",
                "upload, finalize"
            },

            {
                "X-Goog-Upload-Offset",
                "0"
            }
        },

        cpr::Body{
            videoData
        }
    );

    if(uploadResponse.status_code < 200 ||
       uploadResponse.status_code >= 300)
    {
        throw std::runtime_error(
            "Gemini upload failed: " + uploadResponse.text
        );
    }

    auto json =
        crow::json::load(
            uploadResponse.text
        );

    if(!json)
    {
        throw std::runtime_error("Cannot parse Gemini upload response");
    }

    std::string fileUri =
        json["file"]["uri"].s();

    return fileUri;
}

bool GeminiService::waitUntilActive(
    const std::string& fileUri
)
{
    for(int i = 0; i < 10; i++)
    {
        auto response = cpr::Get(
            cpr::Url{
                fileUri + "?key=" + API_KEY
            }
        );

        auto json =
            crow::json::load(
                response.text
            );

        if(json)
        {
            std::string state =
                json["state"].s();

            if(state == "ACTIVE")
            {
                return true;
            }

            if(state == "FAILED")
            {
                return false;
            }
        }

        std::this_thread::sleep_for(std::chrono::seconds(2));
    }

    return false;
}
std::string loadPrompt(
    const std::string& path
)
{
    std::ifstream file(path);

    if(!file)
    {
        throw std::runtime_error("Cannot open prompt file");
    }

    std::stringstream buffer;

    buffer << file.rdbuf();

    return buffer.str();
}

std::string escapeJson(std::string text)
{
    std::string escaped;
    escaped.reserve(text.size() + 32);
    for(const char character : text)
    {
        switch(character)
        {
            case '"': escaped += "\\\""; break;
            case '\\': escaped += "\\\\"; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default: escaped += character; break;
        }
    }
    return escaped;
}

std::string GeminiService::analyzeVideo(
    const std::string& videoPath
)
{
    std::string prompt =
        loadPrompt(
            "../prompts/json.txt"
        );

    prompt = escapeJson(prompt);

    std::string body =
        R"(
        {
            "contents": [
            {
                "parts": [
                {
                    "text": ")"
        + prompt +
        R"("
                },

                {
                    "file_data": {
                        "mime_type": "video/mp4",
                        "file_uri": ")"
        + videoPath +
        R"("
                    }
                }
                ]
            }
            ]
        })";

    auto response = cpr::Post(

        cpr::Url{
            "https://generativelanguage.googleapis.com/v1beta/models/"
            + MODEL +
            ":generateContent?key="
            + API_KEY
        },

        cpr::Header{
            {
                "Content-Type",
                "application/json"
            }
        },

        cpr::Body{
            body
        }
    );

    auto json =
        crow::json::load(
            response.text
        );

    if(!json)
    {
        throw std::runtime_error("Cannot parse Gemini analysis response");
    }

    if(!json.has("candidates"))
    {
        throw std::runtime_error("Gemini returned no candidates");
    }

    return
        json["candidates"][0]
            ["content"]["parts"][0]
            ["text"]
            .s();
}