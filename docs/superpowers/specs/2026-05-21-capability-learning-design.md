# 能力學習進程 — 設計規格

- 日期:2026-05-21
- 狀態:設計待審
- 適用專案:agency-dashboard
- 前置:自主學習系統 Phase 1（`2026-05-18-autonomous-learning-design.md`）

## 1. 目標

讓 agent 能**主動**精進自己職業該有的核心專業能力,而不只是被動等真實對話中冒出 `=== LEARN ===` 標記。

使用者觀察到的需求:不同類型的 agent 應該去學自己領域的能力 —— 經營類的去學 CEO 領導力、設計類的去學美學設計力。能力學習分**兩層**:

1. **類層(類共通能力)** — 同一類別的 agent 共享一包「這個領域頂尖專家該有的核心能力」
2. **個人層(個人獨有手藝)** — 每個 agent 在類共通能力之上,再學自己角色獨有的專業細節

## 2. 範圍與非目標

- **複用 Phase 1 的提案佇列**(方案 A)。能力學習進程的本質是「主動產生學習提案」,產出寫進現有 `learning_proposals` 表,使用者用現有 `LearningQueuePanel` 逐條批准。不另建獨立的 run 管理 / 審閱 UI。
- **全程離線,用使用者自己的 Claude 訂閱**。沿用既有 `claudeProcess` 一次性非互動呼叫模式(同 `memoryDistiller`)。
- **非目標**:不改變 Phase 1 既有的被動學習(對話中的 LEARN 標記擷取)、不引入 Python 依賴、不做跨使用者學習共享、不自動批准(品質把關仍由使用者逐條決定)。

## 3. 核心設計決定(含理由)

| 決定 | 內容 | 理由 |
|---|---|---|
| 產出流向 | 學習進程產出寫進現有 `learning_proposals`,走現有批准 UI | Phase 1 已鋪好「提案→批准→注入」,此功能本質是「主動產生提案」,無須另起爐灶 |
| 兩層記憶 | 類層存新表 `category_capability_memory`;個人層沿用 `agent_craft_memory` | 類共通能力由整類 agent 共享;個人手藝依 agent 私有。`agent_craft_memory` 本來就以 `agent_id` 為 PK,個人層零資料表變更 |
| kind / scope | 類層 `kind='domain'` `scope='category'`;個人層 `kind='craft'` `scope='agent-global'` | 不新增 `kind` 列舉值,靠新增的 `scope='category'` 區分兩層,變更面最小 |
| 個人層依賴 | 個人層讀「已批准的」類記憶當輸入,但**不硬性**鎖「類層必須先批准」 | 類層未批時個人層仍可只用人設跑;硬性鎖會卡住流程。改由 UI 引導建議順序 |
| 執行模式 | 後端**序列**逐一跑(一次一個 target),非同步 + socket.io 推進度 | 並發跑會爆 token / rate limit;213 個若同步跑會 HTTP timeout |
| 失敗處理 | 單一 target 失敗 → 記錄、跳過、繼續;最後回報失敗清單 | 一個 agent 學習失敗不該中斷整批 |

## 4. 架構

### 4.1 資料模型

**新增表** `category_capability_memory` —— 每類別一列:

```sql
CREATE TABLE IF NOT EXISTS category_capability_memory (
  category   TEXT PRIMARY KEY,
  content    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
```

**沿用** `agent_craft_memory`(Phase 1 既有)存個人層。

**沿用** `learning_proposals`。新增一個 `scope` 取值 `category`:
- 類層提案:`scope='category'`、`kind='domain'`、`agent_id='__category__:<categoryId>'`(前綴避免與真實 agentId 撞名)
- 個人層提案:`scope='agent-global'`、`kind='craft'`、`agent_id=<agentId>`(與 Phase 1 一致)

> `learning_proposals` 的 `scope` 欄位是 TEXT,不需 DDL 變更;`createProposal` 已接受明確 `scope` 參數,能力學習 runner 直接傳值,不經 `deriveScope` 推導。

### 4.2 新模組 `capabilityLearning.ts`

職責:組裝 prompt、跑 Claude、解析標記、建立提案。Prompt 組裝抽成**純函式**以利單元測試。

**類層** `runCategoryLearning(categoryId, categoryLabel)`:
1. 組 prompt(純函式 `buildCategoryLearningPrompt`):
   > 你是統籌「〔categoryLabel〕」全體專家的領域總監。請盤點:一個世界頂尖的〔categoryLabel〕專家,必須內化哪些**核心能力與專業判斷**?
   > 輸出 5-8 條,每條是一句可直接內化的能力要點,≤ 200 字。
   > 每條用 `=== LEARN kind=domain ===` 換行 內容 換行 `=== END LEARN ===` 包起來。
