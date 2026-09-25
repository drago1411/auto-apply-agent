@echo off
REM ============================================================
REM  launch-chrome-debug.bat
REM  Starts a DEDICATED automation Chrome profile with CDP enabled.
REM  Run this ONCE before starting the Job Application Agent.
REM ============================================================

set "PROFILE_DIR=%~dp0..\data\debug_profile"

REM Try default Chrome install locations
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
    echo [ERROR] Google Chrome not found. Install Chrome or update the path in this bat file.
    pause
    exit /b 1
)

echo [INFO] Launching automation Chrome profile on port 9222...
echo [INFO] Profile folder: %PROFILE_DIR%
echo.
echo  =====================================================
echo   Keep this window open while the agent is running!
echo  =====================================================
echo.

"%CHROME_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check --start-maximized https://www.linkedin.com

pause
