# 自主進修（Autonomous Capability Refresh）實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓常用 agent 定期自主用 WebSearch 研究領域最新最佳實踐，蒸餾成 craft 提案（經審核落 agent-global）並產出能力現況報告；使用度分層（熱週/冷月/休眠不跑）+ 成本上限。

**架構：** 沿用既有 `executeLearningRun` 狀態機與 `learning_proposals` 審核流程；新增「研究型 worker」（開 WebSearch + 餵現有手藝）、使用度分層模組、分層排程器、3 張新表與前端面板。

**技術棧：** Node + TypeScript、Express、node:sqlite、vitest（server，singleFork）、React + vitest/RTL（client）、claude CLI（`-p --allowedTools WebSearch WebFetch`）。

**規格：** `docs/superpowers/specs/2026-06-10-autonomous-capability-refresh-design.md`

---

## 檔案結構

**Server 新增：**
- `server/src/studyStore.ts` — 分層覆寫、能力報告、分層排程的 DB 存取
- `server/src/studyTiering.ts` — 使用度分層計算
- `server/src/studyScheduler.ts` — 熱/冷分層 cron 排程器
- 對應 `*.test.ts`

**Server 修改：**
- `server/src/dbSchema.ts` — 3 張新表 + 種子 + `learning_runs.run_kind` 欄
- `server/src/capabilityPrompts.ts` — `buildAgentResearchPrompt`
- `server/src/capabilityLearning.ts` — `runResearchTarget`、報告解析、WebSearch spawn、逾時、`createLearningRun` 加 `runKind`、resume 分流
- `server/src/routes/learning.ts` — 6 個 `/study/*` 端點 + `deriveDefaultScope` 認 `capability-research:`
- `server/src/index.ts` — `studyScheduler.init` + resume worker 分流

**Client 修改：**
- `client/src/lib/api.ts` — study 相關方法
- `client/src/components/AutonomousStudyPanel.tsx`（新增，lazy）+ 掛進既有面板入口

---

### 任務 1：DB schema（3 表 + run_kind 欄 + 種子）

**檔案：**
- 修改：`server/src/dbSchema.ts`
- 測試：`server/src/dbSchema.test.ts`（既有，追加）

- [ ] **步驟 1：寫失敗測試**

於 `dbSchema.test.ts` 追加（沿用既有 in-memory db 建立模式，參考檔案頂部既有 helper）：

```typescript
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { setupSchema } from "./dbSchema.js";

function freshDb() { const db = new DatabaseSync(":memory:"); setupSchema(db); return db; }

describe("autonomous-study schema", () => {
  it("建立 agent_study_prefs / agent_capability_reports / agent_study_schedules", () => {
    const db = freshDb();
    for (const t of ["agent_study_prefs", "agent_capability_reports", "agent_study_schedules"]) {
      const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
      expect(r, `表 ${t} 應存在`).toBeTruthy();
    }
  });
  it("learning_runs 有 run_kind 欄，預設 learning", () => {
    const db = freshDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('learning_runs')").all().map((c: any) => c.name);
    expect(cols).toContain("run_kind");
  });
  it("種子 hot/cold 兩列排程，預設關閉", () => {
    const db = freshDb();
    const rows = db.prepare("SELECT tier, enabled FROM agent_study_schedules ORDER BY tier").all() as any[];
    expect(rows.map((r) => r.tier)).toEqual(["cold", "hot"]);
    expect(rows.every((r) => r.enabled === 0)).toBe(true);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/dbSchema.test.ts`
預期：FAIL（表不存在 / run_kind 不存在）。

- [ ] **步驟 3：實作 schema**

在 `dbSchema.ts` 的 `BASE_SCHEMA` 字串末端（`learning_runs` 之後、結尾反引號之前）加入：

```sql
CREATE TABLE IF NOT EXISTS agent_study_prefs (
  agent_id      TEXT PRIMARY KEY,
  tier_override TEXT,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_capability_reports (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  report     TEXT NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  run_id     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acr_agent ON agent_capability_reports(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_study_schedules (
  tier        TEXT PRIMARY KEY,
  cron        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  per_run_cap INTEGER NOT NULL DEFAULT 10,
  last_run_at INTEGER
);
```

在 `learning_runs` 的 `CREATE TABLE` 內補一欄（放在 schedule_id 後）：
```sql
  run_kind TEXT NOT NULL DEFAULT 'learning',
```

在 `applyBaseSchema`（或 `setupSchema` 尾端）加入種子（idempotent）：
```typescript
db.exec(`
  INSERT OR IGNORE INTO agent_study_schedules (tier, cron, enabled, per_run_cap)
  VALUES ('hot','0 4 * * 1',0,10), ('cold','0 4 1 * *',0,10);
`);
```

