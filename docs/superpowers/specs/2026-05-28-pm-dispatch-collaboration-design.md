# PM 派工協作（Consult & Delegate）— 設計規格

- 日期：2026-05-28
- 狀態：設計已批准，待規格審查
- 相關：沿用既有「標記攔截」模式（FORK / MEMO / workflow / LEARN）、`workflowRunner`、`agentManager`、batch/merge 端點、能力學習捕捉（`parseLearnMarkers`）、工作區專屬 Chrome（per-workspace CDP）

## 1. 目標

把專案經理（`agents-orchestrator`）從「只會用反引號推薦 agent-id、由前端列成『推薦團隊／一鍵全部開啟』」升級成**能徵得使用者同意後，真的去動用團隊**：

- **請教（consult）**：PM 同步問 N 位同事拿意見，整合成一段回覆，接在同一對話串。
- **外包執行（execute）**：PM 把一件真正的工作交給專職 agent，該 agent 用**所在工作區的工具（playwright + 專屬 Chrome / 其他 MCP）真的去做**（例：露天商品上架），背景執行、完成回報。
- **排成流程（workflow，C）**：判斷是重複性多步流程時，PM 主動提議生成一張可存可重跑的 workflow（沿用現成引擎）。

PM 依任務性質**自己判斷**用哪種；不確定時退回現有的「推薦 + 一鍵開」。

**設計北極星**：consult 與 execute 是「PM 把子任務外包給 N 個 agent、再把結果收回」這同一個原語的不同規模與同步性 —— `N=1 快問 = 諮詢`、`N=多位 + 整合 = 召集團隊`，不做兩套。

## 2. 範圍與非目標

**v1 範圍（本規格涵蓋全貌，實作分三切片）：**

1. **切片①** consult 同步全鏈路：marker → 批准卡 → 並行跑 → 收齊 → 餵回 PM 整合 → 顯示整合 + 每位原始回覆可展開。
2. **切片②** execute 非同步：背景開真 session 跑（吃工作區工具）→ PM 先回「已交辦」→ 完成時餵回 PM 貼回報 + socket 通知。
3. **切片③** C：PM 主動提 workflow + 確認一般 PM 對話也偵測 workflow 區塊。

**非目標（YAGNI，明確不做）：**

- B 方案（給 PM `consult_team` MCP 工具原生呼叫）——與「先問再跑」的批准閘衝突，留待未來想做「全自動不先問」時。
- 自動門檻（不先問就花錢）——v1 一律先問再跑。
- 對同一專家在單次派工內多輪深問（追問迴圈）——v1 每位同事單輪；要追問就下一個 turn 再 DISPATCH，或點開該真 session 自己接手。
- 跨工作區派工——子 agent 一律跑在 PM 對話所在的同一工作區。
- 派工數量上限——**刻意不設**；唯一閘門是「先問再跑」。

## 3. 核心設計決定（含理由）

| # | 決定 | 理由 |
|---|------|------|
| D1 | 用「標記攔截」而非 MCP 工具 | PM 只「寫計畫」不執行、前端跳批准卡、按鈕才執行——propose/execute 天然分離，完美吻合「先問再跑」；且是 codebase 最主流模式（FORK/MEMO/workflow/LEARN 都這樣），風險最低、重用最多。 |
| D2 | consult 同步、execute 非同步 | 請教幾秒可回、卡著等沒問題；外包執行可能數分鐘，卡住 PM 對話體驗差 → 背景跑 + 完成通知，像真主管交辦。 |
| D3 | 子任務一律開「真 session」 | (a) 可點開深聊／接手；(b) **自動經過現有學習捕捉**，真做事＝真累積手藝，呼應「讓 agent 學習才有意義」；(c) execute 完成回報所需的狀態本就掛在 session 上。 |
| D4 | 不設派工數量上限，只設並行數 | 該分給不同人的事可能 >5 位；先問再跑已是成本閘門，數字上限只會擋路。並行數（預設 3）純為避免同開太多 session 撞 rate limit／吃爆機器，**不限總數**，超出的排隊跑完。 |
| D5 | execute 子 agent 直接繼承工作區 MCP/Chrome 設定 | 「電商職員上架露天」＝他在綁了露天登入 Chrome 的工作區跑。`agentManager.start(agentId, …, workspaceId)` 既有邏輯已會帶入 `buildMCPConfigForWorkspace`，0 額外接線。 |
| D6 | consult 結果同時呈現「PM 整合」與「每位原始回覆」 | 可追溯：給結論也給過程，使用者明確要求。 |
| D7 | 餵回 PM 用既有 `agentManager.send()` | PM 是持久 claude child（`--resume`），把彙整訊息當 user message 送進去即可觸發整合，沿用既有 socket 串流，0 新管線。 |

## 4. 架構

