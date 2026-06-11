# B 目標驅動自主迴圈 + C 行動核可閘門 實作計畫

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計畫。步驟使用複選框（`- [ ]`）語法來追蹤進度。

**目標：** 讓 agent 能在預算上限內自主逐步達成一個目標（B），過程中四類高風險動作經伺服器權威的「待批佇列」核可後才執行（C）；並把既有手動派工遷移到同一佇列，根治舊的「派工卡重複跳」bug。

**架構：** 三層——(1) `actionProtocol` 純函式解析 agent 申報的 `=== ACTION ===` 標記 + DB 兩表 `autonomy_runs`/`pending_actions` + `store/autonomy` CRUD；(2) `autonomyRunner` 注入式依賴的狀態機驅動一個 run；(3) `routes/autonomy` + socket + 前端 `ActionApprovalCard`/`AutonomyPanel`/`useAutonomy`（前端只渲染、不持狀態）。

**技術棧：** Node + TypeScript + node:sqlite（DatabaseSync）+ Express + socket.io（server）；React + Vite + Tailwind + vitest（client）。測試：vitest（server `tsc --noEmit && vitest run`；client jsdom）。

**設計鎖定（跨任務一致性）：**
- ACTION 協議文字由 `autonomyRunner` **在 prompt 中 in-band 注入**（非系統提示），因 `reattach()` 不重建系統提示、且自主 run 跑在既有 session 上。
- 自主迴圈與手動派工**共用** `parseActions` 純函式；但走兩條觸發路徑：自主走 `sendTurn` 回傳值解析（runner 同步驅動）、手動派工走 `agentManager` 訊息監聽器解析（PM 一般對話）。監聽器遇到「該 session 有 active run」時跳過（交給 runner），避免重複入列。
- 型別契約（全程沿用，勿改名）：

```ts
// actionProtocol.ts
export type ActionKind = "plan" | "next_step" | "goal_done" | "need_input" | "dispatch" | "external_send" | "destructive" | "spend";
export type Risk = "high" | "low";
export interface ParsedAction { kind: ActionKind; risk: Risk; summary: string; detail: string; raw: string; dispatchItems?: DispatchItem[]; }

// store/autonomy.ts
export type RunStatus = "planning" | "awaiting_plan_approval" | "running" | "paused_for_action" | "paused_for_input" | "paused" | "done" | "stopped" | "budget_exhausted" | "error";
export type PendingStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "superseded";
export interface AutonomyRun { id: string; sessionId: string; workspaceId: string; goal: string; status: RunStatus; stepCount: number; maxSteps: number; startedAt: number; deadlineAt: number; endedAt?: number; lastError?: string; createdAt: number; updatedAt: number; }
export interface PendingAction { id: string; runId?: string; sessionId: string; workspaceId: string; kind: ActionKind; risk: Risk; summary: string; detail?: string; status: PendingStatus; result?: string; createdAt: number; decidedAt?: number; }
```

---

### 任務 1：行動協議解析器（actionProtocol，純函式）

**檔案：**
- 創建：`server/src/actionProtocol.ts`
- 測試：`server/src/actionProtocol.test.ts`
- 參考：`server/src/dispatchParser.ts`（`parseDispatchMarker(text): DispatchPlan | null`，含 `items: DispatchItem[]`）；`client/src/lib/dispatchDetection.ts`（同格式解析範例）

- [ ] **步驟 1：寫失敗的測試**

```ts
// server/src/actionProtocol.test.ts
import { describe, it, expect } from "vitest";
import { parseActions, classifyRisk, HIGH_RISK_KINDS } from "./actionProtocol.js";

describe("classifyRisk", () => {
  it("四類高風險 + plan 為 high", () => {
    for (const k of ["plan", "dispatch", "external_send", "destructive", "spend"] as const) {
      expect(classifyRisk(k)).toBe("high");
    }
  });
  it("迴圈控制信號為 low", () => {
    expect(classifyRisk("next_step")).toBe("low");
    expect(classifyRisk("goal_done")).toBe("low");
    expect(classifyRisk("need_input")).toBe("low");
  });
  it("HIGH_RISK_KINDS 含全部五項", () => {
    expect(HIGH_RISK_KINDS.sort()).toEqual(["destructive", "dispatch", "external_send", "plan", "spend"]);
  });
});

describe("parseActions", () => {
  it("解析單一 next_step 區塊", () => {
    const text = "做完了一步。\n=== ACTION ===\nkind: next_step\nrisk: low\nsummary: 已抓取首頁\ndetail: 取得 12 筆\n=== END ACTION ===";
    const r = parseActions(text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "next_step", risk: "low", summary: "已抓取首頁", detail: "取得 12 筆" });
  });
  it("缺 risk 時用 kind 推導", () => {
    const r = parseActions("=== ACTION ===\nkind: external_send\nsummary: 寄信給客戶\n=== END ACTION ===");
    expect(r[0].risk).toBe("high");
  });
  it("缺 summary 用 detail 首行", () => {
    const r = parseActions("=== ACTION ===\nkind: next_step\ndetail: 第一行細節\n第二行\n=== END ACTION ===");
    expect(r[0].summary).toBe("第一行細節");
  });
  it("未知 kind 視為 need_input", () => {
    const r = parseActions("=== ACTION ===\nkind: bogus\nsummary: x\n=== END ACTION ===");
    expect(r[0].kind).toBe("need_input");
  });
  it("dispatch kind 另解析出 dispatchItems", () => {
    const text = "=== ACTION ===\nkind: dispatch\nsummary: 請教兩位\ndetail:\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END ACTION ===";
    const r = parseActions(text);
    expect(r[0].kind).toBe("dispatch");
    expect(r[0].dispatchItems).toEqual([{ agentId: "marketing-trend-researcher", mode: "consult", task: "本週選題" }]);
  });
  it("多區塊全解析", () => {
    const text = "=== ACTION ===\nkind: next_step\nsummary: a\n=== END ACTION ===\n中間\n=== ACTION ===\nkind: goal_done\nsummary: b\n=== END ACTION ===";
    expect(parseActions(text)).toHaveLength(2);
  });
  it("無區塊回空陣列", () => {
    expect(parseActions("一般回覆，沒有標記")).toEqual([]);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/actionProtocol.test.ts`
預期：FAIL（`Cannot find module './actionProtocol.js'`）

- [ ] **步驟 3：寫最小實作**

```ts
// server/src/actionProtocol.ts
import { parseDispatchMarker, type DispatchItem } from "./dispatchParser.js";

export type ActionKind = "plan" | "next_step" | "goal_done" | "need_input" | "dispatch" | "external_send" | "destructive" | "spend";
export type Risk = "high" | "low";

export interface ParsedAction {
  kind: ActionKind;
  risk: Risk;
  summary: string;
  detail: string;
  raw: string;
  dispatchItems?: DispatchItem[];
}

export const HIGH_RISK_KINDS: ActionKind[] = ["plan", "dispatch", "external_send", "destructive", "spend"];
const KNOWN_KINDS: ActionKind[] = ["plan", "next_step", "goal_done", "need_input", "dispatch", "external_send", "destructive", "spend"];

export function classifyRisk(kind: ActionKind): Risk {
  return HIGH_RISK_KINDS.includes(kind) ? "high" : "low";
}

const ACTION_RE = /=== ACTION ===\s*\n([\s\S]*?)\n=== END ACTION ===/g;

/** 解析一段文字中的所有 ACTION 區塊。容錯：缺欄位用合理預設、未知 kind → need_input。 */
export function parseActions(text: string): ParsedAction[] {
  const out: ParsedAction[] = [];
  let m: RegExpExecArray | null;
  ACTION_RE.lastIndex = 0;
  while ((m = ACTION_RE.exec(text)) !== null) {
    const body = m[1];
    const kindRaw = (body.match(/^\s*kind:\s*(\S+)/m)?.[1] || "need_input").toLowerCase();
    const kind: ActionKind = (KNOWN_KINDS as string[]).includes(kindRaw) ? (kindRaw as ActionKind) : "need_input";
    const riskRaw = body.match(/^\s*risk:\s*(\S+)/m)?.[1]?.toLowerCase();
    const risk: Risk = riskRaw === "high" || riskRaw === "low" ? riskRaw : classifyRisk(kind);
    // detail：取 "detail:" 之後到區塊結尾（保留多行）；無則空。
    const detailMatch = body.match(/^\s*detail:\s*([\s\S]*)$/m);
    const detail = (detailMatch?.[1] ?? "").trim();
    const summary = (body.match(/^\s*summary:\s*(.+)$/m)?.[1]?.trim()) || detail.split(/\r?\n/)[0]?.trim() || kind;
    const action: ParsedAction = { kind, risk, summary, detail, raw: m[0] };
    if (kind === "dispatch") {
      // 用既有派工解析器解 detail 內的 - agentId/mode/task 子格式。
      const plan = parseDispatchMarker(`=== DISPATCH ===\n${detail}\n=== END DISPATCH ===`);
      action.dispatchItems = plan?.items ?? [];
    }
    out.push(action);
  }
  return out;
}
```