在 `applyMigrations` 加入 `learning_runs.run_kind` 的 idempotent 遷移（給舊 DB）：
```typescript
if (tableExists(db, "learning_runs") && !hasColumn(db, "learning_runs", "run_kind")) {
  db.exec("ALTER TABLE learning_runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'learning'");
}
```

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/dbSchema.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/dbSchema.ts server/src/dbSchema.test.ts
git commit -m "feat(study): 自主進修 3 張新表 + learning_runs.run_kind"
```

---

### 任務 2：studyStore.ts（DB 存取層）

**檔案：**
- 創建：`server/src/studyStore.ts`
- 測試：`server/src/studyStore.test.ts`

- [ ] **步驟 1：寫失敗測試**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import {
  setTierOverride, getTierOverride, listOverrides,
  saveCapabilityReport, getLatestReport, lastResearchedAt,
  listStudySchedules, updateStudySchedule, touchStudyScheduleRun,
} from "./studyStore.js";

beforeEach(() => {
  db.exec("DELETE FROM agent_study_prefs; DELETE FROM agent_capability_reports;");
});

describe("studyStore", () => {
  it("覆寫讀寫 + 清除", () => {
    setTierOverride("a1", "hot");
    expect(getTierOverride("a1")).toBe("hot");
    setTierOverride("a1", null);
    expect(getTierOverride("a1")).toBeNull();
  });
  it("能力報告寫入後可取最新 + lastResearchedAt", () => {
    const id = saveCapabilityReport({ agentId: "a1", report: "現況", sources: ["http://x"], runId: "r1" });
    expect(id).toBeTruthy();
    const latest = getLatestReport("a1");
    expect(latest?.report).toBe("現況");
    expect(latest?.sources).toEqual(["http://x"]);
    expect(lastResearchedAt("a1")).toBeGreaterThan(0);
    expect(lastResearchedAt("never")).toBeNull();
  });
  it("分層排程種子可讀、可更新 enabled/cron/cap", () => {
    const before = listStudySchedules();
    expect(before.find((s) => s.tier === "hot")).toBeTruthy();
    updateStudySchedule("hot", { enabled: true, perRunCap: 5 });
    const hot = listStudySchedules().find((s) => s.tier === "hot")!;
    expect(hot.enabled).toBe(true);
    expect(hot.perRunCap).toBe(5);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/studyStore.test.ts`
預期：FAIL（模組不存在）。

- [ ] **步驟 3：實作 studyStore.ts**

