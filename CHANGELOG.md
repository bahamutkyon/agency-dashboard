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

## [0.13.0] — 2026-04-29

第三個 LLM provider:Gemini + 跟 jnMetaCode 互通的 YAML 匯入匯出。

### 新增
- **✨ Gemini CLI 整合(第三個 provider)**
  - `geminiProcess.ts` 偵測 `gemini.cmd` / `gemini` 全路徑
  - AgentSession 加 gemini 路徑:每 turn fresh process,history 由我們維護(因 gemini-cli 多輪支援版本不一)
  - System prompt 透過 `<system>...</system>` tag 注入第一條訊息
  - Provider type 升級為 "claude" | "codex" | "gemini"
  - DB schema 加 `sessions.gemini_meta` 欄位 + 自動遷移
  - Sidebar 卡片 hover 加第三個 ✨ 按鈕(僅當 Gemini CLI 偵測到時顯示)
  - ChatWindow header 顯示 🧠 / 🤖 / ✨ 對應 provider tag
  - Smart Router 加 Gemini 規則:「用 gemini」「用 google ai」明確指定即觸發
- **📥📤 Workflow YAML 匯入匯出**(跟 jnMetaCode 互通)
  - `yamlAdapter.ts`:雙向欄位映射(我們的 camelCase ↔ jnMetaCode 的 snake_case)
  - 支援他們的 `depends_on` / `depends_on_mode` / `concurrency` / `condition` / `pause_before` 等命名
  - `any_completed` / `all_completed` 自動轉成我們的 `any` / `all`
  - 匯入時偵測未知 agent_id 並警告
  - WorkflowsPanel 頂部加「📥 匯入 YAML」按鈕
  - 每筆 workflow 旁邊加「📤 YAML」匯出按鈕
- README 加多 LLM 安裝指引(Codex + Gemini)

---

## [0.12.0] — 2026-04-29

整合 jnMetaCode/Agency-orchestrator 的進階 workflow 功能 + 12 個新範本。

### 新增
- **🎬 12 個新範本**(從 jnMetaCode 22 個 YAML 翻譯成繁體 + DAG 化):
  - 短影音腳本(TikTok / 抖音 / Reels)
  - [平行] 投資 / 商業機會分析(市場+財務+技術+風險四角度)
  - OKR 目標拆解(年→季→週)
  - Pitch Deck 大綱(10 頁標準結構 + 預設 Q&A)
  - 會議紀錄整理
  - 小紅書爆款貼文(平台特定)
  - 故事創作(角色 + 大綱 + 章節)
  - **[協作] CEO 委派多部門 SOP**(產品/行銷/財務並行 + CEO 整合審核)
  - **[協作] 突發事件 / 危機回應**(對外 + 對內稿並行 + post-mortem)
  - **[協作] 行銷活動全鏈路**(IG / 小紅書 / YT 並行 + KPI 儀表板)
  - **[協作] 招聘 pipeline**(JD / 篩選題 / 面試題 / 評分表)
  - **[協作] 內容發佈前審查**(事實 / 品牌 / 法務 / SEO 四層並行 → 修改清單)
  - 範本總數從 14 → 26 個
- **🏃 `dependsOnMode: "any"`** — 多依賴可選「任一完成就觸發」(賽跑 / fan-in 模式)
  - WorkflowStep 加 `dependsOnMode` 欄位
  - Runner 區分 all / any 觸發邏輯
  - prompt 變數 `{{out}}` 在 any 模式下取「先完成的勝者輸出」
  - UI:多依賴時下拉切換
- **⚡ Workflow 自訂並行上限** — `maxConcurrency` per workflow(預設 2,可設 1-5)
  - DB 加 `max_concurrency` 欄位 + 自動遷移
  - 編輯器加並行上限選擇
- **🤖 強化「讓專案經理設計 workflow」**
  - 重寫 system prompt,主動引導 AI 使用 DAG 平行
  - 教 AI 用 step id、`{{stepId.out}}`、`pauseBefore`、`skipIfMatch`、`any` 模式
  - 內建 5 個典範 patterns(多平台內容 / 競品分析 / 客戶提案 / 內容審查 / CEO 委派)

---

## [0.11.1] — 2026-04-29

修正路由偏見 — 之前根據刻板印象把寫程式預設丟給 Codex,事實是 Claude 在程式碼上不輸甚至贏。

