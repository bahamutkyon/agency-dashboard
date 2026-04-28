#!/usr/bin/env bash
set -e

echo ""
echo "===================================="
echo "  專家團隊儀表板 — 啟動中"
echo "===================================="
echo ""

if [ ! -d "node_modules" ]; then
  echo "[setup] 第一次啟動,安裝依賴中..."
  npm run install:all
fi

if ! npm run check; then
  echo ""
  echo "[hint] 修復上方問題後再跑 ./start.sh"
  exit 1
fi

echo ""
echo "[ready] 啟動儀表板...瀏覽器請開:"
echo "  http://localhost:5190"
echo ""
npm run dev