```typescript
import { db } from "./db.js";

export type TierOverride = "hot" | "cold" | "exclude";

export function setTierOverride(agentId: string, override: TierOverride | null): void {
  if (override === null) {
    db.prepare("DELETE FROM agent_study_prefs WHERE agent_id = ?").run(agentId);
    return;
  }
  db.prepare(`
    INSERT INTO agent_study_prefs (agent_id, tier_override, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET tier_override = excluded.tier_override, updated_at = excluded.updated_at
  `).run(agentId, override, Date.now());
}

export function getTierOverride(agentId: string): TierOverride | null {
  const r = db.prepare("SELECT tier_override FROM agent_study_prefs WHERE agent_id = ?").get(agentId) as any;
  return r?.tier_override ?? null;
}

export function listOverrides(): Record<string, TierOverride> {
  const rows = db.prepare("SELECT agent_id, tier_override FROM agent_study_prefs").all() as any[];
  const out: Record<string, TierOverride> = {};
  for (const r of rows) out[r.agent_id] = r.tier_override;
  return out;
}

export interface CapabilityReport { id: string; agentId: string; report: string; sources: string[]; runId: string | null; createdAt: number; }

export function saveCapabilityReport(input: { agentId: string; report: string; sources: string[]; runId?: string | null }): string {
  const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO agent_capability_reports (id, agent_id, report, sources, run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.agentId, input.report, JSON.stringify(input.sources || []), input.runId ?? null, Date.now());
  return id;
}

export function getLatestReport(agentId: string): CapabilityReport | null {
  const r = db.prepare("SELECT * FROM agent_capability_reports WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1").get(agentId) as any;
  if (!r) return null;
  return { id: r.id, agentId: r.agent_id, report: r.report, sources: JSON.parse(r.sources || "[]"), runId: r.run_id ?? null, createdAt: r.created_at };
}

export function lastResearchedAt(agentId: string): number | null {
  const r = db.prepare("SELECT MAX(created_at) AS t FROM agent_capability_reports WHERE agent_id = ?").get(agentId) as any;
  return r?.t ?? null;
}

export interface StudySchedule { tier: "hot" | "cold"; cron: string; enabled: boolean; perRunCap: number; lastRunAt: number | null; }

export function listStudySchedules(): StudySchedule[] {
  const rows = db.prepare("SELECT * FROM agent_study_schedules ORDER BY tier").all() as any[];
  return rows.map((r) => ({ tier: r.tier, cron: r.cron, enabled: !!r.enabled, perRunCap: r.per_run_cap, lastRunAt: r.last_run_at ?? null }));
}

export function updateStudySchedule(tier: "hot" | "cold", patch: { enabled?: boolean; cron?: string; perRunCap?: number }): void {
  const cur = db.prepare("SELECT * FROM agent_study_schedules WHERE tier = ?").get(tier) as any;
  if (!cur) return;
  db.prepare("UPDATE agent_study_schedules SET cron = ?, enabled = ?, per_run_cap = ? WHERE tier = ?").run(
    patch.cron ?? cur.cron,
    (patch.enabled ?? !!cur.enabled) ? 1 : 0,
    patch.perRunCap ?? cur.per_run_cap,
    tier,
  );
}

export function touchStudyScheduleRun(tier: "hot" | "cold"): void {
  db.prepare("UPDATE agent_study_schedules SET last_run_at = ? WHERE tier = ?").run(Date.now(), tier);
}
```

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/studyStore.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/studyStore.ts server/src/studyStore.test.ts
git commit -m "feat(study): studyStore — 覆寫/能力報告/分層排程 DB 存取"
```

---

### 任務 3：studyTiering.ts（使用度分層）

**檔案：**
- 創建：`server/src/studyTiering.ts`
- 測試：`server/src/studyTiering.test.ts`

- [ ] **步驟 1：寫失敗測試**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import { setTierOverride } from "./studyStore.js";
import { computeTiers, HOT_THRESHOLD } from "./studyTiering.js";

function addSessions(agentId: string, n: number, ageDays: number) {
  const ts = Date.now() - ageDays * 86400_000;
  for (let i = 0; i < n; i++) {
    db.prepare("INSERT INTO sessions (id, workspace_id, agent_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run(`s_${agentId}_${ageDays}_${i}_${Math.random().toString(36).slice(2)}`, "ws_default", agentId, "t", ts, ts);
  }
}

beforeEach(() => {
  db.exec("DELETE FROM sessions; DELETE FROM agent_study_prefs;");
});

describe("computeTiers", () => {
  it("近30天 >= 門檻 → 熱", () => {
    addSessions("hotty", HOT_THRESHOLD, 5);
    const t = computeTiers();
    expect(t.hot.map((a) => a.agentId)).toContain("hotty");
  });
  it("近90天用過但未達門檻 → 冷", () => {
    addSessions("warm", 1, 40);
    const t = computeTiers();
    expect(t.cold.map((a) => a.agentId)).toContain("warm");
  });
  it("90天沒用 → 休眠", () => {
    addSessions("old", 5, 200);
    const t = computeTiers();
    expect(t.dormant.map((a) => a.agentId)).toContain("old");
  });
  it("override=hot 強制熱、exclude 不進任何自動層", () => {
    addSessions("x", 1, 200); setTierOverride("x", "hot");
    addSessions("y", HOT_THRESHOLD, 1); setTierOverride("y", "exclude");
    const t = computeTiers();
    expect(t.hot.map((a) => a.agentId)).toContain("x");
    expect([...t.hot, ...t.cold, ...t.dormant].map((a) => a.agentId)).not.toContain("y");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/studyTiering.test.ts`
預期：FAIL（模組不存在）。

- [ ] **步驟 3：實作 studyTiering.ts**

```typescript
import { db } from "./db.js";
import { loadAgents } from "./agentLoader.js";
import { listOverrides, lastResearchedAt } from "./studyStore.js";

export const HOT_THRESHOLD = 3;     // 近 30 天 session 數 >= 此值 → 熱
const HOT_WINDOW_MS = 30 * 86400_000;
const COLD_WINDOW_MS = 90 * 86400_000;

export interface AgentUsage {
  agentId: string;
  name: string;
  sessions30d: number;
  sessions90d: number;
  lastResearchedAt: number | null;
  override: string | null;
}

export interface Tiers { hot: AgentUsage[]; cold: AgentUsage[]; dormant: AgentUsage[]; excluded: AgentUsage[]; }

/** 一次撈出每個 agent_id 在兩個時間窗的 session 數。 */
function sessionCounts(): Map<string, { d30: number; d90: number }> {
  const now = Date.now();
  const rows = db.prepare(
    "SELECT agent_id, updated_at FROM sessions WHERE updated_at >= ?",
  ).all(now - COLD_WINDOW_MS) as any[];
  const m = new Map<string, { d30: number; d90: number }>();
  for (const r of rows) {
    const e = m.get(r.agent_id) || { d30: 0, d90: 0 };
    e.d90++;
    if (r.updated_at >= now - HOT_WINDOW_MS) e.d30++;
    m.set(r.agent_id, e);
  }
  return m;
}

export function computeTiers(): Tiers {
  const counts = sessionCounts();
  const overrides = listOverrides();
  const tiers: Tiers = { hot: [], cold: [], dormant: [], excluded: [] };
  for (const a of loadAgents()) {
    const c = counts.get(a.id) || { d30: 0, d90: 0 };
    const ov = overrides[a.id] ?? null;
    const usage: AgentUsage = {
      agentId: a.id, name: a.name,
      sessions30d: c.d30, sessions90d: c.d90,
      lastResearchedAt: lastResearchedAt(a.id),
      override: ov,
    };
    if (ov === "exclude") { tiers.excluded.push(usage); continue; }
    if (ov === "hot") { tiers.hot.push(usage); continue; }
    if (ov === "cold") { tiers.cold.push(usage); continue; }
    if (c.d30 >= HOT_THRESHOLD) tiers.hot.push(usage);
    else if (c.d90 >= 1) tiers.cold.push(usage);
    else tiers.dormant.push(usage);
  }
  return tiers;
}

/** 給排程器：取某 tier、依最久沒進修排序、取前 cap 支的 agentId。 */
export function pickForRun(tier: "hot" | "cold", cap: number): string[] {
  const t = computeTiers();
  const list = tier === "hot" ? t.hot : t.cold;
  return [...list]
    .sort((a, b) => (a.lastResearchedAt ?? 0) - (b.lastResearchedAt ?? 0))
    .slice(0, cap)
    .map((a) => a.agentId);
}
```

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/studyTiering.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/studyTiering.ts server/src/studyTiering.test.ts
git commit -m "feat(study): studyTiering — 使用度分層 + pickForRun"
```

---

### 任務 4：研究 prompt + 報告解析（capabilityPrompts.ts）

**檔案：**
- 修改：`server/src/capabilityPrompts.ts`
- 測試：`server/src/capabilityPrompts.test.ts`（既有，追加）

- [ ] **步驟 1：寫失敗測試**

```typescript
import { buildAgentResearchPrompt, parseCapabilityReport } from "./capabilityPrompts.js";

describe("buildAgentResearchPrompt", () => {
  it("含 WebSearch 指令、現有手藝、反 AI slop、LEARN+REPORT 格式", () => {
    const p = buildAgentResearchPrompt("內容創作者", "寫文案", "人設正文", "現有手藝A", "類記憶B");
    expect(p).toContain("WebSearch");
    expect(p).toContain("現有手藝A");
    expect(p).toContain("AI 味");
    expect(p).toContain("=== LEARN kind=craft ===");
    expect(p).toContain("=== REPORT ===");
  });
});

describe("parseCapabilityReport", () => {
  it("擷取 REPORT 區塊與來源 URL", () => {
    const text = "亂碼\n=== REPORT ===\n目前:會X\n最新:Y\n缺口:Z\n來源: https://a.com https://b.com\n=== END REPORT ===\n尾巴";
    const r = parseCapabilityReport(text);
    expect(r?.report).toContain("目前:會X");
    expect(r?.sources).toEqual(["https://a.com", "https://b.com"]);
  });
  it("無 REPORT → null", () => {
    expect(parseCapabilityReport("沒有報告")).toBeNull();
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/capabilityPrompts.test.ts`
預期：FAIL（函式未定義）。

- [ ] **步驟 3：實作**

於 `capabilityPrompts.ts` 追加：

```typescript
export function buildAgentResearchPrompt(
  agentName: string,
  agentDescription: string,
  agentBody: string | undefined,
  existingCraft: string | undefined,
  categoryMemory: string | undefined,
): string {
  const body = (agentBody || "").trim();
  const craft = (existingCraft || "").trim();
  const cat = (categoryMemory || "").trim();
  const bodyBlock = body ? `\n# 你的角色設定\n${body}\n` : "";
  const craftBlock = craft ? `\n# 你目前已有的手藝（避免重複，要在此之上找更新/更缺的）\n${craft}\n` : "";
  const catBlock = cat ? `\n# 類共通能力（已具備）\n${cat}\n` : "";
  return `你是「${agentName}」。${agentDescription}
${bodyBlock}${craftBlock}${catBlock}
# 任務
用 **WebSearch** 工具研究你這個專業領域**當前年度最新**的最佳實踐、工具、平台規則與趨勢（必要時用 WebFetch 讀來源）。對照你目前的手藝與人設，找出：①已**過時／需更新**的做法 ②你還**缺**的新能力。只收**具體可操作**（帶數字門檻／判準／一句話決策樹）、且**有來源依據**的要點；避免通用空話，也避免與你現有手藝重複。
若你是文案／內容類角色，至少要有一條「如何降低 AI 味（anti-AI-slop）」的具體手法。

# 輸出格式（嚴格遵守，不要前言/編號/額外解釋）
先輸出 3-6 個手藝（每條 ≤500 字）：
=== LEARN kind=craft ===
最新手藝要點（具體、可操作、最好帶來源年份）
=== END LEARN ===

最後輸出一份能力現況報告：
=== REPORT ===
目前已具備：…
業界最新：…
你的缺口：…
來源： <把你引用的 URL 列在這行，用空白分隔>
=== END REPORT ===`;
}

export interface ParsedReport { report: string; sources: string[]; }

export function parseCapabilityReport(text: string): ParsedReport | null {
  const m = text.match(/===\s*REPORT\s*===[ \t]*\r?\n([\s\S]*?)\r?\n===\s*END\s*REPORT\s*===/i);
  if (!m) return null;
  const report = m[1].trim();
  if (!report) return null;
  const sources = Array.from(report.matchAll(/https?:\/\/[^\s)]+/g)).map((u) => u[0]);
  return { report, sources: [...new Set(sources)] };
}
```

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/capabilityPrompts.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/capabilityPrompts.ts server/src/capabilityPrompts.test.ts
git commit -m "feat(study): research prompt + 能力報告解析"
```

---

### 任務 5：runResearchTarget + createLearningRun 加 runKind（capabilityLearning.ts）

**檔案：**
- 修改：`server/src/capabilityLearning.ts`
- 測試：`server/src/capabilityLearning.test.ts`（既有，追加）

- [ ] **步驟 1：寫失敗測試**

研究器內部會呼叫真 claude，測試只驗證「解析→建提案+寫報告」這段純邏輯。把解析邏輯抽成可注入的 `ingestResearchOutput(text, agentId, runId)` 並測它：

```typescript
import { ingestResearchOutput } from "./capabilityLearning.js";
import { getLatestReport } from "./studyStore.js";
import { db } from "./db.js";

describe("ingestResearchOutput", () => {
  it("建 craft 提案 + 寫能力報告", () => {
    db.exec("DELETE FROM learning_proposals; DELETE FROM agent_capability_reports;");
    const text = `=== LEARN kind=craft ===
2026 最新做法：X，門檻 Y
=== END LEARN ===
=== REPORT ===
目前：會A
最新：B
缺口：C
來源： https://z.com
=== END REPORT ===`;
    const created = ingestResearchOutput(text, "marketing-content-creator", "run1");
    expect(created).toBe(1);
    const rep = getLatestReport("marketing-content-creator");
    expect(rep?.sources).toEqual(["https://z.com"]);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：FAIL（`ingestResearchOutput` 未定義）。

- [ ] **步驟 3：實作**

在 `capabilityLearning.ts`：

1. import：
```typescript
import { parseCapabilityReport } from "./capabilityPrompts.js";
import { buildAgentResearchPrompt } from "./capabilityPrompts.js";
import { getCraftMemoryFor, saveCapabilityReport } from "./learningStore.js"; // getCraftMemoryFor 既有於 learningStore
import { saveCapabilityReport as _saveReport } from "./studyStore.js";
```
（注意：`saveCapabilityReport` 在 studyStore；`getCraftMemoryFor` 在 learningStore。請正確分別 import，勿重複命名。）

2. 解析函式：
```typescript
export function ingestResearchOutput(text: string, agentId: string, runId: string | null): number {
  const drafts = parseLearnMarkers(text, 6, 500);
  let created = 0;
  for (const d of drafts) {
    const p = createProposal({
      agentId, workspaceId: DEFAULT_WORKSPACE_ID,
      kind: "craft", scope: "agent-global",
      content: d.content, source: "capability-research:agent",
    });
    if (p) created++;
  }
  const rep = parseCapabilityReport(text);
  if (rep) _saveReport({ agentId, report: rep.report, sources: rep.sources, runId });
  return created;
}
```

3. 研究 worker（WebSearch spawn + 逾時 600s；複用既有 `runClaudeOnce` 但需加工具與逾時 → 新增帶選項版）：
```typescript
function runClaudeWithTools(prompt: string, tools: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, val?: string) => { if (settled) return; settled = true; err ? reject(err) : resolve(val!); };
    const child = spawnClaude([
      "-p", "--output-format", "json", "--model", LEARNING_MODEL,
      "--allowedTools", tools.join(" "),
      "--no-session-persistence", "--disable-slash-commands",
    ]);
    const timer = setTimeout(() => { try { child.kill(); } catch {} done(new Error("研究逾時")); }, timeoutMs).unref();
    let out = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d) => { out += String(d); if (out.length > 5_000_000) { child.kill(); done(new Error("輸出超過上限")); } });
    child.stderr!.on("data", () => {});
    child.stdin!.write(Buffer.from(prompt, "utf8")); child.stdin!.end();
    child.on("error", (e) => done(e));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { done(new Error(`claude exit ${code}`)); return; }
      try { const j = JSON.parse(out); done(null, String(j.result || "")); }
      catch (e: any) { done(new Error(`解析回應失敗: ${e.message}`)); }
    });
  });
}

