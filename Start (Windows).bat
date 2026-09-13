@echo off
REM Double-click me. Installs Node.js if needed, starts the app, opens your browser.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Installing it with winget ^(this takes a minute^)...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Could not install automatically. Opening nodejs.org - install the LTS version,
    echo then double-click this file again.
    start https://nodejs.org
    pause
    exit /b 1
  )
  echo Node.js installed. Close this window and double-click Start again.
  pause
  exit /b 0
)

echo Starting Fantasy Side by Side. Leave this window open; close it ^(or press Ctrl+C^) to stop.
node server.js
pause
