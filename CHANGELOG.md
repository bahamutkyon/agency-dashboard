# 變更紀錄

依照 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 寫法,
版號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/):
**主版號(破壞性) . 次版號(新功能) . 修訂號(修 bug)**。

## [Unreleased]

> 還沒發布的修改寫在這。下次 `npm run release` 時會自動搬到新版號區塊下。

### 新增
-

### 修改
-

### 修復
-

---

## [0.1.0] — 2026-04-28

首次發布,完整功能集。

### 新增
- 🏢 **211 位中文 agent** 多 tab 並行對話、按 17 部門分類
- 👨‍💼 **專案經理(orchestrator)** + 一鍵組隊把推薦 agent 全開
- 🎯 **批次同題** — 多位 agent 並排比較
- → **一鍵接力** — 訊息可轉交給其他 agent
- 📒 **共享筆記** + 對話框 `📎` 一鍵附加為 context
- 📋 **Prompt 模板** + 對話框 `/` 快速插入
- ⏰ **cron 排程** + Web Notification 完成通知
- 🏷️ **Tag / 全文搜尋**(SQL LIKE,即時)
- 💰 **用量顯示**(5h quota、今日成本、7 天柱狀)
- ✨ **對話摘要** — 自動產生結論 + 重點 + 下一步
- 🗂️ **多工作區隔離** — SQLite 資料層,每個工作區獨立資料
- 📝 **專案備忘錄** — 6 種職業範本 + AI 訪問助手 + 自動套用
- 🌙 主題切換、字體大小、桌面通知開關
- 🚀 一鍵啟動腳本(`start.bat` / `start.sh`)+ 環境檢查

### 技術
- 後端:Express + Socket.IO + Node 內建 SQLite + node-cron
- 前端:Vite + React + Tailwind
- 認證:走使用者本機 `claude` CLI(不夾帶 token,可分享給朋友各自用)