> 注意：`parseDispatchMarker` 期望 `=== DISPATCH ===`/`=== END DISPATCH ===` 包裹。若其簽名或標記與此處假設不符，實作時讀 `dispatchParser.ts` 對齊（回傳 `DispatchPlan { items }`）。

- [ ] **步驟 4：跑測試確認通過**

執行：`cd server && npx vitest run src/actionProtocol.test.ts`
預期：PASS（全部案例綠）

- [ ] **步驟 5：Commit**

```bash
git add server/src/actionProtocol.ts server/src/actionProtocol.test.ts
git commit -m "feat(autonomy): 行動協議解析器 actionProtocol（純函式）"
```

---

### 任務 2：DB schema（autonomy_runs + pending_actions）

**檔案：**
- 修改：`server/src/dbSchema.ts`（`BASE_SCHEMA` 末尾加兩表；`applyMigrations` 加 `tableExists` 守衛的建表，確保舊 DB 也補上）
- 測試：`server/src/dbSchema.test.ts`（沿用既有檔案，加案例）
- 參考：既有 `learning_runs` 表與 `applyMigrations` 內 `tableExists`/`hasColumn` 模式

- [ ] **步驟 1：寫失敗的測試**（加到 `dbSchema.test.ts`）

```ts
import { DatabaseSync } from "node:sqlite";
import { setupSchema } from "./dbSchema.js";

it("autonomy_runs 與 pending_actions 表建立成功", () => {
  const db = new DatabaseSync(":memory:");
  setupSchema(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
  expect(tables).toContain("autonomy_runs");
  expect(tables).toContain("pending_actions");
  // 欄位齊全（抽查關鍵欄）
  const runCols = db.prepare("PRAGMA table_info(autonomy_runs)").all().map((c: any) => c.name);
  expect(runCols).toEqual(expect.arrayContaining(["id", "session_id", "goal", "status", "step_count", "max_steps", "deadline_at"]));
  const paCols = db.prepare("PRAGMA table_info(pending_actions)").all().map((c: any) => c.name);
  expect(paCols).toEqual(expect.arrayContaining(["id", "run_id", "session_id", "kind", "risk", "summary", "status"]));
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/dbSchema.test.ts`
預期：FAIL（找不到 autonomy_runs 表）

- [ ] **步驟 3：實作——`BASE_SCHEMA` 末尾（`agent_study_schedules` 之後、結尾反引號之前）插入：**

```sql
CREATE TABLE IF NOT EXISTS autonomy_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  step_count INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_autonomy_runs_session ON autonomy_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_autonomy_runs_status ON autonomy_runs(status);

CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  session_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  risk TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_session ON pending_actions(session_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_actions_run ON pending_actions(run_id);
```

> `CREATE TABLE IF NOT EXISTS` 在 `applyBaseSchema` 已對舊 DB 補建，無需額外 migration（新表對任何 DB 都安全）。沿用既有慣例即可，不必動 `applyMigrations`。

- [ ] **步驟 4：跑測試確認通過**

執行：`cd server && npx vitest run src/dbSchema.test.ts`
預期：PASS

- [ ] **步驟 5：Commit**

```bash
git add server/src/dbSchema.ts server/src/dbSchema.test.ts
git commit -m "feat(autonomy): 新增 autonomy_runs / pending_actions 資料表"
```

---

### 任務 3：store/autonomy（CRUD）

**檔案：**
- 創建：`server/src/store/autonomy.ts`
- 測試：`server/src/store.autonomy.test.ts`
- 匯出橋接：`server/src/store.ts`（barrel）末尾加 `export * from "./store/autonomy.js";`
- 參考：`server/src/store/workspaces.ts`（`rowTo*` 映射、`db.prepare`）；`db.ts`（`VITEST → :memory:`，測試天然隔離）

- [ ] **步驟 1：寫失敗的測試**

```ts
// server/src/store.autonomy.test.ts
import { describe, it, expect } from "vitest";
import {
  createRun, getRun, updateRunStatus, incrementStep, listActiveRuns, getActiveRunForSession,
  createPendingAction, getPendingAction, listPending, decidePendingAction, markActionExecuted,
} from "./store/autonomy.js";

describe("store/autonomy", () => {
  it("createRun → getRun 往返", () => {
    const r = createRun({ sessionId: "s1", workspaceId: "w1", goal: "做一件事", maxSteps: 20, maxWallMs: 1000 });
    expect(r.status).toBe("planning");
    expect(r.stepCount).toBe(0);
    expect(r.deadlineAt).toBeGreaterThan(r.startedAt);
    expect(getRun(r.id)?.goal).toBe("做一件事");
  });
  it("updateRunStatus / incrementStep", () => {
    const r = createRun({ sessionId: "s2", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(r.id, "running");
    expect(getRun(r.id)?.status).toBe("running");
    incrementStep(r.id);
    expect(getRun(r.id)?.stepCount).toBe(1);
  });
  it("getActiveRunForSession 只回未結束的 run", () => {
    const r = createRun({ sessionId: "s3", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    expect(getActiveRunForSession("s3")?.id).toBe(r.id);
    updateRunStatus(r.id, "done");
    expect(getActiveRunForSession("s3")).toBeUndefined();
  });
  it("listActiveRuns 不含終態", () => {
    const a = createRun({ sessionId: "s4", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(a.id, "running");
    const b = createRun({ sessionId: "s5", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(b.id, "stopped");
    const ids = listActiveRuns().map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });
  it("pending action：create → list → decide → executed", () => {
    const pa = createPendingAction({ sessionId: "s6", workspaceId: "w1", kind: "dispatch", risk: "high", summary: "派工", detail: "x" });
    expect(pa.status).toBe("pending");
    expect(listPending("s6").map((p) => p.id)).toContain(pa.id);
    decidePendingAction(pa.id, "approved");
    expect(getPendingAction(pa.id)?.status).toBe("approved");
    markActionExecuted(pa.id, "做完了");
    expect(getPendingAction(pa.id)?.status).toBe("executed");
    expect(getPendingAction(pa.id)?.result).toBe("做完了");
    expect(listPending("s6")).toHaveLength(0); // listPending 只回 pending
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/store.autonomy.test.ts`
預期：FAIL（模組不存在）

- [ ] **步驟 3：寫實作**

