# 自主進修（Autonomous Capability Refresh）設計規格

- 日期：2026-06-10
- 狀態：設計已確認，待寫實作計畫
- 範圍：agency-dashboard（server + client + DB）

## 1. 目標與背景

### 問題
現有「能力學習」（`capabilityLearning.ts`）是**閉門反思**：叫 `claude -p` 從 agent 的**靜態人設**回想通用手藝，**沒有網路、不知道「最新」**。因此：
- 生不出「2026 最新 AEO/GEO 做法」「最新反 AI 味文案技巧」這類**與時俱進**的真本事。
- 重跑只會產出被去重擋掉的重複內容，邊際效益低。
- 使用者也**看不到某支 agent 目前能力到哪、缺什麼**。

### 目標
讓使用者**會用到的 agent 定期自主上網研究自己領域的最新最佳實踐**，對照現有手藝找出過時/缺口，把最新真本事**轉成提案**經人工批准後寫進**全域手藝**（跨所有工作區生效），並讓使用者能**看見每支 agent 的能力現況**。

### 成功標準
- 對指定 agent 觸發「進修」後，能透過 WebSearch 取得當前年度的領域知識，產出帶具體判準/來源的 craft 提案（走現有審核流程），且明顯不同於閉門反思的通用條目。
- 熱門 agent 每週、冷門每月自動進修；休眠（久未使用）的不自動跑。
- 每次進修產出一份可查的「能力現況報告」（現有/最新/缺口 + 來源連結）。
- 有成本上限與可見的預估，不會無限燒訂閱額度。

## 2. 非目標（YAGNI）
- **不做自動批准**：研究來自網路可能有誤，一律走人工審核（沿用現有 UI）。
- **不做 per-workspace 研究**：產出一律 agent-global craft（跨工作區），不綁特定客戶情境。
- **不做多來源交叉驗證/形式化查核**：單次研究 + 人工把關即可。
- **不研究休眠 agent**：90 天未使用且無覆寫者，不納入自動排程（成本界線）。
- **不改動**現有提案表、審核 UI、手藝注入、scheduler 狀態機——全部重用。

## 3. 名詞
- **熱層 / 冷層 / 休眠**：依使用度分層（見 §5.1）。
- **進修（research run）**：對單一 agent 跑一次「WebSearch + 對照現有手藝 + 蒸餾最新」的學習。
- **能力現況報告**：每次進修的副產品，描述該 agent 目前能力/業界最新/缺口。

## 4. 整體架構與資料流

```
sessions 使用量 + agent_study_prefs 覆寫
        │
        ▼
   使用度分層（studyTiering）──► 熱/冷/休眠名單
        │                              ▲
        │（排程每週/每月 fire，或手動「立即進修」）
        ▼                              │ 動態算出目標，依 last_researched_at 升序、取 per_run_cap 支
   研究型學習器（runResearchTarget）
   = claude -p --allowedTools WebSearch WebFetch
     + 餵入該 agent 現有 craft + 人設 + 類記憶
        │
        ├──► craft 提案（source=capability-research:agent）──► 現有審核 UI ──批准──► agent_craft_memory ──► 注入所有工作區 session
        └──► 能力現況報告 ──► agent_capability_reports ──► 前端可查
```

沿用現有 `executeLearningRun` 狀態機（含 DB 持久化、斷點續跑、進度 socket 推送）；研究只是換一個 worker（`runResearchTarget` 取代 `runLearningTarget`）。

## 5. 元件設計

### 5.1 使用度分層（新模組 `studyTiering.ts`）
從 `sessions` 表計算每支 agent 的使用量（以 `agent_id` 計數，`updated_at` 落在時間窗內）。

分層規則（優先序：覆寫 > 自動）：
- `tier_override='exclude'` → **永不自動**（僅手動可跑）
- `tier_override='hot'` → 熱層；`tier_override='cold'` → 冷層
- 自動：
  - 🔥 **熱層**：近 30 天 session 數 ≥ `HOT_THRESHOLD`（預設 3）
  - 🌡️ **冷層**：近 90 天用過、但未達熱層
  - 💤 **休眠**：近 90 天 0 session 且無覆寫 → 不自動