export async function runResearchTarget(target: LearnTarget): Promise<{ created: number }> {
  const agent = loadAgents().find((a) => a.id === target.id);
  if (!agent) throw new Error(`找不到 agent: ${target.id}`);
  const def = readAgentDefinition(target.id);
  const craft = getCraftMemoryFor(target.id, DEFAULT_WORKSPACE_ID); // 回傳 bundle，取 .global/.workspace 合併字串
  const craftText = [craft.legacyGlobal, craft.global].filter((s) => s?.trim()).join("\n");
  const catMem = getCategoryMemory(agent.category);
  const prompt = buildAgentResearchPrompt(agent.name, agent.description, def?.body, craftText, catMem);
  const text = await runClaudeWithTools(prompt, ["WebSearch", "WebFetch"], 600_000);
  const created = ingestResearchOutput(text, target.id, null);
  if (created === 0 && !parseCapabilityReport(text)) throw new Error("研究未產出任何 LEARN 或 REPORT");
  return { created };
}
```
（`getCraftMemoryFor` 回傳型別請依 learningStore 既有定義調整欄位名；若無 legacyGlobal 欄位則只取可用欄位。）

4. `createLearningRun` 加 `runKind` 參數並寫入 DB：
```typescript
export function createLearningRun(targets: LearnTarget[], scheduleId?: string | null, runKind: "learning" | "research" = "learning"): LearningRun { /* …既有… 在物件加 runKind，insertRunToDB 帶入 run_kind */ }
```
同步更新 `LearningRun` interface 加 `runKind?: "learning" | "research"`、`insertRunToDB`／`rowToRun` 帶 `run_kind`。

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/capabilityLearning.ts server/src/capabilityLearning.test.ts
git commit -m "feat(study): runResearchTarget（WebSearch）+ ingestResearchOutput + run_kind"
```