```ts
// server/src/store/autonomy.ts
import { v4 as uuid } from "uuid";
import { db } from "../db.js";
import type { ActionKind, Risk } from "../actionProtocol.js";

export type RunStatus = "planning" | "awaiting_plan_approval" | "running" | "paused_for_action" | "paused_for_input" | "paused" | "done" | "stopped" | "budget_exhausted" | "error";
export type PendingStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "superseded";

export interface AutonomyRun {
  id: string; sessionId: string; workspaceId: string; goal: string; status: RunStatus;
  stepCount: number; maxSteps: number; startedAt: number; deadlineAt: number;
  endedAt?: number; lastError?: string; createdAt: number; updatedAt: number;
}
export interface PendingAction {
  id: string; runId?: string; sessionId: string; workspaceId: string; kind: ActionKind; risk: Risk;
  summary: string; detail?: string; status: PendingStatus; result?: string; createdAt: number; decidedAt?: number;
}

const ACTIVE_RUN_STATES: RunStatus[] = ["planning", "awaiting_plan_approval", "running", "paused_for_action", "paused_for_input", "paused"];
const TERMINAL_RUN_STATES: RunStatus[] = ["done", "stopped", "budget_exhausted", "error"];

function rowToRun(r: any): AutonomyRun {
  return {
    id: r.id, sessionId: r.session_id, workspaceId: r.workspace_id, goal: r.goal, status: r.status,
    stepCount: r.step_count, maxSteps: r.max_steps, startedAt: r.started_at, deadlineAt: r.deadline_at,
    endedAt: r.ended_at ?? undefined, lastError: r.last_error ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToAction(r: any): PendingAction {
  return {
    id: r.id, runId: r.run_id ?? undefined, sessionId: r.session_id, workspaceId: r.workspace_id,
    kind: r.kind, risk: r.risk, summary: r.summary, detail: r.detail ?? undefined,
    status: r.status, result: r.result ?? undefined, createdAt: r.created_at, decidedAt: r.decided_at ?? undefined,
  };
}

export function createRun(input: { sessionId: string; workspaceId: string; goal: string; maxSteps: number; maxWallMs: number }): AutonomyRun {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO autonomy_runs (id, session_id, workspace_id, goal, status, step_count, max_steps, started_at, deadline_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'planning', 0, ?, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.workspaceId, input.goal, input.maxSteps, now, now + input.maxWallMs, now, now);
  return getRun(id)!;
}
export function getRun(id: string): AutonomyRun | undefined {
  const r = db.prepare("SELECT * FROM autonomy_runs WHERE id = ?").get(id) as any;
  return r ? rowToRun(r) : undefined;
}
export function updateRunStatus(id: string, status: RunStatus, lastError?: string): void {
  const ended = TERMINAL_RUN_STATES.includes(status) ? Date.now() : null;
  db.prepare("UPDATE autonomy_runs SET status = ?, last_error = ?, ended_at = COALESCE(?, ended_at), updated_at = ? WHERE id = ?")
    .run(status, lastError ?? null, ended, Date.now(), id);
}
export function incrementStep(id: string): void {
  db.prepare("UPDATE autonomy_runs SET step_count = step_count + 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
}
export function listActiveRuns(): AutonomyRun[] {
  const ph = ACTIVE_RUN_STATES.map(() => "?").join(",");
  return (db.prepare(`SELECT * FROM autonomy_runs WHERE status IN (${ph}) ORDER BY created_at`).all(...ACTIVE_RUN_STATES) as any[]).map(rowToRun);
}
export function getActiveRunForSession(sessionId: string): AutonomyRun | undefined {
  const ph = ACTIVE_RUN_STATES.map(() => "?").join(",");
  const r = db.prepare(`SELECT * FROM autonomy_runs WHERE session_id = ? AND status IN (${ph}) ORDER BY created_at DESC LIMIT 1`).get(sessionId, ...ACTIVE_RUN_STATES) as any;
  return r ? rowToRun(r) : undefined;
}

export function createPendingAction(input: { runId?: string; sessionId: string; workspaceId: string; kind: ActionKind; risk: Risk; summary: string; detail?: string }): PendingAction {
  const id = `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO pending_actions (id, run_id, session_id, workspace_id, kind, risk, summary, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, input.runId ?? null, input.sessionId, input.workspaceId, input.kind, input.risk, input.summary, input.detail ?? null, Date.now());
  return getPendingAction(id)!;
}
export function getPendingAction(id: string): PendingAction | undefined {
  const r = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as any;
  return r ? rowToAction(r) : undefined;
}
export function listPending(sessionId: string): PendingAction[] {
  return (db.prepare("SELECT * FROM pending_actions WHERE session_id = ? AND status = 'pending' ORDER BY created_at").all(sessionId) as any[]).map(rowToAction);
}
export function decidePendingAction(id: string, status: Extract<PendingStatus, "approved" | "rejected">): void {
  db.prepare("UPDATE pending_actions SET status = ?, decided_at = ? WHERE id = ?").run(status, Date.now(), id);
}
export function markActionExecuted(id: string, result: string, ok = true): void {
  db.prepare("UPDATE pending_actions SET status = ?, result = ? WHERE id = ?").run(ok ? "executed" : "failed", result.slice(0, 4000), id);
}
```

- [ ] **步驟 4：barrel 匯出 + 跑測試**

在 `server/src/store.ts` 末尾加：`export * from "./store/autonomy.js";`
執行：`cd server && npx vitest run src/store.autonomy.test.ts`
預期：PASS

- [ ] **步驟 5：Commit**

```bash
git add server/src/store/autonomy.ts server/src/store.autonomy.test.ts server/src/store.ts
git commit -m "feat(autonomy): store/autonomy CRUD（runs + pending actions）"
```

---

### 任務 4：自主迴圈狀態機（autonomyRunner）★ 用 Opus

**檔案：**
- 創建：`server/src/autonomyRunner.ts`
- 測試：`server/src/autonomyRunner.test.ts`
- 參考：`server/src/dispatchRunner.ts`（注入式 deps 範例）；任務 1/3 型別

**核心設計：** 一個 module 級 singleton 管理「runId → 進行中 Promise 控制」。所有副作用（送回合、跑派工、時鐘、emit）走注入的 `AutonomyDeps`，預設依賴在任務 5 接 `agentManager`。狀態機只認 `sendTurn` 回傳的文字、用 `parseActions` 取動作、依 kind 轉移。

- [ ] **步驟 1：寫失敗的測試**（注入假 deps，跑遍轉移）

```ts
// server/src/autonomyRunner.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, type AutonomyDeps } from "./autonomyRunner.js";
import { getRun, listPending, getActiveRunForSession } from "./store/autonomy.js";

// 可編程的假 agent：依序回傳預先排好的回合輸出。
function makeDeps(scripted: string[]): { deps: AutonomyDeps; sent: string[]; clock: { t: number } } {
  const sent: string[] = [];
  const clock = { t: 1000 };
  let i = 0;
  const deps: AutonomyDeps = {
    sendTurn: async (_sid, prompt) => { sent.push(prompt); return scripted[i++] ?? "=== ACTION ===\nkind: goal_done\nsummary: 收尾\n=== END ACTION ==="; },
    runDispatch: async () => "派工結果",
    now: () => clock.t,
    emit: () => {},
  };
  return { deps, sent, clock };
}

