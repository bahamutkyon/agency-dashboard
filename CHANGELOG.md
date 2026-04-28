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

## [0.3.0] — 2026-04-28

進階協作工作流。

### 新增
- **Ctrl+K 命令面板** — 全域搜尋功能 / agent / 對話內容,鍵盤 navigation
- **Ctrl+B** — 收合/展開 sidebar
- **拖曳排序對話 tab**
- **工作區匯入/匯出 JSON** — 可備份或分享給朋友(設定+筆記+模板+排程,**不含對話**)
- **批次同題「✨ 合併最佳版本」** — N 個 agent 答完後一鍵整合出強強聯手的答案

### 修復
- 後端 spawn claude 時 `--tools ""` 在 Windows shell 會被吞掉(改成移除 flag,claude 不會主動用 tool)

---

## [0.2.0] — 2026-04-28

日常使用體驗大升級。

### 新增
- **Markdown 渲染** — 對話訊息支援列表/粗體/代碼塊/表格/連結;摘要面板同步
- **訊息複製按鈕** — hover 任一訊息出現,一鍵複製
- **代碼塊獨立複製按鈕** — code block 右上角
- **編輯重送(user 訊息)** — 把 prompt 載回輸入框,改完重發,自動清掉後續所有訊息
- **重新產生(assistant 訊息)** — 不滿意?點「🔄 再試一次」用同樣 prompt 重跑
- **Sidebar 收合** — 頂部 ◀ 按鈕,或 `Ctrl+B` 快捷鍵;localStorage 記住狀態
- **拖曳上傳檔案** — 文字檔內聯、圖片走 path 給 claude 看、PDF 用 Read tool 讀
- **工作區切換 confirm** — 若有未關 tab 切換時提示

### 修改
- README 補上新功能說明
- 工作區編輯器加範本選單 + AI 訪問助手按鈕(已於 0.1.x 中加入)

### 移除
- `server/smoke.mjs`(開發測試用)

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
