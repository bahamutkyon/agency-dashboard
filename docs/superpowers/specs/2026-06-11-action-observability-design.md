# D 動作可觀測（Observability）設計規格

- 日期：2026-06-11
- 狀態：設計已確認，待寫實作計畫
- 範圍：agency-dashboard（server + client + DB）
- 背景：OpenClaw 化路線 A(沙箱)→B(自主迴圈)→C(行動核可) 之後的第四步 D。讓使用者看清 agent / 自主 run 實際做了什麼。E（事件觸發）為獨立後續專案，另立規格（D 先做，因觀測能幫驗證 B+C）。

## 1. 目標與背景

### 問題
目前完全沒有 activity/audit 概念。要知道 agent 做了什麼，得逐一打開 session 看對話。更關鍵：**agent 在子進程裡的每個工具呼叫（bash／寫檔／MCP）目前被丟棄**——`agentSession.ts` 解析 claude 串流的 assistant 訊息時只 `.filter(c.type === "text")`，`tool_use`／`tool_result` 區塊雖在串流裡卻被忽略。因此「agent 到底執行了哪些指令」這層資訊有送達、卻沒被捕捉。

C 的核可閘門對子進程內 raw 工具呼叫只是**軟約束**（攔不住）。D 的「全都看得到」正是這個缺口的**安全互補**：即使硬攔不了，至少完整可審計。

### 目標
1. 捕捉 agent 每個工具呼叫（tool_use / tool_result），不再丟棄。
2. 跨 session 的「活動」時間軸總覽頁：一個地方看所有 agent / run 最近做了什麼。
3. 對話內聯即時顯示工具呼叫（現場看自主 run 在做什麼）。
4. 持久化、可篩選、即時更新、耐重啟。

### 成功標準
- 自主 run 或一般對話中，agent 執行 bash／寫檔／呼叫 MCP 時，活動頁與對話內聯都看得到「🔧 Bash: `npm test`」「↳ ✓ 完成」之類紀錄。
- 活動頁可依 workspace / session / kind 篩選、分頁、即時更新（新動作自動出現）。
- run 生命週期、待批動作決定、派工、排程觸發都進活動時間軸。
- 工具 input/output 在歷史日誌截斷 2000 字並標示總長；對話內聯即時顯示不截斷。
- 活動日誌自動清理（30 天或 2 萬筆，取嚴者），不無限膨脹。

### 非目標（YAGNI）
- **不做工具層攔截／審批**（那是 C 的工具層延伸，本期不碰；D 純讀取觀測）。
- **不做**完整工具輸出的永久保存（截斷後尾段不另存；若 dogfood 顯示需要，未來加「展開抓全文」）。
- **不做**跨機器日誌匯出、外部 APM 串接、即時告警／異常偵測（純記錄與呈現）。
- **不特別處理** codex／gemini 的工具事件：本期聚焦 claude 串流結構；其他 provider 無 tool_use 結構時只記既有 message/result。
- **不做** E（事件觸發）——獨立後續專案。

## 2. 整體架構與資料流

```
[捕捉] agentSession.ts 解析 claude 串流 → emit tool_call / tool_result 事件
            ↓（session event，經 index.ts 既有 forward 到 session room）
[持久化] agentManager.attachPersistence 收 tool_call/tool_result → logActivity + socket activity:event
[持久化] routes/autonomy makeDeps.emit（每個 runner 事件）→ logActivity（run 生命週期）
[持久化] executeDispatch / scheduler.onFire → logActivity（派工 / 排程）
            ↓
[資料] activity_log 表 + store/activity.ts（logActivity / listActivity / pruneActivity）
            ↓
[呈現] GET /api/activity（分頁篩選）+ socket activity:event
       前端 ActivityPane（跨 session 時間軸）
       前端 MessageList 內聯工具 chip（走既有 session:event，不需新端點）
```