describe("autonomyRunner 狀態機", () => {
  it("規劃 → 等批計畫", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 三步計畫\ndetail: 1.a 2.b 3.c\n=== END ACTION ==="]);
    const runId = await startRun("sess1", "w1", "完成某任務", {}, deps);
    expect(getRun(runId)?.status).toBe("awaiting_plan_approval");
    expect(listPending("sess1").some((p) => p.kind === "plan")).toBe(true);
  });

  it("批計畫 → 逐步跑 → goal_done 結束", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: next_step\nsummary: 第一步完成\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess2", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("done");
    expect(getRun(runId)?.stepCount).toBeGreaterThanOrEqual(1);
  });

  it("遇到高風險動作 → paused_for_action，批准後續行", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: external_send\nrisk: high\nsummary: 寄信給客戶\ndetail: 內容…\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess3", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("paused_for_action");
    const pa = listPending("sess3").find((p) => p.kind === "external_send")!;
    expect(pa).toBeTruthy();
    await approveAction(pa.id);
    expect(getRun(runId)?.status).toBe("done");
  });

  it("拒絕高風險動作 → 指示替代、不殺 run", async () => {
    const { deps, sent } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: destructive\nsummary: 刪資料夾\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 改用別法達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess4", "w1", "g", {}, deps);
    await approvePlan(runId);
    const pa = listPending("sess4").find((p) => p.kind === "destructive")!;
    await rejectAction(pa.id);
    expect(getRun(runId)?.status).toBe("done");
    expect(sent.some((p) => p.includes("被拒") || p.includes("替代"))).toBe(true);
  });

  it("need_input → paused_for_input，provideInput 後續行", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: need_input\nsummary: 請問預算多少\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess5", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("paused_for_input");
    await provideInput(runId, "預算一萬");
    expect(getRun(runId)?.status).toBe("done");
  });

  it("步數預算用盡 → budget_exhausted", async () => {
    // 永遠回 next_step（不收斂）
    const loopStep = "=== ACTION ===\nkind: next_step\nsummary: 又一步\n=== END ACTION ===";
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      loopStep, loopStep, loopStep, loopStep, loopStep,
    ]);
    const runId = await startRun("sess6", "w1", "g", { maxSteps: 2 }, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("budget_exhausted");
  });

  it("時間預算用盡 → budget_exhausted", async () => {
    const loopStep = "=== ACTION ===\nkind: next_step\nsummary: 步\n=== END ACTION ===";
    const { deps, clock } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      loopStep, loopStep, loopStep,
    ]);
    // 每回合推進時鐘 → 第二步即超 deadline
    const orig = deps.sendTurn;
    deps.sendTurn = async (s, p) => { clock.t += 60_000; return orig(s, p); };
    const runId = await startRun("sess7", "w1", "g", { maxSteps: 99, maxWallMs: 90_000 }, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("budget_exhausted");
  });

  it("stopRun → stopped", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ==="]);
    const runId = await startRun("sess8", "w1", "g", {}, deps);
    await stopRun(runId);
    expect(getRun(runId)?.status).toBe("stopped");
    expect(getActiveRunForSession("sess8")).toBeUndefined();
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/autonomyRunner.test.ts`
預期：FAIL（模組不存在）

- [ ] **步驟 3：寫實作**

```ts
// server/src/autonomyRunner.ts
import { parseActions, type ParsedAction } from "./actionProtocol.js";
import type { DispatchItem } from "./dispatchParser.js";
import {
  createRun, getRun, updateRunStatus, incrementStep,
  createPendingAction, getPendingAction, decidePendingAction, markActionExecuted, getActiveRunForSession,
  type AutonomyRun, type PendingAction,
} from "./store/autonomy.js";

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_MAX_WALL_MS = 30 * 60 * 1000;

export interface AutonomyDeps {
  sendTurn: (sessionId: string, prompt: string) => Promise<string>;
  runDispatch: (items: DispatchItem[], workspaceId: string) => Promise<string>;
  now: () => number;
  emit: (runId: string, evt: { kind: "run" | "pending" | "action"; run?: AutonomyRun; action?: PendingAction }) => void;
}

export interface AutonomyEvent { kind: "run" | "pending" | "action"; run?: AutonomyRun; action?: PendingAction; }

// runId → 該 run 的 deps（供 approve/reject/input 續行時取用）
const activeDeps = new Map<string, AutonomyDeps>();

const PROTOCOL = `你正在「自主模式」下工作。請嚴格用以下標記與系統溝通，每次回覆**只輸出一個** ACTION 區塊放在最末尾：
=== ACTION ===
kind: <plan|next_step|goal_done|need_input|dispatch|external_send|destructive|spend>
risk: <high|low>
summary: <一句話>
detail: <細節，可多行>
=== END ACTION ===
規則：
- 四類動作必須先申報、等核可才可執行：dispatch（派工）、external_send（對外發訊息）、destructive（不可逆/破壞）、spend（花錢/交易/安裝）。**嚴禁**未經核可直接執行這四類。
- 每完成一步用 next_step 回報；全部達標用 goal_done；缺關鍵資訊用 need_input。`;

function emitRun(deps: AutonomyDeps, runId: string) {
  const run = getRun(runId);
  if (run) deps.emit(runId, { kind: "run", run });
}

function budgetExceeded(run: AutonomyRun, deps: AutonomyDeps): boolean {
  return run.stepCount >= run.maxSteps || deps.now() >= run.deadlineAt;
}

export async function startRun(
  sessionId: string, workspaceId: string, goal: string,
  opts: { maxSteps?: number; maxWallMs?: number } = {},
  deps: AutonomyDeps,
): Promise<string> {
  const run = createRun({
    sessionId, workspaceId, goal,
    maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
    maxWallMs: opts.maxWallMs ?? DEFAULT_MAX_WALL_MS,
  });
  activeDeps.set(run.id, deps);
  emitRun(deps, run.id);
  // 規劃回合
  const planPrompt = `${PROTOCOL}\n\n# 目標\n${goal}\n\n請先把目標拆成可執行的步驟計畫，用 kind: plan 輸出（risk: high）。先不要執行任何步驟。`;
  const out = await deps.sendTurn(sessionId, planPrompt);
  const plan = pickAction(parseActions(out), "plan");
  createPendingAction({
    runId: run.id, sessionId, workspaceId, kind: "plan", risk: "high",
    summary: plan?.summary ?? "執行計畫", detail: plan?.detail ?? out.slice(0, 2000),
  });
  updateRunStatus(run.id, "awaiting_plan_approval");
  emitRun(deps, run.id);
  deps.emit(run.id, { kind: "pending" });
  return run.id;
}

function pickAction(actions: ParsedAction[], prefer?: string): ParsedAction | undefined {
  if (prefer) { const p = actions.find((a) => a.kind === prefer); if (p) return p; }
  return actions[actions.length - 1]; // 取最後一個 ACTION（協議要求只輸出一個）
}

export async function approvePlan(runId: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "awaiting_plan_approval") return;
  updateRunStatus(runId, "running");
  emitRun(deps, runId);
  await loop(runId, deps, "計畫已核可，請開始執行第一步。");
}

/** 主迴圈：送一回合 → 解析動作 → 依 kind 轉移。高風險/need_input 會中止迴圈（等外部續行）。 */
async function loop(runId: string, deps: AutonomyDeps, firstPrompt: string): Promise<void> {
  let prompt = firstPrompt;
  while (true) {
    let run = getRun(runId);
    if (!run || run.status !== "running") return; // 被 stop / 已轉其他狀態
    if (budgetExceeded(run, deps)) { updateRunStatus(runId, "budget_exhausted"); emitRun(deps, runId); return; }

    const out = await deps.sendTurn(run.sessionId, `${PROTOCOL}\n\n${prompt}`);
    incrementStep(runId);
    const action = pickAction(parseActions(out));

    if (!action || action.kind === "next_step") {
      run = getRun(runId)!;
      if (budgetExceeded(run, deps)) { updateRunStatus(runId, "budget_exhausted"); emitRun(deps, runId); return; }
      prompt = "請繼續執行下一步，朝目標推進。";
      continue;
    }
    if (action.kind === "goal_done") { updateRunStatus(runId, "done"); emitRun(deps, runId); return; }
    if (action.kind === "need_input") {
      createPendingAction({ runId, sessionId: run.sessionId, workspaceId: run.workspaceId, kind: "need_input", risk: "low", summary: action.summary, detail: action.detail });
      updateRunStatus(runId, "paused_for_input"); emitRun(deps, runId); deps.emit(runId, { kind: "pending" });
      return;
    }
    // 高風險動作 → 入列、暫停等批
    const pa = createPendingAction({
      runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
      kind: action.kind, risk: "high", summary: action.summary, detail: action.detail,
    });
    // dispatch 的 items 存進 detail（已是原文）；approveAction 時重解析。
    updateRunStatus(runId, "paused_for_action"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
    return;
  }
}

export async function approveAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  const run = getRun(pa.runId);
  if (!deps || !run) return;
  decidePendingAction(actionId, "approved");
  let resultNote = "（已核可，請執行並用 next_step 回報結果）";
  if (pa.kind === "dispatch") {
    const items = parseActions(`=== ACTION ===\nkind: dispatch\ndetail:\n${pa.detail ?? ""}\n=== END ACTION ===`)[0]?.dispatchItems ?? [];
    const out = items.length ? await deps.runDispatch(items, run.workspaceId) : "（無有效派工項）";
    markActionExecuted(actionId, out);
    resultNote = `派工結果：\n${out.slice(0, 4000)}\n請據此用 next_step 繼續。`;
  } else {
    markActionExecuted(actionId, "已核可");
  }
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, resultNote);
}