### 4.1 Marker 協定（PM 輸出、使用者不需手打）

PM 在回覆中輸出下列區塊（前端攔截、不顯示原文，改跳批准卡）：

```
=== DISPATCH ===
- agentId: legal-contract-reviewer
  mode: consult
  task: 這份合作合約有哪些風險條款？
- agentId: ecommerce-operations-specialist
  mode: execute
  task: 把這 3 件商品上架到露天（用本工作區登入的後台），完成回報連結。
=== END DISPATCH ===
```

- `agentId`：必填，須存在於 agent 名冊（否則該項被濾掉並標示）。
- `mode`：`consult` | `execute`，預設 `consult`。
- `task`：必填，繁體中文，會作為該 agent 對話的第一句。
- 一次可混合 consult 與 execute 多項。PM 寫 1 條或 N 條 = 決定諮詢還是召集團隊（= 2+3 合一）。

### 4.2 新模組 `dispatchParser.ts`（純函式，server）

```ts
export interface DispatchItem { agentId: string; mode: "consult" | "execute"; task: string; }
export interface DispatchPlan { items: DispatchItem[]; }

// 從 assistant 訊息解析 DISPATCH 區塊；無則回 null。mode 缺省 consult。
export function parseDispatchMarker(text: string): DispatchPlan | null;

// 用已知 agentId 集合過濾無效項，回 { valid, dropped }。
export function validateDispatchPlan(
  plan: DispatchPlan, knownAgentIds: Set<string>,
): { valid: DispatchItem[]; dropped: DispatchItem[] };
```

### 4.3 新模組 `dispatchRunner.ts`（server）

職責：拿到「已批准」的計畫，實際跑子 agent、收結果、餵回 PM。

```ts
// 並行限流跑 consult 項，回每項的原始輸出（含逾時/錯誤標記）。
export async function runConsult(
  items: DispatchItem[], workspaceId: string, opts: { concurrency: number; perItemTimeoutMs: number },
): Promise<{ agentId: string; task: string; output: string; status: "ok" | "timeout" | "error" }[]>;

// 啟動 execute 項為背景真 session，註冊完成回呼把結果餵回 PM。立即返回（不等完成）。
export function startExecute(
  items: DispatchItem[], workspaceId: string, pmSessionId: string,
): { subSessionId: string; agentId: string }[];
```

- **並行限流**：簡單佇列（預設 `concurrency=3`，可由常數/env 調），總數不限。
- **consult 收集**：對每項 `agentManager.start(agentId, title, undefined, workspaceId, false)` → `send(task)` → 監聽 `result` 收 final assistant 文字（沿用 batch/merge 既有 spawn 收集寫法）；逾時（預設 120s）或錯誤 → 標記該項 status，**不拖垮整批**。
- **execute 回呼**：每項開背景 session 後，掛一次性 `result` 監聽 → 完成時 `agentManager.send(pmSessionId, 執行回報訊息)` 觸發 PM 貼回報，並 emit socket `dispatch:done` 供前端 toast。
- **execute 對應關係**：切片①不需要；切片②用一個 in-memory `Map<subSessionId, pmSessionId>`（server 重啟丟失 → 該限制記於 §6；如需重啟續接，後續再加 `dispatch_jobs` 表，比照 `learning_runs` 的 resume 機制）。

### 4.4 後端 API（擴充 `routes/sessions.ts`，或新 `routes/dispatch.ts`）

```
POST /api/orchestrator/:sessionId/dispatch
  body: { items: DispatchItem[] }            // 前端把批准卡的內容回傳
  行為:
    1. 驗證 sessionId 為 orchestrator 活躍 session；驗證/過濾 agentId
    2. 拆分 consult / execute
    3. consult: await runConsult(...) → 組「同事回覆彙整」訊息 → agentManager.send(pmSessionId, 彙整)
       （PM 隨即串流整合回覆，走既有 socket）
    4. execute: startExecute(...) → 送 PM 一則「已交辦，背景進行中」prompt → PM 回「已交辦…」
    5. res: { consulted: [{agentId, task, output, status}], executing: [{subSessionId, agentId}] }
       （consulted 原始輸出回前端供「可展開原始回覆」）
```

PM system prompt（`/orchestrator` 的 `extra`）新增：三模式說明 + 何時用哪個 + DISPATCH marker 格式 + 可改提 `workflow` 區塊（C）。維持 `enableAutoFork:false`。

### 4.5 前端

