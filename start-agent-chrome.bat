@echo off
chcp 65001 >nul
REM ========================================================================
REM Agent 專用 Chrome 啟動器
REM ========================================================================
REM 用法:雙擊這個檔案,Chrome 會用「agent 專用 profile」開啟,
REM       並開啟 CDP port 9222,讓 dashboard 的 playwright MCP 接管。
REM
REM 重要:
REM   1. 這個 Chrome 跟你日常 Chrome【完全分開】(不同 profile)
REM   2. 在這個 Chrome 內登入你想讓 agent 操作的網站(Threads / YouTube
REM      / LinkedIn 等),登入狀態保留下次啟動還在
REM   3. 【絕對不要】在這個 Chrome 登入 Gmail / 銀行 / 任何金融帳號
REM      — agent 看得到 cookies,風險太高
REM   4. 在 dashboard 跟 agent 對話時,他可以呼叫 playwright MCP 操作這個
REM      Chrome 的所有 tab,務必加上「修改前先給我看計畫」這類審核點
REM ========================================================================

set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set PROFILE="C:\Users\baham\AppData\Local\agent-chrome-profile"
set PORT=9222

if not exist %CHROME% (
  echo [error] 找不到 Chrome:%CHROME%
  echo 請手動編輯這個 .bat 把 CHROME 變數改成你電腦上 chrome.exe 的真實路徑
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Agent 專用 Chrome 啟動中
echo ========================================
echo Profile:  %PROFILE%
echo CDP port: %PORT%
echo.
echo 提醒:這個 Chrome 不要登銀行 / Gmail / 任何敏感帳號!
echo.

REM 檢查 9222 port 是否已被佔(常見情況:之前的 Chrome 還沒關)
netstat -an | findstr ":%PORT%" | findstr "LISTENING" >nul
if %errorlevel% == 0 (
  echo [info] Port %PORT% 已被佔用 — 你之前開的 agent Chrome 可能還在,直接用那個就好
  echo        要強制重開,先在工作管理員關掉所有 chrome.exe 再跑這個 .bat
  pause
  exit /b 0
)

start "" %CHROME% --remote-debugging-port=%PORT% --user-data-dir=%PROFILE%

echo.
echo Chrome 已啟動。下一步:
echo   1. 在這個 Chrome 內登入 Threads / YouTube / 你想讓 agent 操作的網站
echo   2. 回 dashboard 開新對話,agent 就能透過 playwright MCP 操作
echo.
timeout /t 4