### 修改
- **Smart Router 預設改成 Claude**,Codex 變備胎(只在以下情境用):
  - 使用者明確說「用 codex / GPT / OpenAI」(信心 1.0)
  - 提到沙盒執行 / 自動跑 shell(Codex 真正強項,信心 0.8)
- 中英文寫程式關鍵字不再強制丟 Codex
- LLM router prompt 重寫,引導模型誠實偏向 Claude(只在 Codex 真有優勢時才選)
- 真正模糊問題不打 LLM,直接用 Claude(省錢省延遲)

---

## [0.11.0] — 2026-04-29

多模型協作 — 整合 Codex (OpenAI) 並加入 Smart Router。

### 新增
- **🤖 Codex CLI 整合**(A) — 第二個 AI provider 接到 dashboard
  - `codexProcess.ts` 偵測 `codex.cmd`(npm 安裝)/ `codex` 解析全路徑
  - JSONL 輸出解析(thread.started / item.completed / turn.completed)
  - 每 turn 一個 process,用 thread_id resume 多輪對話
  - prompt 透過 stdin 傳入避開 cmd.exe shell 截斷
  - Auth 走你的 ChatGPT Plus OAuth(`codex login`),不需 API key
- **🔀 Workflow Step Provider**(B) — 每步可指定 `claude` / `codex` / `auto`
  - `auto` 觸發 Smart Router 即時判斷
  - 編輯器 UI 加 provider 選擇器
- **🧠 Smart Router 混合判斷**(C)
  - 規則優先(中英文關鍵字 ASCII / CJK 兩套 patterns)
  - LLM fallback(Haiku 分類,~$0.001/次)
  - 24h 結果快取,同類問題不重判
  - UI 顯示判斷依據(規則命中 / LLM 判 / 預設)+ 信心度
- **每個對話卡** — 可手動覆蓋路由(hover 卡片右上小按鈕,選 🧠 Claude 或 🤖 Codex)
- ChatWindow header 顯示當前 provider 標籤(紫色 Claude / 綠色 Codex)
- DB schema:`sessions.provider` + `sessions.codex_thread_id`(自動 ALTER TABLE 遷移)

### 修復
- Windows codepage(zh-TW Big5/CP950)讓 stdin 中文變亂碼 — 改用 ASCII-only escape 過的 stream-json input
- LLM router prompt 改用英文模板,避免 Windows 中文路徑/codepage 干擾

---

## [0.10.1] — 2026-04-29

修工作區設定顧問會「直接答問題、不執行訪問流程」的 bug。

### 修復
- **工作區設定顧問**:當使用者第一句問實際業務問題(例如「怎麼做才會紅?」),AI 之前會直接回答而不是執行 onboarding 訪問
- 強化 system prompt:加入明確「不論使用者問什麼都先打斷,禮貌轉導入訪問」+ 反例示範
- 順帶強化「結構化訪問」與「MEMO 格式」的執行優先級

---

## [0.10.0] — 2026-04-29

CHE 三件套 — 跟 jnMetaCode/Agency-orchestrator 全面追平。

### 新增
- **🩺 DAG 視覺化計畫(E)** — `WorkflowPlan` 元件,在編輯器與執行中 banner 顯示:
  - 拓樸層級(`L1 ⚡×3`):同層平行 step 用綠框、單層用灰框
  - 執行中當前 step 黃色脈動 highlight
  - 循環依賴偵測,有錯標紅
  - 暫停 / 條件跳過小提示
- **↺ Loop back + 迭代上限(C)** — paused 時除了「✓ 批准繼續」外,可選下拉「↺ 回到某步重做」:
  - 選任何已完成的 step,從那步重跑(rewind 該 step + 所有下游)
  - 每個 step 各有迭代計數,上限 5 次防無限迴圈
  - confirm dialog 顯示目前迭代次數
- **🔌 MCP server 模式(H)** — `npm run mcp` 啟動 stdio MCP server,讓 Cursor / Claude Code 等 AI 工具調用我們:
  - `agency_list_workflows / run_workflow / list_agents / chat_with_agent / list_notes / search_sessions` 6 個 tool
  - 透過 `DASHBOARD_URL` env 連到主儀表板,不重複實作 workflow 邏輯
  - 不同工作區可用 `AGENCY_WORKSPACE` env 切換
  - README 補完整安裝指引

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