- **`ChatWindow.tsx`**：仿 `detectedMemo` / `recommendedAgents`，加 `detectedDispatch`（解析最後一則 assistant 的 DISPATCH 區塊）。
- **新元件 `DispatchApprovalCard.tsx`**：列每項（agent 顯示名 + consult/execute 徽章 + task），「派工 / 取消」。派工 → `api.dispatch(sessionId, items)`；送出後標記已派、隱藏卡片避免重複。
- **consult 結果呈現**：PM 整合回覆照常顯示；其下加可折疊「🔍 同事原始回覆（N 位）」區塊，逐項顯示 agent + status + 原文（資料來自 dispatch 回應）。
- **execute 通知**：socket `dispatch:done` → toast「<agent> 已完成交辦」；PM 的回報訊息照常落在對話。
- **`api.ts`**：加 `dispatch(sessionId, items)`。
- **C**：確認 `workflow` 區塊偵測在一般 PM（`agents-orchestrator`）對話也生效（目前由另開的「workflow 設計顧問」session 使用同 agentId，需驗證共用偵測；若否則補上）。

### 4.6 與既有系統的接點（皆 0 或極小改動）

- **工作區工具**：execute 子 session 經 `agentManager.start(…, workspaceId)` 自動帶 `buildMCPConfigForWorkspace`（含專屬 Chrome 的 `--cdp-endpoint`）。
- **學習捕捉**：所有子 session 經 `attachPersistence` → `parseLearnMarkers` → `createProposal`，真做事自動進學習審核佇列。
- **熔斷**：沿用 P0-4 stdout 上限與閒置淘汰。

## 5. 流程總覽

**consult（同步）**
```
PM 寫 DISPATCH(consult) → 前端跳批准卡 → 使用者按「派工」
  → POST dispatch → runConsult 並行(限3)跑 → 收齊(含逾時/錯)
  → 彙整訊息 send 回 PM → PM 串流整合回覆
  → 前端顯示「整合回覆 + 可展開每位原始回覆」
```

**execute（非同步）**
```
PM 寫 DISPATCH(execute) → 批准卡 → 「派工」
  → POST dispatch → startExecute 開背景真 session（吃工作區 Chrome/MCP）
  → PM 立即回「已交辦，完成會回報」
  → (背景) 子 session 跑完 → 結果 send 回 PM → PM 貼「執行回報」 + socket toast
  → 使用者可隨時點開該真 session 看進度/接手
```

## 6. 錯誤處理

- **無效 agentId**：前端過濾並標示；端點再驗一次，全無效則 400。
- **consult 逾時/錯誤**：該項標 `timeout`/`error`，彙整訊息註明「該同事未能回覆」，PM 照常整合其餘；不整批失敗。
- **execute 失敗**：完成回呼帶失敗訊息 → PM 回報「交辦失敗：…」。
- **PM session 不存在/已關**：404；前端提示重開 PM 對話。
- **輸出過大**：每子 session 沿用既有 stdout 上限熔斷。
- **execute 長任務**：總執行設上限（預設 30 分）逾時則停並回報，避免殭屍 session。
- **限制（v1）**：execute 的 `subSession→PM` 對應為 in-memory，server 重啟後背景任務仍會跑完並持久化，但「自動貼回報給 PM」會斷（使用者仍可點開子 session 看結果）。如要重啟續接，後續加 `dispatch_jobs` 表。

## 7. 測試計畫（TDD）

- **純函式（vitest）**：
  - `parseDispatchMarker`：單項/多項/缺 mode 預設 consult/無區塊回 null/格式雜訊容錯。
  - `validateDispatchPlan`：過濾未知 agentId、valid/dropped 分流。
  - 並行限流佇列：總數 > concurrency 時分批且全數完成、保序回傳。
- **整合測試**：`runConsult` 以假 agent（stub `agentManager`）驗證收集、逾時標記、部分失敗不整批垮。
- **前端**：`tsc -b` 零錯誤；批准卡 render 與「已派工後隱藏」狀態。
- 對齊既有 110/110 紀律，新增不得使現有測試轉紅。

## 8. 實作順序建議

1. **切片①（consult 同步）**：`dispatchParser.ts` + 測試 → `dispatchRunner.runConsult` + 並行限流 + 測試 → dispatch 端點（僅 consult）→ PM prompt（先只教 consult）→ `DispatchApprovalCard` + ChatWindow 偵測 + 原始回覆可展開 → 端到端驗證。**先打通這條最小完整鏈。**
2. **切片②（execute 非同步）**：`startExecute` + 完成回呼 + socket `dispatch:done` → 端點支援 execute → PM prompt 增 execute 判斷 → 前端 toast。
3. **切片③（C）**：PM prompt 增 workflow 提議 + 驗證/補上一般 PM 對話的 workflow 區塊偵測。

每切片獨立可驗、可 commit。

## 9. 未涵蓋 / 後續

- B（MCP 工具）、自動門檻不先問、單次派工內對同專家多輪追問、跨工作區派工。
- execute `dispatch_jobs` 持久化以支援 server 重啟續接回報。
- 派工歷史／成本統計面板（沿用 `usageTracker`）。
