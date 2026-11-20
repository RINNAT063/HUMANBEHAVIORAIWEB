#pragma once

#include <string>
class GeminiService
{
public:
    static std::string uploadVideoToGemini(
        const std::string& filePath
    );
    
    static std::string analyzeVideo(
        const std::string& videoPath
    );

    static bool waitUntilActive(
        const std::string& fileUri
    );
};