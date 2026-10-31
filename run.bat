@echo off
setlocal
cd /d "%~dp0"

if exist "bin\node.exe" (
  set "NODE_CMD=%~dp0bin\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js 22.5 or newer is required. Install it from https://nodejs.org
    exit /b 1
  )
  set "NODE_CMD=node"
)

start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3003"

echo.
echo   AddisGo - http://localhost:3003
echo   Demo admin: admin@addisgo.et / Admin123!
echo   Demo rider: rider@addisgo.et / Rider123!
echo   Demo driver: dawit@addisgo.et / Driver123!
echo   Press Ctrl+C to stop.
echo.

"%NODE_CMD%" api\server.js
