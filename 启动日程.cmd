@echo off
title Semester Schedule
cd /d "%~dp0"

if not exist "node_modules" (
  echo First launch: installing dependencies...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Installation failed. Check the network and try again.
    pause
    exit /b 1
  )
)

echo Starting Semester Schedule...
echo The browser will open automatically. Close this window to stop the local app.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173'"
call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort

echo.
echo The app has stopped.
pause
