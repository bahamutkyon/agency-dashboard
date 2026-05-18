# 自主學習系統 — 設計規格

- 日期:2026-05-18
- 狀態:設計待審
- 適用專案:agency-dashboard

## 1. 目標

讓 dashboard 的 agent 具備持續學習能力,並把學習成果反映在各自的能力上。具體包含四種學習產出:

1. **記住關於使用者的事實** — 你是誰、專案背景、品牌規則、過去決定
2. **精進工作手藝** — 從每次任務提煉「下次該怎麼做更好」
3. **吸收最新領域知識** — 主動跟進專業領域的最新動態
4. **從回饋校準** — 使用者的讚/改/否定,轉成 agent 的行為準則

## 2. 範圍與非目標

- **建在 dashboard 內,原生實作。不整合 Hermes Agent。**
  理由:Hermes 無法合法使用 Claude 訂閱額度(Anthropic 於 2026-04-04 切斷第三方 OAuth 客戶端的訂閱存取,第三方請求被導向空的 `extra_usage` 計費池)。原生實作保留 dashboard「零 API key、用使用者自己的 Claude 訂閱」的核心承諾,且所需基礎設施(`scheduler.ts`、記憶架構、WebSearch、marker 機制)dashboard 皆已具備。
- **非目標**:不改變使用者既有的「以專案經理為中心」的互動習慣;不引入 Python 依賴;不做跨使用者的學習共享。

## 3. 核心設計決定(含理由)

| 決定 | 內容 | 理由 |
|---|---|---|
| 學習生效方式 | 所有學習成果先進「審核佇列」,使用者批准才生效 | 學歪會逆向拖垮 agent;使用者選擇全審核 |
| 「對你的理解」歸屬 | 屬於**工作區的共享客戶檔案**,不歸任何單一 agent 私有 | 避免單點失效;不論使用者跟 PM 或專家聊,學習都流進同一份檔案;貼合 dashboard 現有「工作區備忘錄自動注入」機制 |
| 學習按性質分流 | `fact`/`calibration` → 鎖工作區;`craft`/`domain` → agent 全域、跨工作區 | 手藝與領域知識是 agent 的專業、不分專案;關於使用者的事實會因專案而異、不可串味。預設由性質自動推導,使用者可手動覆寫個別例外 |
| 觸發方式 | 手藝=事件驅動(零排程);領域=自適應間隔(零設定) | 使用者要求「自主、不用專門排程」 |

## 4. 架構

### 4.1 三個建構塊

**① 學習提案(Learning Proposal)** — 學習的最小單位:
- `kind`:`fact`(關於使用者)/ `craft`(手藝)/ `domain`(領域新知)/ `calibration`(回饋校準)
- `scope`:由 `kind` 自動推導 — `fact`+`calibration` → `workspace`;`craft`+`domain` → `agent-global`。使用者可手動覆寫。
- `content`、`source`(`conversation:<sessionId>` 或 `topic:<topicId>`)、`status`(`pending`/`approved`/`rejected`)

**② 兩個學習庫** — 批准的提案各自歸位:

| 學習庫 | 存什麼 | 實作 |
|---|---|---|
| 工作區客戶檔案 | 關於使用者的事實、回饋校準 | 沿用現有 `workspace.memory` 欄位,批准的提案附加寫入 |
| Agent 手藝記憶 | 手藝改進、領域新知(跨工作區全域) | 新增 `agent_craft_memory` 表,每 agent 一列 |

> 現有的 agent×workspace 記憶(`getAgentMemory`)與 `memoryDistiller` 維持不動,屬獨立既有功能。

**③ 學習審核佇列** — 新前端面板。所有提案在此等待使用者批准;批准 → 寫入對應學習庫;拒絕 → 標記 `rejected` 並保留,避免重複提案。

### 4.2 行為改動

現有的 `=== REMEMBER ===` 標記目前是**自動寫入**工作區備忘錄。本設計將其改為**產生提案**(`kind=fact`),不再自動生效,以符合「批准才生效」的決定。

## 5. 資料流

```
 ┌─ 來源 A:對話中 ─ agent 回應內嵌 LEARN 標記
 │
 ├─ 來源 B:手藝整合 ─ 被派工約 8 次 → 自動回顧 → LEARN 標記
 │
 └─ 來源 C:領域追蹤 ─ 自適應排程 → agent WebSearch → LEARN 標記
                              │
                              ▼
                    學習提案 (status=pending) ── 去重 / 衝突偵測
                              │
                   使用者在【學習審核佇列】
                       │           │
                    批准         拒絕(記下,不再提)
                       │
            ┌──────────┴──────────┐
   kind=fact/calibration    kind=craft/domain
            │                     │
      工作區客戶檔案          Agent 手藝記憶(全域)
            │                     │
            └──── 下次 agent 啟動時由 learningInjector 注入 ────┘
```

## 6. 觸發與節奏模型

### 6.1 手藝精進 — 事件驅動,零排程

