@echo off
chcp 65001 >nul
echo.
echo ====================================
echo   專家團隊儀表板 — 啟動中
echo ====================================
echo.

REM 第一次跑會自動安裝依賴
if not exist "node_modules" (
  echo [setup] 第一次啟動,安裝依賴中...
  call npm run install:all
  if errorlevel 1 (
    echo.
    echo [error] 依賴安裝失敗,請看上方錯誤訊息
    pause
    exit /b 1
  )
)

call npm run check
if errorlevel 1 (
  echo.
  echo [hint] 修復上方問題後再跑 start.bat
  pause
  exit /b 1
)

echo.
echo [ready] 啟動儀表板...瀏覽器請開:
echo   http://localhost:5190
echo.
call npm run dev
