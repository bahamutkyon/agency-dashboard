# B 目標驅動自主迴圈 + C 行動預覽核可 設計規格

- 日期：2026-06-11
- 狀態：設計已確認，待寫實作計畫
- 範圍：agency-dashboard（server + client + DB）
- 背景：邁向「OpenClaw 式」自主 agent 的第二、三步。前置步驟 A（工作區沙箱）已完成並併入 main。本規格涵蓋 B（目標驅動自主迴圈）與 C（行動預覽核可閘門）——兩者強耦合：C 是 B 的安全前提，故合併設計、依依賴順序實作。後續步驟另立規格：D 動作可觀測、E 事件觸發。

## 1. 目標與背景

### 問題
目前每個 agent 是 `claude` CLI 子進程，claude 自身已有單回合內的 agentic loop（規劃→呼叫工具→觀察→續行），跑在 `--permission-mode bypassPermissions`。因此：
- **B 缺口**：缺「跨回合的目標持續」。給一個目標後，使用者得每回合手動敲字推進；agent 無法自己「做完一步→看結果→決定下一步→續行」直到達標。
- **C 缺口**：唯一的核可機制是 `DispatchApprovalCard`，只 gate「PM 派工」一種動作，且靠 **client 端解析訊息標記 + localStorage 指紋**追蹤「已派工」——這是先前「派工卡重啟後重複跳」bug 的根因（client 狀態競態）。agent 子進程裡的 bash／寫檔／MCP 外發在 bypassPermissions 下無核可。

### 目標
1. **B**：可在任一 session 上給 agent 一個目標，讓它在預算上限內自主逐步執行到達標／喊停／預算用盡。
2. **C**：以**伺服器權威**的「行動協議 + 待批佇列」為地基，agent 把高風險動作改用結構化標記申報，使用者預覽後批准／拒絕／改寫。
3. **批准節奏**：批計畫一次 → 自動跑到底 → 只有四類高風險動作再攔。
4. **順手根治舊 bug**：把現有手動派工也遷移到 server 佇列（取代 client localStorage 追蹤）。

### 成功標準
- 使用者在 session 設定目標 → agent 回一份步驟計畫 → 使用者批准 → agent 自動逐步執行，前端即時顯示「第 N 步 / 預算用量」。
- 自動迴圈中遇到四類高風險動作（對外發訊息／派工／不可逆破壞／花錢交易安裝）→ 迴圈暫停、推出批准卡、待使用者決定後才續行。
- 達標（`goal_done`）／使用者喊停／預算上限 → 迴圈結束並回報。
- 重啟後 `running` 的 run 一律轉 `paused`，不自動續跑副作用迴圈。
- 手動派工改走 server 佇列，UX 不變，且重啟／重整不再重複跳卡（舊 bug 根治），既有派工測試與 UX 不回歸。
- 待批佇列、run 狀態皆持久化於 DB；多客戶端一致。

### 非目標（YAGNI）
- **不做工具層硬攔截**：不關 bypassPermissions、不接 claude per-tool 權限提示。C 在 Dashboard 層運作；對 agent 子進程內的 raw 工具呼叫為**軟約束**（靠 system prompt 指示 agent 申報），硬攔的僅 dispatch 與迴圈續行。此取捨明列於系統提示說明。
- **不做** codex／gemini 的自主迴圈：本期僅 claude provider。對非 claude session，自主迴圈 API 回明確錯誤（不靜默）。
- **不做** 多 run 並行於同一 session：一個 session 同時最多一個 active run。
- **不做** 排程觸發（E 步）、跨 session 的目標編排。
- **不改** 既有學習、沙箱、MCP/Chrome 接線。

## 2. 整體架構與資料流

三層，依賴方向由下而上（C 底層 → C 介面 → B）：

