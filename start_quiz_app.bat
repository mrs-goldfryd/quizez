@echo off
chcp 65001 > nul
title English Quiz Server & Permanent Cloud

echo ========================================================
echo   English Quiz Platform - Mrs. Goldfryd
echo ========================================================

:: Ensure node is in path
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64;%PATH%"

echo [1/2] Starting local sync server on port 3000...
start /B node server.js

timeout /t 1 /nobreak > nul

echo [2/2] Opening permanent website...
start https://mrs-goldfryd-quizez.surge.sh

echo ========================================================
echo   Permanent Live URL:  https://mrs-goldfryd-quizez.surge.sh
echo   Local Dashboard:     http://localhost:3000
echo   Teacher Admin PIN:   1234
echo ========================================================
pause