---

### 任務 6：API 端點 + deriveDefaultScope（routes/learning.ts）

**檔案：**
- 修改：`server/src/routes/learning.ts`
- 測試：`server/src/app.test.ts`（既有，追加 HTTP 測試，沿用 ephemeral 埠 `app.listen(0)` + fetch 模式）

- [ ] **步驟 1：寫失敗測試**

```typescript
// 於 app.test.ts 追加（沿用既有 baseUrl helper）
it("GET /api/learning/study/tiers 回 hot/cold/dormant", async () => {
  const r = await fetch(`${baseUrl}/api/learning/study/tiers`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j).toHaveProperty("hot"); expect(j).toHaveProperty("cold"); expect(j).toHaveProperty("dormant");
});
it("POST /api/learning/study/override 設定後可在 tiers 反映", async () => {
  const r = await fetch(`${baseUrl}/api/learning/study/override`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "marketing-content-creator", override: "hot" }),
  });
  expect(r.status).toBe(200);
});
it("GET /api/learning/study/schedules 回 hot/cold 兩列", async () => {
  const j = await (await fetch(`${baseUrl}/api/learning/study/schedules`)).json();
  expect(j.map((s: any) => s.tier).sort()).toEqual(["cold", "hot"]);
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/app.test.ts`
預期：FAIL（404）。