```
[C-底層] actionProtocol.ts（解析/分類，純函式）
         pending_actions 表 + autonomy_runs 表 + store/autonomy.ts（CRUD）
              ↑
[B]      autonomyRunner.ts（狀態機，注入式依賴，驅動一個 run）
         routes/autonomy.ts（REST）+ socket 事件
              ↑
[C-介面] ActionApprovalCard / AutonomyPanel / useAutonomy（前端只渲染，不持狀態）
```

### 資料流（一個自主 run）
1. 前端 POST `/api/autonomy/runs`（sessionId + goal）→ server 建 `autonomy_runs`（status=`planning`）→ 送 agent 規劃提示。
2. agent 回 `=== ACTION === kind: plan risk: high ...` → server 解析 → 寫 `pending_actions`(plan) → run 轉 `awaiting_plan_approval` → socket `autonomy:pending` + `autonomy:run`。
3. 使用者批准 plan → run 轉 `running` → server 送「執行下一步」提示。
4. agent 回信號：
   - `next_step`：預算內 → 自動送下一步提示（續迴圈）；超預算 → `budget_exhausted`。
   - 高風險 action（dispatch/external_send/destructive/spend）→ 寫 pending → run 轉 `paused_for_action` → 待批。批准後執行（dispatch 跑子 session；其餘記錄批准 + 指示 agent「已核可，請執行並回報」）→ 回 `running`。拒絕 → 指示 agent「此動作被拒，請改用替代方案或結束」。
   - `need_input`：run 轉 `paused_for_input`，把 agent 問題顯示給使用者；使用者回覆 → 續行。
   - `goal_done`：run 轉 `done`。
5. 任一步 session error → run 轉 `error`。使用者隨時可 POST stop → `stopped`。

## 3. 行動協議（`server/src/actionProtocol.ts`，純函式、可測）

標記格式（與既有 `=== DISPATCH ===` 並存，dispatch 為其中一 kind）：
```
=== ACTION ===
kind: plan | next_step | goal_done | need_input | dispatch | external_send | destructive | spend
risk: high | low
summary: <一句話預覽，卡片標題>
detail: <多行細節 / payload；dispatch 沿用既有 agentId/mode/task 子格式>
=== END ACTION ===
```

匯出函式：
- `parseActions(text: string): ParsedAction[]` —— 解析所有 ACTION 區塊；容錯（缺 risk 用 kind 推導、缺 summary 用 detail 首行、未知 kind → `need_input`）。
- `classifyRisk(kind): "high" | "low"` —— 四類動作 + `plan` 為 high；`next_step`/`goal_done` 為 low；`need_input` 為 low（但會 pause）。
- `HIGH_RISK_KINDS` 常數陣列。

`ParsedAction` 介面：`{ kind, risk, summary, detail, raw }`。dispatch kind 另解析出 `dispatchItems: DispatchItem[]`（重用 `dispatchParser` 既有邏輯，不重寫）。

設計原則：協議解析**只認 agent 最新一則 assistant 訊息**裡的 ACTION（與既有 `detectDispatch` 同精神，但移到 server），避免歷史訊息重複觸發。

## 4. 資料層