2. 跑 Claude CLI(一次性非互動)。
3. `parseLearnMarkers()` 解析 → 每條呼叫 `createProposal({ agentId:'__category__:'+categoryId, workspaceId:DEFAULT, kind:'domain', scope:'category', content, source:'capability-learning:category' })`。

**個人層** `runAgentLearning(agent)`:
1. 讀 agent 所屬類別的 `category_capability_memory.content`(可能為空)。
2. 組 prompt(純函式 `buildAgentLearningPrompt`):
   > 你是〔agent 人設摘要〕。你所屬領域的類共通能力如下:〔類記憶,若為空則省略此段〕。
   > 在這些類共通能力**之上**,作為更具體的「〔agent 名稱〕」,你還需要哪些**獨有的**專業細節、手藝、判斷,才能比同類更強?
   > 輸出 3-5 條,避免與上面類共通能力重複。每條用 `=== LEARN kind=craft ===` 包起來。
3. 解析 → `createProposal({ agentId, workspaceId:DEFAULT, kind:'craft', scope:'agent-global', content, source:'capability-learning:agent' })`。

`createProposal` 內建去重(相似度 ≥ 0.7 視為重複、回傳 null),重跑同一 target 不會灌爆佇列。

### 4.3 學習庫存取 `learningStore.ts` 擴充

```
getCategoryMemory(categoryId): string
appendCategoryMemory(categoryId, entry): void   // 同 appendCraftMemory:加日期前綴行、上限壓縮、UPSERT
```

上限沿用 `CRAFT_CAP`(4000 字)邏輯。

### 4.4 批准後寫入 — 擴充 `/api/learning/proposals/:id/approve`

現行邏輯:`setProposalStatus(approved)` → 若 `scope==='agent-global'` 且 `kind` 為 craft/domain → `appendCraftMemory(agentId, content)`。

擴充:
- `scope==='category'` → 解析 `agentId` 的 `__category__:` 前綴取得 categoryId → `appendCategoryMemory(categoryId, content)`
- 其餘維持原邏輯不動

`LearningQueuePanel` 前端不需修改(只是多顯示一種 scope 的提案)。

### 4.5 記憶注入 — 擴充

新增純函式 `buildCapabilityBlock(categoryContent, craftContent)`,把注入區塊從一段變兩段:先「# 你所屬領域的類共通能力」,再「# 你累積的個人手藝」。任一段為空則省略該段;兩段皆空則回傳空字串。

`agentManager` 啟動 session 組 system prompt 時,呼叫 `getCategoryMemory(agent.category)` + `getCraftMemory(agentId)`,以 `buildCapabilityBlock` 取代現行的 `buildCraftMemoryBlock` 呼叫。`buildCraftMemoryBlock` 直接刪除(生產碼僅 `agentManager.ts:121` 一處呼叫,由 `buildCapabilityBlock` 完全取代),不保留死碼;既有的 `learningInjector.test.ts` 一併改為測 `buildCapabilityBlock`。

### 4.6 後端 API

| 端點 | 用途 |
|---|---|
| `POST /api/learning/run` | body `{ targets: [{type:'category'\|'agent', id}] }` → 啟動序列學習,回 `{ runId }` |
| `GET /api/learning/run/:id` | 查進度:`{ status, total, done, failed:[...], current }` |
| socket.io 事件 `learning:progress` | 每完成一個 target 推一次進度 |

執行採序列佇列:一個 in-memory run 物件,逐一處理 targets,完成一個推一次 socket 進度。偵測到 rate limit(沿用 `usageTracker` / 既有 rate limit 偵測)→ 標記 run 為 paused、停止後續。

### 4.7 UI — 新增 `CapabilityLearningPanel.tsx`

獨立新面板(不擠進 `LearningQueuePanel`):
- 列出所有類別(顯示該類 agent 數),可展開列出該類 agent
- 勾選要跑的「類別」與/或個別「agent」
- 「開始學習」按鈕 → `POST /api/learning/run`
- 顯示進度條(done / total)、目前正在跑哪個、失敗清單
- 跑完顯示「N 條提案已進入待批准佇列」,提供連結切到 `LearningQueuePanel`
- 文案引導建議順序:先跑類層 → 到佇列批准 → 再跑個人層

## 5. 流程總覽