- [ ] **步驟 3：實作端點**

在 `routes/learning.ts`：

1. import：
```typescript
import { computeTiers } from "../studyTiering.js";
import { setTierOverride, getLatestReport, listStudySchedules, updateStudySchedule } from "../studyStore.js";
import { runResearchTarget, createLearningRun, executeLearningRun } from "../capabilityLearning.js";
```

2. `deriveDefaultScope` 修改：把判斷改為
```typescript
if (p.source.startsWith("capability-learning:") || p.source.startsWith("capability-research:")) return "global";
```

3. 端點：
```typescript
learningRouter.get("/study/tiers", (_req, res) => res.json(computeTiers()));

learningRouter.post("/study/override", (req, res) => {
  const { agentId, override } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  if (override !== null && !["hot", "cold", "exclude"].includes(override)) return res.status(400).json({ error: "override 非法" });
  setTierOverride(String(agentId), override);
  res.json({ ok: true });
});

learningRouter.get("/study/report/:agentId", (req, res) => {
  res.json(getLatestReport(req.params.agentId) || null);
});

learningRouter.get("/study/schedules", (_req, res) => res.json(listStudySchedules()));

learningRouter.patch("/study/schedules/:tier", (req, res) => {
  const tier = req.params.tier;
  if (tier !== "hot" && tier !== "cold") return res.status(400).json({ error: "tier 須 hot/cold" });
  updateStudySchedule(tier, {
    enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
    cron: req.body?.cron, perRunCap: req.body?.perRunCap,
  });
  // 需在 index.ts 匯出 studyScheduler 後呼叫 sync；此處透過 req.app.get
  req.app.get("studyScheduler")?.sync?.();
  res.json({ ok: true });
});

learningRouter.post("/study/run", (req, res) => {
  const agentId = String(req.body?.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const run = createLearningRun([{ type: "agent", id: agentId }], null, "research");
  res.json({ runId: run.id });
  const io = req.app.get("io");
  executeLearningRun(run, runResearchTarget, (r) => io?.emit("learning:progress", {
    runId: r.id, status: r.status, total: r.total, done: r.done, current: r.current, failed: r.failed, createdProposals: r.createdProposals,
  })).catch(() => {});
});
```

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/app.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/routes/learning.ts server/src/app.test.ts
git commit -m "feat(study): /study/* API + deriveDefaultScope 認 capability-research"
```

---

### 任務 7：studyScheduler + index.ts 接線 + resume 分流

**檔案：**
- 創建：`server/src/studyScheduler.ts`
- 測試：`server/src/studySchedule.test.ts`
- 修改：`server/src/index.ts`、`server/src/capabilityLearning.ts`（resume worker 分流）

- [ ] **步驟 1：寫失敗測試**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runScheduledTier } from "./studyScheduler.js";

describe("runScheduledTier", () => {
  it("依 pickForRun 取目標、用 research worker 建 run", async () => {
    const worker = vi.fn().mockResolvedValue({ created: 1 });
    const picker = vi.fn().mockReturnValue(["a1", "a2"]);
    const created = await runScheduledTier("hot", 10, worker, () => {}, picker);
    expect(picker).toHaveBeenCalledWith("hot", 10);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(created.total).toBe(2);
  });
  it("空名單不建 run", async () => {
    const worker = vi.fn();
    const created = await runScheduledTier("cold", 10, worker, () => {}, () => []);
    expect(worker).not.toHaveBeenCalled();
    expect(created.total).toBe(0);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

運行：`cd server && npx vitest run src/studySchedule.test.ts`
預期：FAIL（模組不存在）。

- [ ] **步驟 3：實作 studyScheduler.ts**

```typescript
import cron, { ScheduledTask } from "node-cron";
import { listStudySchedules, touchStudyScheduleRun } from "./studyStore.js";
import { pickForRun } from "./studyTiering.js";
import { createLearningRun, executeLearningRun, runResearchTarget, type LearnTarget } from "./capabilityLearning.js";

type Sink = (payload: any) => void;
type Worker = (t: LearnTarget) => Promise<{ created: number }>;
type Picker = (tier: "hot" | "cold", cap: number) => string[];

