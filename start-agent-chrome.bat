@echo off
setlocal

REM ========================================================================
REM Agent-controlled Chrome launcher
REM ========================================================================
REM Opens a dedicated Chrome profile with CDP port 9222, isolated from your
REM daily Chrome. Login to Threads / YouTube / LinkedIn here ONCE, then the
REM dashboard's playwright MCP can drive this browser via CDP.
REM
REM SAFETY: never login to Gmail / banking / sensitive accounts in this
REM profile. The agent has full access to whatever cookies live here.
REM ========================================================================

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\Users\baham\AppData\Local\agent-chrome-profile"
REM 9333 chosen instead of the more common 9222 to avoid conflict with
REM Chrome extensions / DevTools that sometimes squat on 9222.
set "PORT=9333"

if not exist "%CHROME%" (
  echo [ERROR] Chrome not found at:
  echo         %CHROME%
  echo Edit this .bat and update the CHROME variable.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Agent Chrome Launcher
echo ============================================
echo Profile : %PROFILE%
echo CDP port: %PORT%
echo.
echo Reminder: this Chrome is for SOCIAL / CONTENT sites only.
echo NEVER login to Gmail / banking / sensitive accounts here.
echo.

REM Check if port 9222 is already listening (existing agent Chrome)
netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
if %errorlevel% equ 0 (
  echo [INFO] Port %PORT% is already in use.
  echo An existing agent Chrome is already running, just use it.
  echo To force a fresh start, close all chrome.exe in Task Manager first.
  echo.
  pause
  exit /b 0
)

echo Launching Chrome...
start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%"

echo.
echo Chrome launched. Next steps:
echo   1. In this Chrome, login to Threads / YouTube / etc.
echo   2. Go back to dashboard, start a new conversation.
echo   3. Agent can now control this Chrome via playwright MCP.
echo.
echo (You can close this window — Chrome will keep running.)
echo.
pause
endlocal