> 註：使用量以 `agent_id` 計數全部 session（含被派工的 🤝/🛠️ 子 session，因為那也代表該 agent 有在做事）。日後若要排除可再加 title 前綴過濾。

主要函式：
- `computeTiers(): { hot: AgentUsage[]; cold: AgentUsage[]; dormant: AgentUsage[] }`
  - `AgentUsage = { agentId, name, sessions30d, sessions90d, lastResearchedAt: number|null, override: string|null }`
- `tierForAgent(agentId): 'hot'|'cold'|'dormant'|'excluded'`

### 5.2 研究型學習器（擴充 `capabilityLearning.ts`）
新函式 `runResearchTarget(agentId): Promise<{ created: number; reportId: string|null }>`：
1. `loadAgents()` 找 agent、`readAgentDefinition()` 取人設正文、`getCraftMemoryFor()` 取**現有手藝**、`getCategoryMemory()` 取類記憶。
2. `buildAgentResearchPrompt(name, desc, body, existingCraft, categoryMemory)`（見 §5.2.1）。
3. `spawnClaude(["-p","--output-format","json","--model",LEARNING_MODEL,"--allowedTools","WebSearch","WebFetch","--no-session-persistence","--disable-slash-commands"])`，**加逾時 kill（預設 600s）**（web 多輪會久）。
4. 解析：
   - craft：`parseLearnMarkers(text, 6, 500)` → `createProposal({kind:'craft', scope:'agent-global', source:'capability-research:agent'})`（沿用去重）。
   - 報告：擷取 `=== REPORT ===...=== END REPORT ===` 區塊 + 來源 URL → 寫入 `agent_capability_reports`。
5. 回傳建立提案數 + reportId。失敗（無 LEARN 也無 REPORT）→ throw（沿用現有 fail 累積）。

#### 5.2.1 研究 prompt（`capabilityPrompts.ts` 新增 `buildAgentResearchPrompt`）
重點要素：
- 角色 = 該 agent；給它**現有手藝**與人設。
- 指令：用 WebSearch 查「你領域**當前年度**最新的最佳實踐、工具、平台規則、趨勢」；對照你現有手藝與人設，找出 ①**過時/需更新** ②**缺的新能力**；只收**具體可操作**（帶數字門檻/判準/決策樹）、**有來源依據**的，**避免通用空話與已有的重複**。
- 反 AI slop：明確要求「若是文案/內容類能力，須包含『如何降低 AI 味』的具體手法」。
- 輸出格式：
  - 3-6 個 `=== LEARN kind=craft ===` 區塊（每條 ≤500 字）。
  - 一個 `=== REPORT ===` 區塊：分「目前已具備 / 業界最新 / 你的缺口」三段，結尾列來源 URL。
  - 不要前言、編號、額外解釋。

### 5.3 能力現況報告（儲存 + 檢視）
- 新表 `agent_capability_reports`（§6）。每次進修寫一筆；前端取**最新一筆**顯示。
- `studyStore.ts`：`saveCapabilityReport()`, `getLatestReport(agentId)`, `lastResearchedAt(agentId)`（= 最新報告 created_at）。

### 5.4 自主排程（新模組 `studyScheduler.ts`，模式對齊 `learningScheduler.ts`）
- 讀 `agent_study_schedules`（§6，種子兩列：hot/cold）。對 enabled 且 cron 合法者註冊 cron（timezone `Asia/Taipei`）。
- fire(tier)：
  1. `computeTiers()` 取該 tier 名單（排除 excluded）。
  2. 依 `lastResearchedAt` 升序（最久沒進修的先）排序，取前 `per_run_cap` 支（預設 10）→ 形成 `LearnTarget[]`（type 一律 'agent'）。
  3. `createLearningRun(targets)` + `executeLearningRun(run, runResearchTarget, sink)`（沿用狀態機/持久化/socket）。
  4. 更新該 tier 的 `last_run_at`。
- 預設 cron：熱層 `0 4 * * 1`（每週一 04:00）、冷層 `0 4 1 * *`（每月 1 號 04:00）。
- `index.ts` 啟動時 `studyScheduler.init(sink)`。