export async function rejectAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  if (!deps) return;
  decidePendingAction(actionId, "rejected");
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, `你剛申報的動作「${pa.summary}」被拒絕，請改用替代方案，或若無替代則用 goal_done 收尾並說明。`);
}

export async function provideInput(runId: string, text: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "paused_for_input") return;
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, `使用者補充資訊：${text}\n請據此繼續。`);
}

export async function stopRun(runId: string): Promise<void> {
  const deps = activeDeps.get(runId);
  updateRunStatus(runId, "stopped");
  if (deps) emitRun(deps, runId);
  activeDeps.delete(runId);
}

/** 重啟安全：開機把所有未結束 run 轉 paused（不自動續跑副作用迴圈）。 */
export function pauseRunningRunsOnBoot(listActiveRuns: () => AutonomyRun[]): number {
  const active = listActiveRuns();
  for (const r of active) updateRunStatus(r.id, "paused");
  return active.length;
}

/** paused → running 續跑（重啟後使用者選擇續跑）。需重新提供 deps。 */
export async function resumeRun(runId: string, deps: AutonomyDeps): Promise<void> {
  const run = getRun(runId);
  if (!run || run.status !== "paused") return;
  activeDeps.set(runId, deps);
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, "（已從中斷處恢復）請接續朝目標執行下一步。");
}
```

> 設計備註：`activeDeps` 是記憶體態；重啟後遺失 → 故 `pauseRunningRunsOnBoot` 把 run 轉 `paused`，使用者按「續跑」時由 route 重新組 deps 呼叫 `resumeRun`。測試直接傳 deps，不依賴重啟。

- [ ] **步驟 4：跑測試確認通過**

執行：`cd server && npx vitest run src/autonomyRunner.test.ts`
預期：PASS（8 案例全綠）

- [ ] **步驟 5：Commit**

```bash
git add server/src/autonomyRunner.ts server/src/autonomyRunner.test.ts
git commit -m "feat(autonomy): 自主迴圈狀態機 autonomyRunner（注入式依賴，可測）"
```

---

### 任務 5：REST routes + socket + 預設依賴接線

**檔案：**
- 創建：`server/src/routes/autonomy.ts`
- 修改：`server/src/index.ts`（掛 `app.use("/api/autonomy", autonomyRouter)`；boot 區呼叫 `pauseRunningRunsOnBoot`）
- 測試：`server/src/app.test.ts`（加 autonomy 端點案例，沿用 ephemeral 埠模式）
- 參考：`routes/sessions.ts`（`req.app.get("io")`、`agentManager`）；`dispatchRunner.ts`（`runConsult`）

**預設依賴（接 agentManager）：** `sendTurn` 送一回合並等該回合 `result` 事件後回 final 文字；`runDispatch` 包既有 `runConsult`。

- [ ] **步驟 1：寫失敗的測試**（加到 `app.test.ts`）

```ts
it("POST /api/autonomy/runs 非 claude session → 400", async () => {
  const sid = `test_codex_${Date.now()}`;
  upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "x", title: "t", provider: "codex", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  createdSessionIds.push(sid);
  const r = await fetch(`${base}/api/autonomy/runs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, goal: "做事" }),
  });
  expect(r.status).toBe(400);
});

it("GET /api/autonomy/sessions/:sid/run 無 run → null", async () => {
  const r = await fetch(`${base}/api/autonomy/sessions/__none__/run`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ run: null });
});

it("POST /api/autonomy/runs 不存在 session → 404", async () => {
  const r = await fetch(`${base}/api/autonomy/runs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "__missing__", goal: "g" }),
  });
  expect(r.status).toBe(404);
});

it("POST /api/autonomy/runs goal 空 → 400", async () => {
  const sid = `test_claude_${Date.now()}`;
  upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  createdSessionIds.push(sid);
  const r = await fetch(`${base}/api/autonomy/runs`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, goal: "  " }),
  });
  expect(r.status).toBe(400);
});
```

> 註：不在 smoke 測試裡真的跑 claude 回合（會 spawn）。狀態機行為已在任務 4 用注入 deps 完整覆蓋；此處只驗 route 守衛（400/404/null）。

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/app.test.ts`
預期：FAIL（404 路由不存在 → 收到 404 但其他案例如 400 會失敗 / 或路由整段不存在）

- [ ] **步驟 3：寫實作**

```ts
// server/src/routes/autonomy.ts
import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { getSession } from "../store.js";
import { runConsult } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import {
  startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, resumeRun, type AutonomyDeps,
} from "../autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending, getPendingAction } from "../store/autonomy.js";

export const autonomyRouter = Router();

const DISPATCH_CONCURRENCY = 3;
const CONSULT_TIMEOUT_MS = 5 * 60 * 1000;

/** 建立連到 agentManager + socket 的真實依賴。io 由 caller 傳入（req.app.get("io")）。 */
function makeDeps(io: any): AutonomyDeps {
  return {
    sendTurn: (sessionId, prompt) => new Promise<string>((resolve) => {
      const s = agentManager.get(sessionId) || agentManager.reattach(sessionId);
      if (!s) return resolve("");
      let collected = "", streamed = "", settled = false;
      const finish = () => {
        if (settled) return; settled = true;
        s.removeListener("event", onEvent);
        resolve((collected || streamed).trim());
      };
      const onEvent = (evt: any) => {
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
        else if (evt.type === "result") finish();
        else if (evt.type === "error") finish();
      };
      s.on("event", onEvent);
      agentManager.send(sessionId, prompt);
    }),
    runDispatch: async (items: DispatchItem[], workspaceId: string) => {
      const res = await runConsult(items, workspaceId, { concurrency: DISPATCH_CONCURRENCY, perItemTimeoutMs: CONSULT_TIMEOUT_MS });
      return res.map((r) => `### ${r.agentId}（${r.status}）\n${r.output || "（無回覆）"}`).join("\n\n");
    },
    now: () => Date.now(),
    emit: (runId, evt) => { io?.emit("autonomy:event", { runId, ...evt }); },
  };
}

autonomyRouter.post("/runs", async (req, res) => {
  const { sessionId, goal, maxSteps, maxWallMs } = req.body || {};
  if (!sessionId || typeof goal !== "string" || !goal.trim()) return res.status(400).json({ error: "需要 sessionId 與非空 goal" });
  const sess = getSession(sessionId);
  if (!sess) return res.status(404).json({ error: "session 不存在" });
  if (sess.provider !== "claude") return res.status(400).json({ error: "自主迴圈本期僅支援 claude provider" });
  if (getActiveRunForSession(sessionId)) return res.status(409).json({ error: "此 session 已有進行中的 run" });
  const deps = makeDeps(req.app.get("io"));
  // 不 await 整段迴圈（規劃回合可能數十秒）；startRun 內部只跑到 awaiting_plan_approval。
  const runId = await startRun(sessionId, sess.workspaceId, goal.trim(), { maxSteps, maxWallMs }, deps);
  res.json({ runId });
});

autonomyRouter.get("/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "run 不存在" });
  res.json({ run, pending: listPending(run.sessionId) });
});

autonomyRouter.get("/sessions/:sid/run", (req, res) => {
  res.json({ run: getActiveRunForSession(req.params.sid) ?? null });
});

autonomyRouter.get("/sessions/:sid/pending", (req, res) => {
  res.json({ pending: listPending(req.params.sid) });
});