/** 測試可注入 worker/picker；正式用預設。回傳 { total }。 */
export async function runScheduledTier(
  tier: "hot" | "cold", cap: number,
  worker: Worker = runResearchTarget, sink: Sink = () => {},
  picker: Picker = pickForRun,
): Promise<{ total: number; runId: string | null }> {
  const ids = picker(tier, cap);
  if (ids.length === 0) return { total: 0, runId: null };
  const targets: LearnTarget[] = ids.map((id) => ({ type: "agent", id }));
  const run = createLearningRun(targets, null, "research");
  touchStudyScheduleRun(tier);
  await executeLearningRun(run, worker, (r) => sink({
    runId: r.id, status: r.status, total: r.total, done: r.done,
    current: r.current, failed: r.failed, createdProposals: r.createdProposals, tier,
  }));
  return { total: ids.length, runId: run.id };
}

class StudyScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private sink: Sink = () => {};
  init(sink: Sink) { this.sink = sink; this.sync(); console.log(`[study-scheduler] initialized, ${this.tasks.size} active`); }
  sync() {
    for (const id of [...this.tasks.keys()]) { this.tasks.get(id)!.stop(); this.tasks.delete(id); }
    for (const s of listStudySchedules()) {
      if (s.enabled && cron.validate(s.cron)) {
        const task = cron.schedule(s.cron, () => {
          runScheduledTier(s.tier, s.perRunCap, runResearchTarget, this.sink).catch((e) =>
            console.warn(`[study-scheduler] ${s.tier} failed:`, e?.message || e));
        }, { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" });
        this.tasks.set(s.tier, task);
        console.log(`[study-scheduler] registered ${s.tier} (${s.cron})`);
      }
    }
  }
}
export const studyScheduler = new StudyScheduler();
```

於 `index.ts`：
- import `{ studyScheduler }`，在既有 `learningScheduler.init(...)` 旁加 `studyScheduler.init((p) => io.emit("learning:progress", p));`
- `app.set("studyScheduler", studyScheduler);`（供 routes PATCH 後 sync）
- **resume 分流**：`resumeUnfinishedRuns` 目前固定傳 `runLearningTarget`。改為依 `run.runKind` 選 worker：
```typescript
resumeUnfinishedRuns(
  (t) => /* 依 run 無法在 worker 內取得 kind，故改 resume 內部分流 */ runLearningTarget(t),
  sink,
);
```
**正確做法**：修改 `resumeUnfinishedRuns`（capabilityLearning.ts），對每個 row 依 `run.runKind` 選 `runKind==='research' ? runResearchTarget : runLearningTarget` 再 `executeLearningRun`。把 worker 參數改為「兩個 worker 物件 `{ learning, research }`」或在函式內部直接 import 兩者。最簡：`resumeUnfinishedRuns(sink)` 內部自行依 runKind 選 worker（不再由外部注入單一 worker）。同步更新 index.ts 呼叫。

- [ ] **步驟 4：跑測試確認通過**

運行：`cd server && npx vitest run src/studySchedule.test.ts && npm test`
預期：PASS（且既有測試全綠）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/studyScheduler.ts server/src/studySchedule.test.ts server/src/index.ts server/src/capabilityLearning.ts
git commit -m "feat(study): 分層排程器 + index 接線 + resume run_kind 分流"
```

---

### 任務 8：前端「自主進修」面板

**檔案：**
- 創建：`client/src/components/AutonomousStudyPanel.tsx`
- 修改：`client/src/lib/api.ts`、既有面板入口（`CapabilityLearningPanel.tsx` 或 `App.tsx` 的 lazy 面板註冊處）
- 測試：`client/src/components/AutonomousStudyPanel.test.tsx`

- [ ] **步驟 1：api.ts 加方法**

```typescript
// lib/api.ts 內 api 物件追加
studyTiers: () => http<{ hot: any[]; cold: any[]; dormant: any[] }>(`/api/learning/study/tiers`),
studyOverride: (agentId: string, override: string | null) =>
  http(`/api/learning/study/override`, { method: "POST", body: JSON.stringify({ agentId, override }) }),
studyRun: (agentId: string) => http<{ runId: string }>(`/api/learning/study/run`, { method: "POST", body: JSON.stringify({ agentId }) }),
studyReport: (agentId: string) => http<any>(`/api/learning/study/report/${agentId}`),
studySchedules: () => http<any[]>(`/api/learning/study/schedules`),
studyPatchSchedule: (tier: string, patch: any) => http(`/api/learning/study/schedules/${tier}`, { method: "PATCH", body: JSON.stringify(patch) }),
```
（依 api.ts 既有 `http` helper 簽名調整。）

- [ ] **步驟 2：寫失敗測試（RTL，mock api）**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../lib/api", () => ({ api: {
  studyTiers: vi.fn().mockResolvedValue({ hot: [{ agentId: "a1", name: "熱A", sessions30d: 5, lastResearchedAt: null }], cold: [], dormant: [] }),
  studySchedules: vi.fn().mockResolvedValue([{ tier: "hot", cron: "0 4 * * 1", enabled: false, perRunCap: 10 }, { tier: "cold", cron: "0 4 1 * *", enabled: false, perRunCap: 10 }]),
  studyOverride: vi.fn(), studyRun: vi.fn(), studyReport: vi.fn(), studyPatchSchedule: vi.fn(),
}}));
import { AutonomousStudyPanel } from "./AutonomousStudyPanel";

