@echo off
title AddisGo - Smart Mobility & Local City Tours
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo =====================================================================
echo                 AddisGo - Addis Ababa City Guide
echo      Electric Mobility, Verified Local Guides ^& Small-Group Tours
echo =====================================================================
echo.

rem Determine Node executable
if exist "bin\node.exe" (
    set "NODE_CMD=%~dp0bin\node.exe"
    echo [*] Using bundled portable Node.js engine
) else (
    where node >nul 2>nul
    if not errorlevel 1 (
        set "NODE_CMD=node"
        echo [*] Using system Node.js engine
    ) else (
        echo [ERROR] No Node.js engine found.
        echo Please ensure bin\node.exe exists or install Node from https://nodejs.org
        pause
        exit /b 1
    )
)

echo [*] Starting AddisGo local server on port 3003...
echo.

rem Launch browser automatically after 2 seconds in background
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3003"

echo ---------------------------------------------------------------------
echo   Web App URL:  http://localhost:3003
echo.
echo   Demo Accounts:
echo     Admin:   admin@addisgo.et  /  Admin123!
echo     Rider:   rider@addisgo.et  /  Rider123!
echo     Driver:  dawit@addisgo.et  /  Driver123!
echo.
echo   (Press Ctrl+C in this window at any time to shut down the server)
echo ---------------------------------------------------------------------
echo.

"%NODE_CMD%" api\server.js
if errorlevel 1 (
    echo.
    echo Server stopped with error.
    pause
)