### `autonomy_runs` 表（`dbSchema.ts` BASE_SCHEMA + 冪等 migration）
```sql
CREATE TABLE IF NOT EXISTS autonomy_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,          -- planning|awaiting_plan_approval|running|paused_for_action|paused_for_input|paused|done|stopped|budget_exhausted|error（paused=重啟中斷待使用者決定）
  step_count INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,  -- started_at + maxWallMs
  ended_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `pending_actions` 表
```sql
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT,                   -- 自主 run 的動作；手動派工為 NULL
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  risk TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,                   -- 原始 detail / JSON payload
  status TEXT NOT NULL,          -- pending|approved|rejected|executed|failed|superseded
  result TEXT,                   -- 執行輸出摘要
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
```

### `server/src/store/autonomy.ts`（新）
CRUD：`createRun / getRun / updateRunStatus / incrementStep / listActiveRuns`；`createPendingAction / getPendingAction / listPending(sessionId) / decidePendingAction(id, status) / markExecuted`。比照既有 `store/workspaces.ts` 風格（rowTo* 映射、Pick 型別）。

## 5. 自主迴圈驅動器（`server/src/autonomyRunner.ts`）

狀態機，採**注入式依賴**（比照 `dispatchRunner` 的 `ExecuteDeps`），核心邏輯不需真的 spawn claude 即可單元測試：

```ts
interface AutonomyDeps {
  sendTurn: (sessionId: string, prompt: string) => Promise<string>; // 送一回合、回 agent final text
  runDispatch: (items: DispatchItem[], workspaceId: string) => Promise<string>; // 重用 dispatchRunner
  now: () => number;                 // 注入時鐘，便於測逾時
  emit: (runId: string, evt: AutonomyEvent) => void;
}
```

匯出：
- `startRun(sessionId, workspaceId, goal, opts?, deps?)`：建 run、進規劃、回 runId。
- `approvePlan(runId)` / `approveAction(actionId)` / `rejectAction(actionId)` / `provideInput(runId, text)` / `stopRun(runId)`：驅動狀態轉移。
- 內部 `advance(run)`：送下一步提示、解析回應、依 action kind 決定轉移與預算檢查。

預算檢查：`step_count >= max_steps || now() >= deadline_at` → `budget_exhausted`。

### 預算預設（常數，可由 startRun opts 覆寫）
- `DEFAULT_MAX_STEPS = 20`
- `DEFAULT_MAX_WALL_MS = 30 * 60 * 1000`（對齊 `EXECUTE_MAX_MS`）

## 6. REST 與 Socket

### `server/src/routes/autonomy.ts`（新，掛 `/api/autonomy`）
- `POST /runs` `{ sessionId, goal, maxSteps?, maxWallMs? }` → `{ runId }`（非 claude session → 400）
- `GET /runs/:id` → run 狀態 + 該 run 的 pending actions
- `GET /sessions/:sid/run` → 該 session 的 active run（無則 null）
- `POST /runs/:id/approve-plan`
- `POST /runs/:id/stop`
- `POST /runs/:id/resume`（`paused`→`running`，重啟中斷後續跑）
- `POST /runs/:id/input` `{ text }`
- `POST /actions/:id/approve`（可帶 `{ editedDetail }` 改寫）
- `POST /actions/:id/reject`
- `GET /sessions/:sid/pending` → 待批清單（含手動派工遷移後的項目）

### Socket 事件（重用 index.ts 既有 bus）
- `autonomy:run`（run 狀態變更）、`autonomy:pending`（新待批動作）、`autonomy:action`（動作執行結果）。

## 7. 手動派工遷移（最高風險一塊，謹慎處理）

現況：PM 輸出 `=== DISPATCH ===` → client `detectDispatch` 解析 → `DispatchApprovalCard` → POST `/api/orchestrator/:id/dispatch`。

遷移後：
- server 在 PM assistant 訊息產生時即解析 dispatch（用 §3 協議，dispatch kind）→ 寫 `pending_actions`(run_id=NULL) → socket `autonomy:pending`。
- 前端 `ActionApprovalCard` 渲染同一批准卡（UX 不變）→ 批准 → POST `/api/autonomy/actions/:id/approve` → server 執行既有 dispatch 邏輯（`runConsult`/`startExecute` 不動）。
- 移除 client 端 localStorage 指紋追蹤（`dispatchStorageKey` 等）；「已派工」狀態改由 server `pending_actions.status` 權威判定 → 重啟/重整正確。
- 保留 `dispatchParser`（server）與 `dispatchRunner`（執行）不動，只改「偵測/狀態追蹤」這層。
- 既有 `dispatchDetection.test.ts`、`app.test.ts` 的 dispatch 案例對應調整為走新佇列；新增遷移後等價行為測試，確保不回歸。

## 8. 前端

- `client/src/components/ActionApprovalCard.tsx`：由 `DispatchApprovalCard` 一般化，依 `kind` 渲染預覽（dispatch 顯示 agent/task 清單；其餘顯示 summary/detail）；批准/拒絕/改寫。
- `client/src/components/AutonomyPanel.tsx`：設目標輸入、啟動、顯示計畫、即時進度（step/budget、狀態徽章）、暫停/喊停、`need_input` 回覆框。
- `client/src/hooks/useAutonomy.ts`：訂閱三個 socket 事件 + REST；前端不持迴圈狀態。
- `client/src/lib/api.ts`：型別（`AutonomyRun`、`PendingAction`）+ 端點封裝。
- `ChatWindow` 整合：以最小變更接入（沿用既有 dispatch 卡掛載點）。

## 9. 系統提示（軟約束）

在 agent system prompt 注入一段「自主行動協議」說明（放於既有 prompt builder）：
- ACTION 標記格式與各 kind 用途。
- **強制規則**：四類高風險動作（對外發訊息／派工／不可逆破壞／花錢交易安裝）**不可直接執行**，必須以 `=== ACTION === risk: high` 申報，等核可後才做。
- 自主迴圈中每完成一步用 `next_step` 回報、達標用 `goal_done`、缺資訊用 `need_input`。
- 誠實註記：此為軟約束，硬攔僅 dispatch 與迴圈續行。

> 實作備註（2026-06-11）：經實作與最終審查，ACTION 協議改由 autonomyRunner 於**每個自主回合的 prompt 開頭 in-band 注入**（常數 PROTOCOL），而非寫入 agent system prompt。原因：reattach() 喚醒既有 session 不重建 system prompt，system-prompt 方案會在 resume 時漏掉協議；每回合 in-band 注入更可靠且等價。前端 MessageList 會過濾這些協議回合的顯示，避免污染對話。

## 10. 錯誤處理與重啟安全

- 壞格式 ACTION → 當 `need_input` + log，不崩。
- 預算用盡 → `budget_exhausted`，回報已完成步驟。
- session error / spawn 失敗 → run `error` + `last_error`。
- 動作被拒 → 指示 agent 改替代或結束（不直接殺 run）。
- **重啟**：開機掃 `listActiveRuns()`，凡 `running`/`paused_for_*` 一律轉 `paused`（§4 enum 已含此狀態，UI 顯示「已中斷」），提示使用者「續跑／停止」。**不自動續跑**有對外副作用的迴圈。`paused` 可由使用者經 approve-plan 之外的 resume 動作（沿用 `provideInput` 空字串或新增 `POST /runs/:id/resume`）轉回 `running`。

## 11. 測試

- `actionProtocol.test.ts`：解析多 case（正常、缺欄位、未知 kind、多區塊只認最新、dispatch 子格式）。
- `autonomyRunner.test.ts`：注入 deps 跑遍狀態轉移（規劃→批計畫→逐步→達標／高風險暫停／拒絕／need_input／預算用盡／停止／error），驗證時鐘逾時。
- `store.autonomy.test.ts`：CRUD + 狀態流。
- `routes/autonomy`（併入 `app.test.ts` 風格）：start/approve/reject/stop/非 claude 400。
- 派工遷移等價測試：確保新佇列行為 = 舊 UX，無重複跳卡。
- 前端：`ActionApprovalCard`（各 kind 渲染 + 批准/拒絕）、`AutonomyPanel`（啟動/進度/喊停）。

## 12. 實作順序（依賴）

1. actionProtocol（純函式）→ 2. DB 表 + store/autonomy → 3. autonomyRunner 狀態機（注入 deps，最重，用 Opus）→ 4. routes + socket 接線 → 5. 派工遷移（高風險，用 Opus）→ 6. 前端 ActionApprovalCard + AutonomyPanel + hook → 7. 系統提示注入 + 重啟安全 → 8. 最終 Opus 統一審查。