### 5.5 前端「自主進修」區（`CapabilityLearningPanel.tsx` 新增分頁/區塊）
- **三欄名單**：🔥熱 / 🌡️冷 / 💤休眠，每支顯示：名稱、近30天使用次數、上次進修日期。
- **每支操作**：釘選為熱（override='hot'）/ 降為冷 / 排除（exclude）/ 清除覆寫；「立即進修」鈕。
- **排程開關**：熱層週/冷層月 各一個 enable toggle + 顯示 cron 與每次上限。
- **能力現況報告**：點 agent 展開最新報告（現有/最新/缺口 + 來源連結）。
- **成本預估**：依目前熱層支數 × 單支估價，顯示「每週約 NT$X」。
- 進修產出的 craft 提案，沿用既有 pending 提案列表審核（同面板）。

### 5.6 成本控制
- 每次 run 上限 `per_run_cap`（預設 10 支），超過排隊下次。
- 休眠 agent 不自動跑（最大成本界線）。
- 單支研究估 ≈ NT$15-60（Opus + web 多輪）；面板顯示預估。
- `runClaudeOnce` 既有 5MB 輸出熔斷保留 + 新增 600s 逾時 kill。

## 6. 資料模型（新增於 `dbSchema.ts` BASE_SCHEMA，`CREATE TABLE IF NOT EXISTS` 對舊 DB 自動補建）

```sql
-- 每支 agent 的分層覆寫（無列 = 純自動）
CREATE TABLE IF NOT EXISTS agent_study_prefs (
  agent_id      TEXT PRIMARY KEY,
  tier_override TEXT,                 -- 'hot' | 'cold' | 'exclude' | NULL
  updated_at    INTEGER NOT NULL
);

-- 能力現況報告（每次進修一筆，取最新顯示）
CREATE TABLE IF NOT EXISTS agent_capability_reports (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  report     TEXT NOT NULL,           -- markdown：目前/最新/缺口三段
  sources    TEXT NOT NULL DEFAULT '[]', -- JSON 來源 URL 陣列
  run_id     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acr_agent ON agent_capability_reports(agent_id, created_at DESC);

-- 分層排程設定（種子 hot/cold 兩列）
CREATE TABLE IF NOT EXISTS agent_study_schedules (
  tier        TEXT PRIMARY KEY,       -- 'hot' | 'cold'
  cron        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,  -- 預設關閉，使用者自行開啟
  per_run_cap INTEGER NOT NULL DEFAULT 10,
  last_run_at INTEGER
);
```

種子（idempotent，`INSERT OR IGNORE`）：
- `('hot','0 4 * * 1',0,10,NULL)`、`('cold','0 4 1 * *',0,10,NULL)`。**預設關閉**，使用者在面板開啟才會自動跑。

> 提案沿用 `learning_proposals`，僅 source 用新值 `capability-research:agent`。

## 7. API 端點（`routes/learning.ts` 新增）
- `GET  /api/learning/study/tiers` → `{ hot:[AgentUsage], cold:[...], dormant:[...] }`
- `POST /api/learning/study/override` `{ agentId, override: 'hot'|'cold'|'exclude'|null }` → 寫 `agent_study_prefs`
- `POST /api/learning/study/run` `{ agentId }` → 對單支立即進修（createLearningRun([{type:'agent',id}]) + runResearchTarget，背景跑、socket 推進度），回 `{ runId }`
- `GET  /api/learning/study/report/:agentId` → 最新能力現況報告
- `GET  /api/learning/study/schedules` → 兩列 tier 排程
- `PATCH /api/learning/study/schedules/:tier` `{ enabled?, cron?, perRunCap? }` → 更新並 `studyScheduler.sync()`

**既有 `deriveDefaultScope`（routes/learning.ts）需更新**：把 `source.startsWith('capability-research:')` 也視為預設 global（與 `capability-learning:` 同），確保研究產出的 craft 批准後落 agent-global。