- **持續擷取**:agent 每次回應任務時內嵌 `LEARN` 標記(屬 Phase 1)。
- **深度整合**:每位 agent 被派工累積約 8 次,自動觸發一次手藝整合 pass(回顧近期任務、提煉共通模式)。用量驅動,非時間驅動。

### 6.2 領域追蹤 — 自適應間隔,零設定

| 情況 | 系統行為 |
|---|---|
| 預設 | 每個追蹤主題每週自動查一次 |
| 連續 2–3 次無值得學的結果 | 間隔自動拉長至 2–4 週 |
| 某次查到大量更新 | 間隔自動縮短,3 天內再追一次 |
| 5 小時 quota 偏低 | 自動跳過本次追蹤 |

使用者唯一需做的:為常用 agent 開設追蹤主題(一次性)。何時查、多久查由系統自理。

## 7. 元件

### 7.1 後端新增(`server/src/`)

| 檔案 | 職責 |
|---|---|
| `learningStore.ts` | 提案 / 追蹤主題 / 手藝記憶的 DB 存取(擴 `db.ts`) |
| `learningCapture.ts` | 解析 `LEARN` 標記 → 產生提案;含去重與衝突偵測 |
| `learningInjector.ts` | 組「工作區檔案 + 手藝記憶」注入塊,於 `AgentManager.start()` 注入,位置鄰近 `skillPriming` |
| `craftConsolidator.ts` | 用量驅動的手藝整合 pass |
| `topicTracker.ts` | 自適應間隔的領域追蹤,掛 `scheduler.ts` |

### 7.2 後端改動

- `agentManager.ts`:`LEARN`/`REMEMBER` 標記改走提案;`start()` 注入學習塊
- `db.ts`:新增 3 張表
- `index.ts`:新增 API 路由(列出/批准/拒絕提案、CRUD 追蹤主題)

### 7.3 前端新增(`client/src/components/`)

- `LearningQueuePanel.tsx`:審核佇列;批准/拒絕;衝突並列標示
- `TrackedTopicsPanel.tsx`:逐 agent 管理追蹤主題
- sidebar 待審數量徽章

### 7.4 資料表

- `learning_proposals`:`id`, `agentId`, `workspaceId`, `kind`, `scope`, `content`, `source`, `status`, `createdAt`, `decidedAt`
- `agent_craft_memory`:`agentId`(主鍵), `content`, `updatedAt`
- `tracked_topics`:`id`, `agentId`, `topic`, `intervalDays`, `lastRunAt`, `lastSummary`, `consecutiveEmptyRuns`, `createdAt`
- 工作區客戶檔案:沿用現有 `workspace.memory` 欄位

### 7.5 LEARN 標記格式

```
=== LEARN kind=craft ===
下次做小紅書標題,前 8 個字要放數字或衝突感
=== END LEARN ===
```

`kind` 取 `fact`/`craft`/`domain`/`calibration`。`scope` 由 `kind` 推導,不需在標記中指定。每次回應的標記數量設上限以防洗版。

## 8. 錯誤處理與邊界情況

- **追蹤撲空**:WebSearch 無結果 → 記一次空跑、`consecutiveEmptyRuns++`、不產生提案
- **quota 護欄**:5 小時額度偏低 → 自動跳過追蹤 job
- **提案去重**:新提案與該 agent 的 pending/approved/rejected 做相似度比對,近似者不重複產生
- **衝突偵測**:提案與現有檔案某條矛盾 → 審核 UI 並列兩條標示,由使用者裁決
- **手藝記憶上限**:每 agent 手藝記憶設字數上限,超過 → 由整合 pass 合併精簡,或標出低價值條目供使用者清理
- **自主 job 失敗**:追蹤/整合 job 為 best-effort,失敗則記錄並於下個週期重試
- **拒絕保留**:被拒提案保留為 `rejected`,避免 agent 或追蹤器重複提出相同內容

## 9. 測試

- **單元**:`LEARN` 標記解析(kind 解析、畸形標記容錯)、scope 自動推導、提案去重相似度
- **整合**:對話含 `LEARN` → 佇列出現提案 → 批准 → 下次 `start()` 注入塊含該條;拒絕 → 不注入且不再被提出
- **自主**:mock 追蹤主題執行 `topicTracker` → 產生提案;mock 空 WebSearch → 無提案且 `consecutiveEmptyRuns` 遞增、達閾值後 `intervalDays` 自動拉長;mock 低 quota → 追蹤被跳過

## 10. 分階段交付

- **Phase 1 — 學習引擎**:學習提案 + 審核佇列 + 從對話擷取(`LEARN` 標記)+ 回灌注入。不含排程。交付後即有「會學習、使用者說了算」的 agent。
- **Phase 2 — 自主追蹤**:追蹤主題 + `craftConsolidator` + `topicTracker`(自適應排程)。建於 Phase 1 之上。

每階段各為完整可用的功能,可獨立交付。

## 11. 未來可選項(本次不做)

- **低風險自動批准**:允許將 `fact` 等低風險 kind 設為自動批准,僅 `craft`/`domain` 進審核佇列。本次依使用者決定採全審核;此為日後可加的省力選項。
