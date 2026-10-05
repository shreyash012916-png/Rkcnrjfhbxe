@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required.
  pause
  exit /b 1
)
echo Starting ORBITA Mission Control...
start "ORBITA" cmd /c "node server.js"
timeout /t 2 >nul
start "" http://localhost:10000
echo ORBITA is running at http://localhost:10000