## 8. 設定/預設值
| 項目 | 預設 | 可調 |
|---|---|---|
| HOT_THRESHOLD（近30天 session 數） | 3 | 常數，日後可設定化 |
| 冷層使用窗 | 90 天 | 同上 |
| 熱層 cron | 每週一 04:00 | 面板 |
| 冷層 cron | 每月 1 號 04:00 | 面板 |
| per_run_cap | 10 | 面板 |
| 研究逾時 | 600s/支 | 常數 |
| 研究模型 | LEARNING_MODEL（Opus） | 常數 |
| 排程預設狀態 | 關閉 | 面板開啟 |

## 9. 錯誤處理與邊界
- 單支研究失敗（claude 非 0、逾時、無 LEARN 也無 REPORT）→ 記入 run.failed，不中斷其他支（沿用 executeLearningRun）。
- WebSearch 無結果 → 仍可能產出（依現有手藝反思），但若完全空 → 算失敗。
- 去重：研究 craft 經 `createProposal` 對該 agent 最近 100 條（≥0.7）去重，重複不建立。
- 分層計算空集合（無熱/冷）→ 排程 fire 直接結束、不建 run。
- server 重啟：未完成 research run 沿用 `resumeUnfinishedRuns` 斷點續跑（worker 需能對應 research；index.ts resume 時依 run 來源選 worker —— **設計註**：run 需可分辨是 learning 或 research。做法：`learning_runs` 既有 `targets`，研究 run 的 target 仍是 `{type:'agent'}`，無法分辨 → **新增 run 的 source 欄位或以 schedule tier 標記**；最簡：研究一律走 `runResearchTarget`，而批次能力學習走 `runLearningTarget`——兩者 resume 需分流。**決議**：`learning_runs` 加一欄 `run_kind TEXT DEFAULT 'learning'`（'learning'|'research'），resume 時依此選 worker。

## 10. 測試計畫（server vitest，沿用 singleFork）
- `studyTiering.test.ts`：給定 session 列 + 覆寫，驗證 hot/cold/dormant/excluded 分層與門檻邊界。
- `capabilityPrompts.test.ts`：新增 `buildAgentResearchPrompt` 純函式測試（含現有手藝/類記憶有無的分支、反 AI slop 指令存在）。
- 報告擷取 parser 單元測試（`=== REPORT ===` 解析 + 來源 URL 抽取 + 無報告情形）。
- `runResearchTarget`：注入假 worker/假 claude 輸出（含 LEARN + REPORT）→ 驗證建提案數 + 寫報告；驗證去重。
- `studyScheduler` fire：注入假 computeTiers + 假 worker，驗證依 lastResearchedAt 排序、取 cap、建 run。
- `deriveDefaultScope`：`capability-research:agent` → global。
- run_kind resume 分流：研究 run resume 走 research worker。
- HTTP 端點測試（沿用 app.test.ts 模式）：tiers / override / run / report / schedules。

## 11. 檔案異動清單
**Server（新增）**：`studyTiering.ts`、`studyStore.ts`、`studyScheduler.ts`、對應 `.test.ts`。
**Server（修改）**：`dbSchema.ts`（3 表 + 種子 + `learning_runs.run_kind` 欄 migration）、`capabilityPrompts.ts`（research prompt）、`capabilityLearning.ts`（`runResearchTarget` + 報告解析 + WebSearch spawn + 逾時 + run_kind）、`routes/learning.ts`（6 端點 + deriveDefaultScope）、`index.ts`（studyScheduler.init + resume 分流）。
**Client（修改）**：`lib/api.ts`（新方法）、`components/CapabilityLearningPanel.tsx`（自主進修區）或新增 `AutonomousStudyPanel.tsx`（lazy）。

## 12. 開放假設
- 假設使用者 claude CLI 支援 `--allowedTools WebSearch WebFetch`（**已於 2026-06-10 實測通過**：haiku 3 turns、$0.18、回 2026 GEO/AEO 最新 + 來源）。
- 假設 Opus + web 單支成本落在 NT$15-60；正式上線後以實際 run 校準面板預估值。
- 報告與 craft 的品質仍依賴人工審核把關；本功能不保證研究內容 100% 正確。