**架構決策**：採**統一 `activity_log` 表**（所有事件 append 成一條時間軸），而非從各來源表即時彙整。理由：它本就是日誌，少量冗餘換得單表查詢／渲染簡單；工具呼叫是唯一真正新增的高量資料，其餘高層事件只是少量 logActivity 呼叫。

## 3. 捕捉層（`server/src/agentSession.ts`，淨新、最關鍵）

claude 串流（`--output-format stream-json`）中：
- `assistant` 事件 `message.content` 為區塊陣列，含 `{ type: "tool_use", id, name, input }`。目前 `:258-260` 只取 text 區塊組 message。**新增**：同一處迭代 content，對每個 `tool_use` 區塊 emit：
  ```ts
  this.emit("event", { type: "tool_call", payload: { toolUseId: block.id, name: block.name, input: block.input } });
  ```
  原本 text→message 行為不變（text 區塊照組 message）。
- `user` 事件 content 含 `{ type: "tool_result", tool_use_id, content, is_error }`。目前 `:268-289` 只抽圖片。**新增**：對 tool_result emit：
  ```ts
  this.emit("event", { type: "tool_result", payload: { toolUseId: block.tool_use_id, status: block.is_error ? "error" : "ok", text: <抽取文字內容> } });
  ```
  （tool_result.content 可能是字串或陣列；抽其中 text 區塊串接；圖片維持既有 tool_image 流程不變。）

新 SessionEvent type 加入聯集：`"tool_call" | "tool_result"`（agentSession `SessionEvent.type`）。

**摘要衍生**（給時間軸顯示）：依 tool name 取關鍵欄位——`Bash`→input.command；`Write`/`Edit`/`Read`→input.file_path；`Glob`/`Grep`→input.pattern；MCP（`mcp__*`）→ name + JSON 摘要；其餘→ JSON.stringify(input)。摘要在 store 層或捕捉層產生皆可（規格不強制，計畫定）。

## 4. 資料層

### `activity_log` 表（dbSchema.ts BASE_SCHEMA，CREATE TABLE IF NOT EXISTS）
```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,        -- tool_call|tool_result|run_started|run_step|run_done|action_pending|action_approved|action_rejected|dispatch|schedule_fired
  summary TEXT NOT NULL,
  detail TEXT,               -- 截斷後的 input/output 全文（含「共 N 字」標記）
  status TEXT,               -- ok|error|null
  total_len INTEGER,         -- detail 截斷前原始長度（前端顯示「顯示前 2000 / 共 N 字」）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_log(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity_log(workspace_id, ts DESC);
```

### `server/src/store/activity.ts`（新）
- `logActivity(input: { workspaceId?, sessionId?, runId?, kind, summary, detail?, status?, totalLen? }): void` —— 寫一筆；detail 截斷至 `ACTIVITY_DETAIL_CAP = 2000`，截斷時記原始長度於 totalLen。
- `listActivity(opts: { workspaceId?, sessionId?, kind?, limit?, before? }): ActivityRow[]` —— 依 ts DESC、分頁（before = 游標 ts）、可篩選。limit 預設 50、上限 200。
- `pruneActivity(): number` —— 取嚴者清理：一筆只要「超過 30 天」**或**「不在最近 2 萬筆內」就刪（即保留集 = 最近 2 萬筆 ∩ 最近 30 天內）。回傳刪除筆數。實作：先刪 30 天前者，再刪超出第 2 萬筆的舊資料。
- 比照既有 store 風格（rowTo* 映射）。

截斷常數：input/output 各 `ACTIVITY_DETAIL_CAP = 2000`。Write 的 input.content 特例：summary 用 file_path，detail 存 `路徑 + 前 2000 字內容`。

## 5. 埋點（集中，不散亂）

