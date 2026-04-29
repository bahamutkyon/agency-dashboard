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

## [0.9.0] — 2026-04-29

Workflow 引擎升級到 DAG。靈感來自 jnMetaCode/Agency-orchestrator 的設計。

### 新增
- **🔀 DAG 平行執行** — workflow steps 可宣告 `dependsOn`,引擎自動偵測無依賴的 steps 並行執行(預設併發 2)
  - 例如:同個內容改編成 IG / 小紅書 / Threads 三平台,後端**同時**跑 → 完成後再合併
  - 步驟 `id` 可自訂,前端編輯 UI 自動帶 `step_N` 預設
- **📌 多上游變數引用** — `{{out}}` (最後一個依賴的輸出) 與 `{{stepId.out}}` (任意上游) 都支援
- **↻ 從某步重跑(Resume)** — 已完成 / 失敗 / 取消的 run 可選一個 step id 重跑該步及其下游,前面已完成的步驟跳過
- **🔁 自動重試 + 指數退避** — 每步預設 2 次重試(共 3 次嘗試),timeout 1.5x 遞增
- **🩺 Validate endpoint** — 跑前驗證 dependsOn 引用 + cycle 偵測
- **+ 8 個新範本**(含 3 個 DAG 平行範例):
  - 🌐 [平行] IP 多平台同步發稿
  - 🔍 [平行] 競品深度分析(三角度同跑)
  - 📋 [仲介] 新客戶 onboarding(含暫停批准)
  - 📈 爆款貼文事後分析
  - 🎓 [平行] 線上課程 launch 套組
  - 🔬 [平行] Code PR 三角度審查
  - 📰 週報 / Newsletter 自動化
  - 🎤 客戶 pitch 準備(暫停批准)

### 比較 jnMetaCode/Agency-orchestrator
我們的 workflow 引擎能力與其追平(DAG / 平行 / 多變數 / resume / retry),但保留 web GUI、工作區記憶、Notes RAG、自動標題、自主分支等獨家功能。剩下對方的:Loop back、validate/plan 圖示、MCP server 模式 — 預計 v0.10.0 補。

---

## [0.8.1] — 2026-04-29

修一個讓使用者開不了「工作區設定顧問」的 bug。

### 修復
- **`error: option '--append-system-prompt <prompt>' argument missing`** — 當 system prompt 含多行 / 引號 / 代碼塊時,Windows cmd.exe shell 會把參數吃掉
- 新增 `claudeProcess.ts` helper:用 `where claude.exe` 解析全路徑,改用 `shell: false` spawn,長 prompt 不再被截
- agentSession / autoTitler / merge / summarize 全部改用此 helper

---

## [0.8.0] — 2026-04-28

讓 agent 真的變聰明。

### 新增
- **🧠 工作區永久記憶** — 每個工作區累積 agent 跨 session 學到的事實
  - Agent 在對話中可輸出 `=== REMEMBER === ... === END REMEMBER ===` 標記,系統自動 append
  - 開新對話時自動注入(全部記憶塞進 system prompt)
  - 上限 10KB,舊內容自動壓縮
  - 工作區編輯介面可瀏覽/手動編輯
- **🏷️ 自動標題 + 自動標籤** — session 第一輪結束後背景產生精準 5-15 字標題 + 3 個 tags,免去手動命名
- **📚 Notes 智能注入** — 送訊息時系統自動用 BM25-ish 計算工作區 notes 相關度,top 1-2 自動 wrap 為 context;UI 顯示「📚 已自動參考筆記:X」
- **⏸️ Workflow 暫停 + 條件跳過**
  - 步驟可設 `pauseBefore` → runner 在執行前暫停,等使用者按「✓ 批准繼續」
  - 步驟可設 `skipIfMatch` regex → 上一步 `{{out}}` 符合時跳過此步
  - 適合需要人工 checkpoint 的流程(法務、合約、發布前)
- **🔌 MCP 整合(基礎)** — 偵測 ~/.claude.json 的 MCP servers,每個工作區可勾選啟用;啟動 session 時自動 `--mcp-config` 注入

---

## [0.7.0] — 2026-04-28

繁體化。

### 新增
- **🇹🇼 簡繁轉換腳本** `scripts/traditionalize-agents.mjs`
  - 用 OpenCC(`cn` → `tw`)把 ~/.claude/agents/ 全部 .md 轉為繁體中文
  - **自動跳過 18 個 CN 平台特定 agent**(微信/小紅書/微博/抖音/快手/百度/知乎/B站/釘釘/飛書/高考/政務/中國電商等),保留原意
  - 原檔備份為 `.simplified.bak`,可一鍵還原
  - npm scripts: `traditionalize` / `traditionalize:dry` / `traditionalize:revert`
- **193 個 agent** 名稱、描述、系統提示全部轉為繁體(台灣用語)

---

## [0.6.0] — 2026-04-28

新手友善。

### 新增
- **🎓 首次使用導覽 Tour** — 第一次打開儀表板自動跑 8 步引導:歡迎 → 找專案經理 → 批次同題 → 自動接力 → agent 搜尋 → 工作區 → 快捷鍵 → 完成
- 每步有亮綠色脈動光暈 highlight 對應 UI 元素
- ←/→/Enter 鍵盤 navigation,Esc 跳過
- localStorage 記住「已看過」,不再自動跳出
- ⚙️ 設定 → 「🎓 重新看一次教學」可隨時重看
- **適合分享給朋友** — 他們 clone 下來第一次跑,會自動看到引導

---

## [0.5.0] — 2026-04-28

智能化升級。

### 新增
- **🤖 Workflow 由專案經理草擬** — 在「自動接力」面板按紫色按鈕,跟 AI 對話,它輸出 ` ```workflow ` JSON,對話頂部「套用為 Workflow」一鍵建立
- **📋 Workflow 範本庫** — 6 個預設(IP 週報生產線 / 新客戶提案 / 競品分析 / Code Review 雙保險 / 線上課程設計 / 空白)
- **🔀 Agent 自主分支建議** — agent 在對話中若判斷子問題該由其他專家處理,會輸出 FORK 標記,前端顯示 banner「接受 / 忽略」(只在使用者主動開啟的對話中啟用,排程/workflow/orchestrator 都關閉)
- **🎨 圖像 prompt 一鍵跳生圖網頁** — ` ```prompt ` 區塊旁新增「開啟 Gemini / ChatGPT / Midjourney」按鈕,自動複製到剪貼簿;`design-image-prompt-engineer` 開啟時自動指示其用 ` ```prompt ` 包輸出

---

## [0.4.0] — 2026-04-28

自動化接力。

### 新增
- **🔗 自動接力 Workflow** — sidebar 新增橘色按鈕
  - 設定 N 個步驟,每步派一位 agent
  - 用 `{{out}}` 把上一步輸出注入下一步
  - 一鍵執行,後端順序跑完
  - 即時 socket 推送進度,前端顯示當前 step
  - 中止執行 / 查看每步對話
  - 執行紀錄保留 20 筆
- 工作區的 standing context 也會自動注入給 workflow 的每一步

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