describe("AutonomousStudyPanel", () => {
  it("載入後顯示熱層 agent", async () => {
    render(<AutonomousStudyPanel />);
    await waitFor(() => expect(screen.getByText("熱A")).toBeInTheDocument());
  });
});
```

- [ ] **步驟 3：跑測試確認失敗**

運行：`cd client && npx vitest run src/components/AutonomousStudyPanel.test.tsx`
預期：FAIL（元件不存在）。

- [ ] **步驟 4：實作 AutonomousStudyPanel.tsx**

最小可動版（三層名單 + 排程開關 + 立即進修 + 釘選/排除；報告檢視可後續加）：
```tsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function AutonomousStudyPanel() {
  const [tiers, setTiers] = useState<{ hot: any[]; cold: any[]; dormant: any[] } | null>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const load = () => { api.studyTiers().then(setTiers); api.studySchedules().then(setSchedules); };
  useEffect(load, []);

  const setOverride = async (agentId: string, override: string | null) => { await api.studyOverride(agentId, override); load(); };
  const runNow = async (agentId: string) => { await api.studyRun(agentId); alert("已開始進修，完成後到下方提案審核"); };
  const toggleSchedule = async (tier: string, enabled: boolean) => { await api.studyPatchSchedule(tier, { enabled }); api.studySchedules().then(setSchedules); };

  if (!tiers) return <div className="p-4 text-zinc-500">載入中…</div>;
  const Row = ({ a }: { a: any }) => (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-zinc-800/50">
      <span>{a.name} <span className="text-zinc-500 text-xs">近30天 {a.sessions30d} 次{a.lastResearchedAt ? ` · 上次進修 ${new Date(a.lastResearchedAt).toLocaleDateString()}` : " · 未進修"}</span></span>
      <span className="flex gap-1">
        <button onClick={() => runNow(a.agentId)} className="text-xs px-2 py-0.5 bg-violet-600 rounded text-white">立即進修</button>
        <button onClick={() => setOverride(a.agentId, "hot")} className="text-xs px-2 py-0.5 bg-zinc-700 rounded">釘熱</button>
        <button onClick={() => setOverride(a.agentId, "exclude")} className="text-xs px-2 py-0.5 bg-zinc-700 rounded">排除</button>
        {a.override && <button onClick={() => setOverride(a.agentId, null)} className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">清除</button>}
      </span>
    </div>
  );
  return (
    <div className="p-4 space-y-4">
      {schedules.map((s) => (
        <label key={s.tier} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.enabled} onChange={(e) => toggleSchedule(s.tier, e.target.checked)} />
          {s.tier === "hot" ? "🔥 熱層每週自主進修" : "🌡️ 冷層每月自主進修"}（每次上限 {s.perRunCap} 支）
        </label>
      ))}
      <div><div className="text-xs text-zinc-400 mb-1">🔥 熱層（{tiers.hot.length}）</div>{tiers.hot.map((a) => <Row key={a.agentId} a={a} />)}</div>
      <div><div className="text-xs text-zinc-400 mb-1">🌡️ 冷層（{tiers.cold.length}）</div>{tiers.cold.map((a) => <Row key={a.agentId} a={a} />)}</div>
      <div><div className="text-xs text-zinc-400 mb-1">💤 休眠（{tiers.dormant.length}，不自動跑）</div>{tiers.dormant.slice(0, 30).map((a) => <Row key={a.agentId} a={a} />)}</div>
    </div>
  );
}
```

掛進既有面板入口（依 `App.tsx` 既有 lazy 面板模式新增一個分頁/入口，與 CapabilityLearningPanel 並列）。

- [ ] **步驟 5：跑測試 + build 確認通過**

運行：`cd client && npx vitest run src/components/AutonomousStudyPanel.test.tsx && npm run build`
預期：PASS + build 成功。

- [ ] **步驟 6：Commit**

```bash
git add client/src/lib/api.ts client/src/components/AutonomousStudyPanel.tsx client/src/components/AutonomousStudyPanel.test.tsx client/src/App.tsx
git commit -m "feat(study): 自主進修前端面板（分層名單/排程開關/立即進修）"
```

---

## 收尾驗證
- [ ] `cd server && npm test`（tsc --noEmit + vitest，全綠）
- [ ] `cd client && npm test && npm run build`（vitest + tsc + vite，全綠）
- [ ] 手動：開 dashboard →「自主進修」面板 → 對一支常用 agent 按「立即進修」→ 觀察 socket 進度 → 完成後在能力學習面板看到 `capability-research` 來源的 craft 提案 + 能力現況報告 → 批准一條 → 確認落 agent-global craft。

## 自檢結果
- **規格覆蓋**：§5.1→任務3、§5.2→任務4+5、§5.3→任務2+5、§5.4→任務7、§5.5→任務8、§6→任務1、§7→任務6、§9 resume 分流→任務7、§10 測試→各任務內含。✅
- **占位符**：無 TODO；所有步驟含實際代碼/指令。研究器與真 claude 互動部分以可注入 worker/picker + 純解析函式 `ingestResearchOutput` 隔離測試（不在 CI 打真 API）。✅
- **型別一致**：`runResearchTarget`/`runLearningTarget` 同簽名 `(LearnTarget)=>Promise<{created}>`；`createLearningRun(targets, scheduleId, runKind)`；`computeTiers`/`pickForRun`/`runScheduledTier` 簽名跨任務一致；`saveCapabilityReport` 於 studyStore、`getCraftMemoryFor` 於 learningStore（任務5 已註明分別 import）。✅