- **工具呼叫**（高量）：`agentManager.attachPersistence` 的事件 handler 加 `tool_call`/`tool_result` 分支 → `logActivity` + `io` socket `activity:event`。tool_call detail = input 摘要（截斷）；tool_result detail = 輸出文字（截斷）+ status。
- **自主 run 生命週期**：`routes/autonomy.ts` 的 `makeDeps.emit`（已在每個 runner 事件被呼叫，帶 runId + run/action）→ 順手 `logActivity`（kind 依 evt.kind/run.status 映射：run_started/run_step/run_done/action_pending/...）。**runner 保持純淨不碰 DB**，埋點集中在 route 邊界。
- **派工**：`executeDispatch`（routes/sessions.ts）開始時 logActivity(kind=dispatch)。
- **排程觸發**：`index.ts` 的 `scheduler.onFire` callback → logActivity(kind=schedule_fired)。
- prune：`index.ts` boot 時呼叫一次 `pruneActivity`，並可掛既有 cleanup interval（如 agentManager 的閒置清理週期）順帶定期 prune。

## 6. REST + Socket

### REST（掛 `/api/activity`，新 `routes/activity.ts`）
- `GET /api/activity` query: `workspaceId? sessionId? kind? limit? before?` → `{ items: ActivityRow[], nextBefore?: number }`（游標分頁）。limit 上限 200。

### Socket
- `activity:event`（io.emit，新一筆活動）→ ActivityPane 即時 prepend。
- 對話內聯：工具 chip 走**既有** `session:event`（agentSession emit 的 tool_call/tool_result 經 index.ts forward 到 session room），前端 useChatSession 加處理即可，**不需新端點/事件**。

## 7. 前端

- **ActivityPane（新 `client/src/components/ActivityPane.tsx`）**：跨 session 活動時間軸。篩選列（workspace / session / kind）+ 游標分頁「載入更多」+ socket `activity:event` 即時 prepend。每列：時間、agent/session、kind 圖示、summary；可展開看 detail（顯示「前 2000 / 共 N 字」若截斷）。掛入既有面板切換處（與 AutonomyStudyPanel / LearningQueuePanel 等並列）。
- **MessageList 內聯工具 chip**：`useChatSession` 收 `session:event` 時，對 `tool_call`/`tool_result` 不進對話泡泡，而以緊湊 chip 內聯渲染（「🔧 Bash: `npm test`」「↳ ✓」/「↳ ✗ 錯誤」），與既有 tool_image 同精神。即時、不截斷。
- `client/src/lib/api.ts`：`ActivityRow` 型別 + `listActivity` 端點封裝。

## 8. 錯誤處理與邊界
- 捕捉層解析容錯：tool_use/tool_result 結構缺欄位 → 跳過該筆、不崩串流（try/catch 包，沿用既有解析容錯風格）。
- logActivity 失敗（DB 錯）→ console.warn，不影響 agent 對話流（埋點是旁路、非關鍵路徑）。
- 大量工具呼叫：靠截斷 + prune 控量；socket activity:event 為廣播，單人 dogfood 量級可接受（多客戶端優化列未來）。

## 9. 測試
- **捕捉層**（`agentSession` tool_use/tool_result 解析）：餵樣本 claude stream JSON（含 tool_use 的 assistant 事件、含 tool_result 的 user 事件、is_error 情況、缺欄位）→ 驗正確 emit tool_call/tool_result，且既有 message/tool_image 不回歸。
- **store/activity**：logActivity 截斷 + totalLen、listActivity 篩選/游標分頁、pruneActivity 保留規則。
- **route**：GET /api/activity 篩選/分頁/limit 上限守衛。
- **前端**：ActivityPane 渲染 + 篩選 + 即時 prepend；MessageList 工具 chip 渲染（tool_call/tool_result event → chip，含 ok/error）。

## 10. 實作順序（依賴）
1. activity_log 表（dbSchema）→ 2. store/activity（logActivity/listActivity/pruneActivity）→ 3. 捕捉層（agentSession tool_use/tool_result 解析，純解析可測）→ 4. 埋點接線（agentManager + routes/autonomy makeDeps.emit + executeDispatch + scheduler.onFire + boot prune）→ 5. routes/activity + 掛載 → 6. 前端 ActivityPane + api → 7. 前端 MessageList 工具 chip + useChatSession → 8. 最終統一審查。