```
使用者在 CapabilityLearningPanel 勾選類別/agent
  → POST /api/learning/run
  → 後端序列逐一:組 prompt → 跑 Claude → parseLearnMarkers → createProposal(去重)
  → socket 推進度
  → 提案進 learning_proposals(pending)
使用者在 LearningQueuePanel 逐條批准
  → approve 路由:scope=category → appendCategoryMemory;scope=agent-global → appendCraftMemory
下次該 agent 開 session
  → buildCapabilityBlock(類記憶, 個人記憶) 注入 system prompt
```

## 6. 錯誤處理

- 單一 target 的 Claude CLI 失敗、或回應解析不到任何 LEARN 標記 → 記入 run 的 `failed[]`、跳過、繼續下一個。
- rate limit → **降級處理**:不另設 `paused` 狀態。rate limit 會讓 `runClaudeOnce` 拋錯,每個 target 各自記入 `failed[]`、整批照跑完,使用者從失敗清單可看出哪些沒跑成。專屬 `paused` 狀態與「停止後續 target」延後到後續迭代(見 §11)。
- 提案去重由 `createProposal` 處理,重跑安全。
- `approve` 路由解析 `__category__:` 前綴失敗(格式異常)→ 回 400,不寫記憶。

## 7. 測試計畫(TDD)

| 測試對象 | 類型 | 重點 |
|---|---|---|
| `buildCategoryLearningPrompt` / `buildAgentLearningPrompt` | 純函式單元測試 | 含 categoryLabel / 人設;類記憶為空時省略該段;含正確 LEARN 標記指示 |
| `getCategoryMemory` / `appendCategoryMemory` | DB 測試(臨時類別,測後清理) | 寫入、UPSERT、日期前綴、上限壓縮 |
| `buildCapabilityBlock` | 純函式單元測試 | 兩段皆空→空字串;單段空→省略該段;兩段都有→兩段都在 |
| approve 路由 category 分支 | 整合測試 | `scope=category` 提案批准後寫進 `category_capability_memory` |

## 8. 實作順序建議

1. 資料層:`category_capability_memory` 表 + `learningStore` 的 category 函式(TDD)
2. Prompt 純函式 + `capabilityLearning` 模組(TDD prompt 組裝)
3. `approve` 路由 category 分支(TDD)
4. `buildCapabilityBlock` + `agentManager` 注入接線(TDD)
5. `POST /api/learning/run` + socket 進度
6. `CapabilityLearningPanel.tsx` 前端
7. 端到端驗證:跑一個類別 → 批准 → 確認注入

## 10. 時間驅動機制（自動定期學習）

讓能力學習能**定期自動**觸發,agent 持續精進,不必每次手動啟動。

- **持久化排程**:新增 `learning_schedules` 表(`id` / `name` / `targets` JSON / `cron` / `enabled` / `last_run_at` / `created_at`),survive server 重啟。
- **排程器** `learningScheduler.ts`:模式對齊既有 `scheduler.ts`(node-cron、`Asia/Taipei` 時區、`cron.validate`)。server 啟動時從 DB 載入 enabled 排程並註冊 cron job;觸發時 `createLearningRun(targets)` + `executeLearningRun(runLearningTarget)`,進度照樣走 socket `learning:progress` 事件(payload 多帶 `scheduleId`)。
- **API**:`GET/POST/PATCH/DELETE /api/learning/schedules`。POST 用 `cron.validate` 擋格式錯誤;create/update/delete 後呼叫 `learningScheduler.sync()` 重註冊。
- **UI**:`CapabilityLearningPanel` 加一個排程區塊,提供 cron 預設選項(每天 / 每週一 / 每月 1 號)而非要使用者手寫 cron,並列出既有排程(可啟用/停用、刪除)。
- **與手動觸發共用**:時間驅動只是「自動呼叫」既有的 `createLearningRun` + `executeLearningRun`,runner 邏輯零分歧。
- **rate limit 防護**:沿用 `executeLearningRun` 的序列執行;排程觸發與手動觸發同樣會吃 Claude 訂閱額度,UI 文案需提示。

## 11. 未涵蓋 / 後續

- 第一批要跑哪些 agent:使用者於實作完成後,在 UI 自行勾選決定(本規格不預設範圍)。
- 「重跑」「編輯提案內容再批准」等進階審閱功能:本期不做,沿用 Phase 1 的逐條批准/拒絕即可。
- 排程的 `computeNextRun`(下次執行時間預覽):本期不做,`scheduler.ts` 有現成實作可日後複用。
- rate limit 專屬 `paused` 狀態與「偵測到後停止後續 target」:本期降級為逐項 `failed`(見 §6),`paused` 延後實作。