autonomyRouter.post("/runs/:id/approve-plan", async (req, res) => {
  approvePlan(req.params.id).catch((e) => console.warn("[autonomy] approvePlan", e?.message)); // 背景跑迴圈
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/stop", async (req, res) => { await stopRun(req.params.id); res.json({ ok: true }); });
autonomyRouter.post("/runs/:id/resume", async (req, res) => {
  resumeRun(req.params.id, makeDeps(req.app.get("io"))).catch((e) => console.warn("[autonomy] resume", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/input", async (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text 不可空" });
  provideInput(req.params.id, text).catch((e) => console.warn("[autonomy] input", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/approve", async (req, res) => {
  if (!getPendingAction(req.params.id)) return res.status(404).json({ error: "action 不存在" });
  approveAction(req.params.id).catch((e) => console.warn("[autonomy] approveAction", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/reject", async (req, res) => {
  if (!getPendingAction(req.params.id)) return res.status(404).json({ error: "action 不存在" });
  rejectAction(req.params.id).catch((e) => console.warn("[autonomy] rejectAction", e?.message));
  res.json({ ok: true });
});
```

- [ ] **步驟 4：掛載 + 重啟安全（index.ts）**

在 import 區加：
```ts
import { autonomyRouter } from "./routes/autonomy.js";
import { pauseRunningRunsOnBoot } from "./autonomyRunner.js";
import { listActiveRuns } from "./store/autonomy.js";
```
在其他 `app.use("/api/...", ...)` 附近加：
```ts
app.use("/api/autonomy", autonomyRouter);
```
在 boot 區（`resumeUnfinishedRuns(...)` 附近）加：
```ts
const pausedCount = pauseRunningRunsOnBoot(listActiveRuns);
if (pausedCount) console.log(`[autonomy] 重啟：${pausedCount} 個 run 轉為 paused（待使用者續跑/停止）`);
```

- [ ] **步驟 5：跑測試確認通過 + commit**

執行：`cd server && npx vitest run src/app.test.ts`
預期：PASS（新 autonomy 案例綠，既有案例不回歸）

```bash
git add server/src/routes/autonomy.ts server/src/index.ts server/src/app.test.ts
git commit -m "feat(autonomy): /api/autonomy routes + socket + 重啟安全接線"
```

---

### 任務 6：手動派工遷移到 server 佇列 ★ 用 Opus（最高風險，動到既有可跑程式碼）

**檔案：**
- 修改：`server/src/routes/sessions.ts`（抽出 `executeDispatch` 共用函式；舊 `/orchestrator/:id/dispatch` 改呼叫它，保留為相容包裝）
- 修改：`server/src/agentManager.ts`（`attachPersistence` 的 `message` 分支加 server 端派工偵測 → 入 `pending_actions`，但「該 session 有 active autonomy run」時跳過）
- 修改：`server/src/routes/autonomy.ts`（`/actions/:id/approve` 對 `kind==="dispatch"` 且 `runId` 為空（手動派工）時呼叫 `executeDispatch`）
- 修改（client）：`client/src/hooks/useDispatch.ts` + `client/src/components/ChatWindow.tsx` + `client/src/lib/dispatchDetection.ts`：移除 localStorage 指紋追蹤，改用 server `pending` 狀態（任務 7 一併處理前端，此任務先確保 server 端佇列正確）
- 測試：`server/src/dispatchMigration.test.ts`（新）、調整 `server/src/app.test.ts` 既有 dispatch 案例

**關鍵：** 不改 PM 輸出格式（仍 `=== DISPATCH ===`）、不改 `dispatchParser`/`dispatchRunner` 執行邏輯，只把「偵測 + 已派工狀態」從 client 搬到 server。

- [ ] **步驟 1：寫失敗的測試**

```ts
// server/src/dispatchMigration.test.ts
import { describe, it, expect } from "vitest";
import { detectAndEnqueueDispatch } from "./agentManager.js";
import { listPending } from "./store/autonomy.js";

describe("手動派工 server 端偵測入列", () => {
  it("PM 訊息含 DISPATCH → 寫 pending_actions(kind=dispatch, runId 空)", () => {
    const sid = `pm_${Date.now()}`;
    const content = "我想請教兩位。\n=== DISPATCH ===\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END DISPATCH ===";
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    const pend = listPending(sid);
    expect(pend).toHaveLength(1);
    expect(pend[0].kind).toBe("dispatch");
    expect(pend[0].runId).toBeUndefined();
  });
  it("非 PM agent 不入列", () => {
    const sid = `x_${Date.now()}`;
    detectAndEnqueueDispatch({ id: sid, agentId: "marketing-content-creator", workspaceId: "w1" }, "=== DISPATCH ===\n- agentId: x\n  task: y\n=== END DISPATCH ===");
    expect(listPending(sid)).toHaveLength(0);
  });
  it("同一輪 DISPATCH 重複偵測不重複入列（指紋去重）", () => {
    const sid = `pm2_${Date.now()}`;
    const content = "=== DISPATCH ===\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END DISPATCH ===";
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    expect(listPending(sid)).toHaveLength(1);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/dispatchMigration.test.ts`
預期：FAIL（`detectAndEnqueueDispatch` 未匯出）

- [ ] **步驟 3：實作 server 端偵測**（`agentManager.ts`）

加入並匯出（module 級，供測試與 attachPersistence 共用）：
```ts
import { parseDispatchMarker } from "./dispatchParser.js";
import { createPendingAction, listPending, getActiveRunForSession } from "./store/autonomy.js";

/** 從 PM 訊息偵測 DISPATCH 並入待批佇列（手動派工，runId 空）。去重：同 session 已有相同 summary 的 pending 則跳過。 */
export function detectAndEnqueueDispatch(
  sess: { id: string; agentId: string; workspaceId: string },
  content: string,
): void {
  if (sess.agentId !== "agents-orchestrator") return;
  if (getActiveRunForSession(sess.id)) return; // 有自主 run → 交給 runner，避免雙重入列
  const plan = parseDispatchMarker(content);
  if (!plan || !plan.items.length) return;
  const summary = `派工給 ${plan.items.length} 位：${plan.items.map((i) => i.agentId).join("、")}`;
  // 去重：同 session 已有相同 summary 的 pending dispatch 則不重複建立。
  if (listPending(sess.id).some((p) => p.kind === "dispatch" && p.summary === summary)) return;
  createPendingAction({
    sessionId: sess.id, workspaceId: sess.workspaceId, kind: "dispatch", risk: "high",
    summary,
    detail: plan.items.map((i) => `- agentId: ${i.agentId}\n  mode: ${i.mode}\n  task: ${i.task}`).join("\n"),
  });
}
```

在 `attachPersistence` 的 `evt.type === "message"` 分支（持久化 assistant 訊息之後、LEARN 偵測附近）加：
```ts
const wsForDispatch = (s as any).workspaceId as string | undefined;
if (wsForDispatch) {
  try { detectAndEnqueueDispatch({ id: s.id, agentId: s.agentId, workspaceId: wsForDispatch }, String(evt.payload.content)); }
  catch (e: any) { console.warn("[agentManager] detectAndEnqueueDispatch", e?.message); }
}
```

- [ ] **步驟 4：抽出 `executeDispatch` 並接到 approve**（`routes/sessions.ts`）

把 `/orchestrator/:sessionId/dispatch` 路由 body 內「跑 consult/execute + 餵回 PM」邏輯抽成匯出函式：
```ts
export async function executeDispatch(pmSessionId: string, items: DispatchItem[], io: any): Promise<{ consulted: any[]; executing: any[] }> {
  // …（搬移既有 route body 的 consult/execute 邏輯，io 改為參數）
}
```
舊 route 改為：驗證 → `const out = await executeDispatch(pmSessionId, items, req.app.get("io")); res.json(out);`（行為不變、相容保留）。

在 `routes/autonomy.ts` 的 `/actions/:id/approve` handler：取出 action，若 `kind==="dispatch"` 且 `runId` 為空（手動派工）→ 解析 detail items → 呼叫 `executeDispatch(pa.sessionId, items, io)` → `markActionExecuted`。（自主 run 的 dispatch 仍走 `approveAction`→`runDispatch`。）

> 實作者注意：`approve` handler 需先判斷 `pa.runId` 有無，分流到 `approveAction`（自主）或 `executeDispatch`（手動）。

- [ ] **步驟 5：跑全套 + commit**

執行：`cd server && npm test`
預期：PASS（新遷移測試綠；既有 dispatch 相關測試調整後綠；無回歸）

```bash
git add server/src/agentManager.ts server/src/routes/sessions.ts server/src/routes/autonomy.ts server/src/dispatchMigration.test.ts server/src/app.test.ts
git commit -m "feat(autonomy): 手動派工遷移到 server 待批佇列（根治重複跳卡）"
```

---

### 任務 7：前端（api + hook + 卡片一般化 + 自主面板 + ChatWindow 接線）

**檔案：**
- 修改：`client/src/lib/api.ts`（型別 `AutonomyRun`/`PendingAction` + 端點封裝）
- 創建：`client/src/hooks/useAutonomy.ts`
- 創建：`client/src/components/ActionApprovalCard.tsx`（一般化）
- 創建：`client/src/components/AutonomyPanel.tsx`
- 修改：`client/src/components/ChatWindow.tsx`（接 useAutonomy；用 ActionApprovalCard 渲染 server pending；移除 useDispatch localStorage 路徑）
- 修改：`client/src/hooks/useChatSession.ts`（訂閱 `autonomy:event` socket）
- 測試：`client/src/components/ActionApprovalCard.test.tsx`、`client/src/components/AutonomyPanel.test.tsx`
- 參考：`client/src/components/DispatchApprovalCard.tsx`、`client/src/hooks/useDispatch.ts`、`client/src/lib/socket.ts`、既有 `WorkspaceSwitcher.test.tsx`（render/fireEvent 範例）

- [ ] **步驟 1：api.ts 型別與端點**（先寫，無測試——純宣告）

```ts
export interface AutonomyRun { id: string; sessionId: string; workspaceId: string; goal: string; status: string; stepCount: number; maxSteps: number; startedAt: number; deadlineAt: number; }
export interface PendingAction { id: string; runId?: string; sessionId: string; kind: string; risk: string; summary: string; detail?: string; status: string; }
// api 物件內加：
autonomyStart: (sessionId: string, goal: string) => fetch("/api/autonomy/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, goal }) }).then(j<{ runId: string }>),
autonomyRun: (sid: string) => fetch(`/api/autonomy/sessions/${sid}/run`).then(j<{ run: AutonomyRun | null }>),
autonomyPending: (sid: string) => fetch(`/api/autonomy/sessions/${sid}/pending`).then(j<{ pending: PendingAction[] }>),
autonomyApprovePlan: (runId: string) => fetch(`/api/autonomy/runs/${runId}/approve-plan`, { method: "POST" }).then(j),
autonomyStop: (runId: string) => fetch(`/api/autonomy/runs/${runId}/stop`, { method: "POST" }).then(j),
autonomyResume: (runId: string) => fetch(`/api/autonomy/runs/${runId}/resume`, { method: "POST" }).then(j),
autonomyInput: (runId: string, text: string) => fetch(`/api/autonomy/runs/${runId}/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).then(j),
actionApprove: (id: string) => fetch(`/api/autonomy/actions/${id}/approve`, { method: "POST" }).then(j),
actionReject: (id: string) => fetch(`/api/autonomy/actions/${id}/reject`, { method: "POST" }).then(j),
```
（`j`/`j<T>` 為既有 helper；對齊 api.ts 現有寫法。）

- [ ] **步驟 2：ActionApprovalCard 測試（失敗）**

```tsx
// client/src/components/ActionApprovalCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionApprovalCard } from "./ActionApprovalCard";

describe("ActionApprovalCard", () => {
  it("dispatch kind 顯示 summary 與批准鈕", () => {
    const onApprove = vi.fn();
    render(<ActionApprovalCard action={{ id: "a1", kind: "dispatch", risk: "high", summary: "派工給 2 位", status: "pending", sessionId: "s" }} busy={false} onApprove={onApprove} onReject={() => {}} />);
    expect(screen.getByText(/派工給 2 位/)).toBeTruthy();
    fireEvent.click(screen.getByText(/核可|批准|執行/));
    expect(onApprove).toHaveBeenCalled();
  });
  it("external_send 顯示高風險標記與細節", () => {
    render(<ActionApprovalCard action={{ id: "a2", kind: "external_send", risk: "high", summary: "寄信", detail: "給客戶", status: "pending", sessionId: "s" }} busy={false} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/寄信/)).toBeTruthy();
    expect(screen.getByText(/給客戶/)).toBeTruthy();
  });
  it("拒絕鈕觸發 onReject", () => {
    const onReject = vi.fn();
    render(<ActionApprovalCard action={{ id: "a3", kind: "spend", risk: "high", summary: "付款", status: "pending", sessionId: "s" }} busy={false} onApprove={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText(/拒絕|取消/));
    expect(onReject).toHaveBeenCalled();
  });
});
```

- [ ] **步驟 3：ActionApprovalCard 實作**

```tsx
// client/src/components/ActionApprovalCard.tsx
import type { PendingAction } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  plan: "執行計畫", dispatch: "派工", external_send: "對外發送", destructive: "破壞性操作",
  spend: "花費/交易", need_input: "需要補充", next_step: "下一步", goal_done: "完成",
};

export function ActionApprovalCard({ action, busy, onApprove, onReject }: {
  action: PendingAction; busy: boolean; onApprove: () => void; onReject: () => void;
}) {
  const high = action.risk === "high";
  return (
    <div className={`mb-2 rounded border p-3 text-xs ${high ? "border-amber-600/50 bg-amber-950/30" : "border-sky-700/50 bg-sky-950/30"}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 ${high ? "bg-amber-600/30 text-amber-300" : "bg-sky-600/30 text-sky-300"}`}>{KIND_LABEL[action.kind] ?? action.kind}</span>
        {high && <span className="text-amber-400">⚠ 高風險，需核可</span>}
      </div>
      <div className="mb-1 text-zinc-200">{action.summary}</div>
      {action.detail && <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-400">{action.detail}</pre>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={onApprove} className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40">{busy ? "處理中…" : "✅ 核可"}</button>
        <button disabled={busy} onClick={onReject} className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40">拒絕</button>
      </div>
    </div>
  );
}
```

- [ ] **步驟 4：useAutonomy hook**

```ts
// client/src/hooks/useAutonomy.ts
import { useCallback, useEffect, useState } from "react";
import { api, type AutonomyRun, type PendingAction } from "../lib/api";
import { getSocket } from "../lib/socket";

export function useAutonomy(sessionId: string) {
  const [run, setRun] = useState<AutonomyRun | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [{ run }, { pending }] = await Promise.all([api.autonomyRun(sessionId), api.autonomyPending(sessionId)]);
    setRun(run); setPending(pending);
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const sock = getSocket();
    const handler = (evt: { runId: string }) => { void refresh(); }; // 任何 autonomy 事件都重抓（簡單可靠）
    sock.on("autonomy:event", handler);
    return () => { sock.off("autonomy:event", handler); };
  }, [refresh]);

  const start = async (goal: string) => { setBusy(true); try { await api.autonomyStart(sessionId, goal); await refresh(); } finally { setBusy(false); } };
  const approvePlan = async () => { if (run) { setBusy(true); try { await api.autonomyApprovePlan(run.id); await refresh(); } finally { setBusy(false); } } };
  const stop = async () => { if (run) { await api.autonomyStop(run.id); await refresh(); } };
  const resume = async () => { if (run) { await api.autonomyResume(run.id); await refresh(); } };
  const sendInput = async (text: string) => { if (run) { await api.autonomyInput(run.id, text); await refresh(); } };
  const approveAction = async (id: string) => { setBusy(true); try { await api.actionApprove(id); await refresh(); } finally { setBusy(false); } };
  const rejectAction = async (id: string) => { setBusy(true); try { await api.actionReject(id); await refresh(); } finally { setBusy(false); } };

  return { run, pending, busy, start, approvePlan, stop, resume, sendInput, approveAction, rejectAction };
}
```

- [ ] **步驟 5：AutonomyPanel 測試 + 實作**

測試（`AutonomyPanel.test.tsx`）：渲染「設定目標」輸入與「開始」鈕；`run` 為 `running` 時顯示「第 N 步 / 上限」與「喊停」鈕；`run` 為 `awaiting_plan_approval` 時顯示「核可計畫」。實作為一個受控元件，props 取自 `useAutonomy` 回傳值（panel 本身不呼叫 hook，便於測試）：

```tsx
// client/src/components/AutonomyPanel.tsx
import { useState } from "react";
import type { AutonomyRun } from "../lib/api";

export function AutonomyPanel({ run, busy, onStart, onApprovePlan, onStop, onResume, onInput }: {
  run: AutonomyRun | null; busy: boolean;
  onStart: (goal: string) => void; onApprovePlan: () => void; onStop: () => void; onResume: () => void; onInput: (t: string) => void;
}) {
  const [goal, setGoal] = useState("");
  const [input, setInput] = useState("");
  if (!run || ["done", "stopped", "budget_exhausted", "error"].includes(run.status)) {
    return (
      <div className="rounded border border-zinc-700 p-2 text-xs">
        <div className="mb-1 text-zinc-300">🎯 自主模式：給一個目標，agent 會自己拆步驟、逐步執行（高風險動作會先問你）。</div>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：盤點本週三大平台熱門選題並整理成提案草稿" className="mb-1 w-full rounded bg-zinc-900 p-2 text-zinc-100" rows={2} />
        <button disabled={busy || !goal.trim()} onClick={() => onStart(goal.trim())} className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-40">開始自主執行</button>
      </div>
    );
  }
  return (
    <div className="rounded border border-emerald-700/50 bg-emerald-950/20 p-2 text-xs">
      <div className="mb-1 text-zinc-200">🎯 {run.goal}</div>
      <div className="mb-2 text-zinc-400">狀態：{run.status} · 第 {run.stepCount}/{run.maxSteps} 步</div>
      {run.status === "awaiting_plan_approval" && <button disabled={busy} onClick={onApprovePlan} className="mr-2 rounded bg-sky-700 px-3 py-1 text-white disabled:opacity-40">核可計畫並開跑</button>}
      {run.status === "paused" && <button disabled={busy} onClick={onResume} className="mr-2 rounded bg-sky-700 px-3 py-1 text-white">續跑</button>}
      {run.status === "paused_for_input" && (
        <div className="my-1 flex gap-1">
          <input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 rounded bg-zinc-900 p-1" placeholder="補充資訊…" />
          <button disabled={busy || !input.trim()} onClick={() => { onInput(input.trim()); setInput(""); }} className="rounded bg-sky-700 px-2 text-white">送出</button>
        </div>
      )}
      <button disabled={busy} onClick={onStop} className="rounded bg-rose-800 px-3 py-1 text-white">喊停</button>
    </div>
  );
}
```

- [ ] **步驟 6：ChatWindow 接線（移除舊 localStorage 路徑）**

- 引入 `useAutonomy(sessionId)`；在訊息區上方渲染 `<AutonomyPanel .../>`。
- 把 `pending` 陣列逐筆用 `<ActionApprovalCard action={p} ... onApprove={() => approveAction(p.id)} onReject={() => rejectAction(p.id)} />` 渲染（取代 `detectDispatch` + `DispatchApprovalCard` 的 client 偵測）。
- 移除 `useDispatch` 的 localStorage 分支使用（hook 可保留 `consultRaw` 顯示，但「是否顯示卡」改由 server `pending` 決定）。
- `useChatSession`：在既有 socket 訂閱旁加對 `autonomy:event` 的轉發（或讓 `useAutonomy` 自行訂閱，如步驟 4——二擇一，避免重複）。

- [ ] **步驟 7：跑前端測試 + build + commit**

執行：`cd client && npm test && npm run build`
預期：PASS（新卡片/面板測試綠）+ build 成功

```bash
git add client/src/lib/api.ts client/src/hooks/useAutonomy.ts client/src/hooks/useChatSession.ts client/src/components/ActionApprovalCard.tsx client/src/components/AutonomyPanel.tsx client/src/components/ChatWindow.tsx client/src/components/ActionApprovalCard.test.tsx client/src/components/AutonomyPanel.test.tsx
git commit -m "feat(autonomy): 前端自主面板 + 通用行動核可卡 + server 權威派工卡"
```

---

### 任務 8：清理與全套驗證

**檔案：**
- 修改/刪除：`client/src/lib/dispatchDetection.ts` 的 localStorage 相關（`dispatchFingerprint`/`dispatchStorageKey`）若已無引用則刪；保留 `detectDispatch` 若他處仍用，否則一併清。
- 確認 `server/src/store.ts` barrel 匯出無重複。

- [ ] **步驟 1：搜尋殘留引用**

執行：`cd client && npx tsc --noEmit`（找出移除後的型別斷裂）；`grep -rn "dispatchStorageKey\|dispatchFingerprint" client/src` 確認無殘留引用後刪除死碼。

- [ ] **步驟 2：全套測試**

執行：`cd server && npm test` → 預期全綠
執行：`cd client && npm test && npm run build` → 預期全綠 + build OK

- [ ] **步驟 3：Commit**

```bash
git add -A
git commit -m "chore(autonomy): 清理舊 client 派工追蹤死碼 + 全套驗證綠"
```

---

### 任務 9：最終 Opus 統一審查

由 subagent-driven-development 流程在所有任務完成後分派 Opus 最終審查者，覆蓋整支分支，重點：
- 狀態機所有轉移與邊界（預算競態、`activeDeps` 記憶體態遺失、重啟 paused/resume 路徑）
- 派工遷移無回歸（手動派工 UX 等價、不重複跳卡）
- 軟約束誠實性（高風險僅靠 prompt 申報）
- 併發：同一 session 同時只允許一個 active run（route 409 守衛）
- socket 事件不漏/不風暴

審查通過後 → `finishing-a-development-branch`（合併回 main）。

---

## 自檢結果

**1. 規格覆蓋度：** 規格 §3 協議→任務1；§4 資料層→任務2/3；§5 runner→任務4；§6 REST/socket→任務5；§7 派工遷移→任務6；§8 前端→任務7；§9 系統提示→任務4（in-band PROTOCOL，已註明取代系統提示注入）；§10 錯誤/重啟→任務4(`pauseRunningRunsOnBoot`/`resumeRun`)+任務5(boot 接線)；§11 測試→各任務 TDD；§12 順序→任務 1-9。✅ 全覆蓋。

**2. 占位符掃描：** 各步驟均含實際程式碼與精確路徑/指令。任務 6 步驟 4 `executeDispatch` 為「搬移既有 route body」——已明確指出來源與簽名（非占位）。✅

**3. 型別一致性：** `ParsedAction`/`AutonomyRun`/`PendingAction`/`RunStatus`/`AutonomyDeps`/`ActionKind` 跨任務一致；函式名 `startRun/approvePlan/approveAction/rejectAction/provideInput/stopRun/resumeRun/pauseRunningRunsOnBoot`、store `createRun/getRun/updateRunStatus/incrementStep/listActiveRuns/getActiveRunForSession/createPendingAction/getPendingAction/listPending/decidePendingAction/markActionExecuted` 前後對齊。✅

**已知取捨（已在文件標明）：** ACTION 協議走 in-band prompt 而非系統提示（reattach 限制）；高風險為軟約束；自主迴圈僅 claude；`activeDeps` 記憶體態以 paused+resume 補償。
