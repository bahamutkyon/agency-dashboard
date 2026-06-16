# PM 自走迴圈 + 護欄 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓 PM（`agents-orchestrator`）對「多步目標」自動進入自走迴圈——派工/收回報後自己決定下一步，低風險動作自動放行、高風險才攔、到上限安全停下，且使用者可隨時停或插話。

**架構：** 複用既有 `autonomyRunner.ts` 自主迴圈。新增一個「放行政策」層（`balanced` 自動放行 `{plan, dispatch}`、攔 `{external_send, destructive, spend}`；既有 `manual` 維持全攔以向後相容）。自走由 client 偵測 PM 輸出的 `[[SELF_WALK]]` 標記後，呼叫既有 `POST /api/autonomy/runs`（多帶 `policy` 與 ceilings）啟動，避開 server 端循環依賴。插話用新欄位 `pending_injection` + 端點，loop 每輪消化。停沿用既有 `stopRun`。

**技術棧：** Node 24 + TypeScript（ESM，import 帶 `.js`）、`node:sqlite`、Express、vitest（server `npm test = tsc --noEmit && vitest`，singleFork）、React + Vite（client）。

---

## 檔案結構（建立/修改的職責）

- **建立** `server/src/autonomyPolicy.ts` — 放行政策純函式（`PolicyName`、`shouldAutoApprove`）。單一職責、易測。
- **修改** `server/src/dbSchema.ts` — `autonomy_runs` 加 `policy`、`pending_injection` 兩欄（BASE_SCHEMA + idempotent migration）。
- **修改** `server/src/store/autonomy.ts` — `AutonomyRun` 型別加兩欄；`createRun` 收 `policy`；`rowToRun` 映射；新增 `setPendingInjection` / `clearPendingInjection`。
- **修改** `server/src/autonomyRunner.ts` — `startRun` 收 `policy` 並對自動放行的 plan 跳過批准；`loop` 加自動放行分支 + 每輪消化插話；抽 `runDispatchAndNote` 共用 helper（DRY）。
- **修改** `server/src/routes/autonomy.ts` — `POST /runs` 收 `policy`；新增 `POST /runs/:id/inject`。
- **修改** `server/src/routes/sessions.ts` — PM system prompt 增「目標/問題分類 + `[[SELF_WALK]]`」段。
- **建立** `server/src/autonomyPolicy.test.ts`、`server/src/autonomyRunner.selfwalk.test.ts` — 單元測試。
- **修改** `server/src/app.test.ts` — 加 `POST /runs`(policy) 與 `inject` 端點測試。
- **修改** client：`client/src/hooks/useChatSession.ts`（偵測 `[[SELF_WALK]]` → 啟動 run）、PM 聊天容器（顯示自走面板 + 停/插話）。沿用既有 `AutonomyPanel.tsx`。

---

### 任務 1：放行政策模組（autonomyPolicy.ts）

**文件：**
- 創建：`server/src/autonomyPolicy.ts`
- 測試：`server/src/autonomyPolicy.test.ts`

- [ ] **步驟 1：編寫失敗的測試**

```ts
// server/src/autonomyPolicy.test.ts
import { describe, it, expect } from "vitest";
import { shouldAutoApprove, type PolicyName } from "./autonomyPolicy.js";

describe("shouldAutoApprove", () => {
  it("balanced 自動放行 plan 與 dispatch", () => {
    expect(shouldAutoApprove("plan", "balanced")).toBe(true);
    expect(shouldAutoApprove("dispatch", "balanced")).toBe(true);
  });
  it("balanced 攔 external_send / spend / destructive", () => {
    expect(shouldAutoApprove("external_send", "balanced")).toBe(false);
    expect(shouldAutoApprove("spend", "balanced")).toBe(false);
    expect(shouldAutoApprove("destructive", "balanced")).toBe(false);
  });
  it("manual 全攔（向後相容既有 autonomy）", () => {
    for (const k of ["plan", "dispatch", "external_send", "spend", "destructive"] as const) {
      expect(shouldAutoApprove(k, "manual")).toBe(false);
    }
  });
  it("conservative 只放行 plan；free 額外放行 destructive", () => {
    expect(shouldAutoApprove("dispatch", "conservative")).toBe(false);
    expect(shouldAutoApprove("plan", "conservative")).toBe(true);
    expect(shouldAutoApprove("destructive", "free")).toBe(true);
    expect(shouldAutoApprove("external_send", "free")).toBe(false);
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/autonomyPolicy.test.ts`
預期：FAIL，報錯 "Cannot find module './autonomyPolicy.js'"。

- [ ] **步驟 3：編寫最少實現代碼**

```ts
// server/src/autonomyPolicy.ts
import type { ActionKind } from "./actionProtocol.js";

// manual = 既有 autonomy 行為（全部需人工核可、plan 需批准）。
// balanced = 本階段預設：自動放行 plan + dispatch；對外發送/花錢/破壞性仍需批准。
// conservative / free 先定義備用，本階段不接 UI。
export type PolicyName = "manual" | "conservative" | "balanced" | "free";

const AUTO_APPROVE: Record<PolicyName, ActionKind[]> = {
  manual: [],
  conservative: ["plan"],
  balanced: ["plan", "dispatch"],
  free: ["plan", "dispatch", "destructive"],
};

export function shouldAutoApprove(kind: ActionKind, policy: PolicyName): boolean {
  return AUTO_APPROVE[policy].includes(kind);
}

export function isPolicyName(s: unknown): s is PolicyName {
  return s === "manual" || s === "conservative" || s === "balanced" || s === "free";
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/autonomyPolicy.test.ts`
預期：PASS（4 個 it 全綠）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/autonomyPolicy.ts server/src/autonomyPolicy.test.ts
git commit -m "feat(autonomy): add auto-approve policy module"
```

---

### 任務 2：autonomy_runs 加 policy / pending_injection 欄位

**文件：**
- 修改：`server/src/dbSchema.ts:224-238`（autonomy_runs CREATE TABLE）、`server/src/dbSchema.ts:316-356`（applyMigrations 尾段）
- 測試：沿用 `server/src/dbSchema.test.ts`（若存在）或在任務 5 的迴圈測試間接覆蓋；本任務以「型別 + 啟動不報錯」為驗收。

- [ ] **步驟 1：改 BASE_SCHEMA**

在 `server/src/dbSchema.ts` 的 `autonomy_runs` 定義（第 224-238 行）裡，`updated_at INTEGER NOT NULL` 之後、`);` 之前加兩欄：

```sql
  policy TEXT NOT NULL DEFAULT 'manual',
  pending_injection TEXT
```

改後該段為：

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
  policy TEXT NOT NULL DEFAULT 'manual',
  pending_injection TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **步驟 2：加 idempotent migration**

在 `applyMigrations` 函式內、`learning_runs.run_kind` 區塊（第 352-355 行）之後加：

```ts
  // autonomy_runs：自走政策 + 中途插話
  if (tableExists(db, "autonomy_runs")) {
    if (!hasColumn(db, "autonomy_runs", "policy")) {
      db.exec("ALTER TABLE autonomy_runs ADD COLUMN policy TEXT NOT NULL DEFAULT 'manual'");
    }
    if (!hasColumn(db, "autonomy_runs", "pending_injection")) {
      db.exec("ALTER TABLE autonomy_runs ADD COLUMN pending_injection TEXT");
    }
  }
```

- [ ] **步驟 3：型別檢查通過**

運行：`cd server && npx tsc --noEmit`
預期：PASS（無新錯誤）。此步只確認 SQL 字串改動不破壞編譯。

- [ ] **步驟 4：Commit**

```bash
git add server/src/dbSchema.ts
git commit -m "feat(autonomy): add policy/pending_injection columns to autonomy_runs"
```

---

### 任務 3：store 層支援 policy 與插話

**文件：**
- 修改：`server/src/store/autonomy.ts:7-11`（AutonomyRun 型別）、`:20-26`（rowToRun）、`:35-43`（createRun）、檔尾加 set/clear 插話
- 測試：`server/src/store/autonomy.test.ts`（若無則新建）

- [ ] **步驟 1：編寫失敗的測試**

```ts
// server/src/store/autonomy.test.ts
import { describe, it, expect } from "vitest";
import { createRun, getRun, setPendingInjection, clearPendingInjection } from "./autonomy.js";

describe("autonomy store — policy & injection", () => {
  it("createRun 預設 policy=manual、可指定 balanced", () => {
    const a = createRun({ sessionId: "s1", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    expect(getRun(a.id)!.policy).toBe("manual");
    const b = createRun({ sessionId: "s1", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000, policy: "balanced" });
    expect(getRun(b.id)!.policy).toBe("balanced");
  });
  it("set/clear pendingInjection", () => {
    const r = createRun({ sessionId: "s2", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    expect(getRun(r.id)!.pendingInjection).toBeUndefined();
    setPendingInjection(r.id, "改方向：先做 A");
    expect(getRun(r.id)!.pendingInjection).toBe("改方向：先做 A");
    clearPendingInjection(r.id);
    expect(getRun(r.id)!.pendingInjection).toBeUndefined();
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/store/autonomy.test.ts`
預期：FAIL（`setPendingInjection` 未匯出 / `policy` 欄不存在）。

- [ ] **步驟 3：實現**

3a. `AutonomyRun` 介面（第 7-11 行）加兩欄：

```ts
export interface AutonomyRun {
  id: string; sessionId: string; workspaceId: string; goal: string; status: RunStatus;
  stepCount: number; maxSteps: number; startedAt: number; deadlineAt: number;
  endedAt?: number; lastError?: string; createdAt: number; updatedAt: number;
  policy: import("../autonomyPolicy.js").PolicyName; pendingInjection?: string;
}
```

3b. `rowToRun`（第 20-26 行）加映射（在 `lastError` 後）：

```ts
    endedAt: r.ended_at ?? undefined, lastError: r.last_error ?? undefined,
    policy: (r.policy ?? "manual"), pendingInjection: r.pending_injection ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
```

3c. `createRun`（第 35-43 行）收 `policy`、寫入：

```ts
export function createRun(input: { sessionId: string; workspaceId: string; goal: string; maxSteps: number; maxWallMs: number; startedAt?: number; policy?: import("../autonomyPolicy.js").PolicyName }): AutonomyRun {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = input.startedAt ?? Date.now();
  db.prepare(`
    INSERT INTO autonomy_runs (id, session_id, workspace_id, goal, status, step_count, max_steps, started_at, deadline_at, policy, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'planning', 0, ?, ?, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.workspaceId, input.goal, input.maxSteps, now, now + input.maxWallMs, input.policy ?? "manual", now, now);
  return getRun(id)!;
}
```

3d. 檔尾（第 91 行 `supersedePendingForRun` 之後）加：

```ts
/** 設定/清除中途插話（自走進行中使用者打字的高優先指示）。 */
export function setPendingInjection(runId: string, text: string): void {
  db.prepare("UPDATE autonomy_runs SET pending_injection = ?, updated_at = ? WHERE id = ?").run(text, Date.now(), runId);
}
export function clearPendingInjection(runId: string): void {
  db.prepare("UPDATE autonomy_runs SET pending_injection = NULL, updated_at = ? WHERE id = ?").run(Date.now(), runId);
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/store/autonomy.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/store/autonomy.ts server/src/store/autonomy.test.ts
git commit -m "feat(autonomy): store policy + pending injection on runs"
```

---

### 任務 4：迴圈自動放行 + 插話消化 + 自動 plan 核可

**文件：**
- 修改：`server/src/autonomyRunner.ts`（import、`startRun` 第 53-83 行、`loop` 第 94-136 行、抽 helper、`approveAction` 第 138-167 行改用 helper）
- 測試：`server/src/autonomyRunner.selfwalk.test.ts`

- [ ] **步驟 1：編寫失敗的測試**

```ts
// server/src/autonomyRunner.selfwalk.test.ts
import { describe, it, expect, vi } from "vitest";
import { startRun } from "./autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending } from "./store/autonomy.js";
import type { AutonomyDeps } from "./autonomyRunner.js";

function mkDeps(turns: string[]): AutonomyDeps {
  let i = 0;
  return {
    sendTurn: vi.fn(async () => turns[Math.min(i++, turns.length - 1)]),
    runDispatch: vi.fn(async () => "（同事回覆：完成）"),
    now: () => Date.now(),
    emit: () => {},
  };
}
const A = (kind: string, detail = "") => `=== ACTION ===\nkind: ${kind}\nrisk: high\nsummary: ${kind}\ndetail: ${detail}\n=== END ACTION ===`;

describe("balanced 自走", () => {
  it("balanced：plan 不彈批准卡、dispatch 自動跑、goal_done 收尾", async () => {
    const dispatch = A("dispatch", "- agentId: marketing-trend-researcher\n  mode: consult\n  task: 研究選題");
    const deps = mkDeps([A("plan", "步驟1 派工"), dispatch, A("goal_done", "完成")]);
    const runId = await startRun("sess-bal", "w1", "做一份內容企劃", { policy: "balanced", maxSteps: 10, maxWallMs: 60000 }, deps);
    // 跑到 goal_done 後不應有 active run、不應有 pending 批准卡
    expect(getActiveRunForSession("sess-bal")).toBeUndefined();
    expect(getRun(runId)!.status).toBe("done");
    expect(listPending("sess-bal").length).toBe(0);
    expect(deps.runDispatch).toHaveBeenCalledTimes(1);
  });

  it("balanced：external_send 仍會停下等批准（paused_for_action）", async () => {
    const deps = mkDeps([A("plan", "x"), A("external_send", "寄信給客戶"), A("goal_done", "done")]);
    const runId = await startRun("sess-ext", "w1", "通知客戶", { policy: "balanced", maxSteps: 10, maxWallMs: 60000 }, deps);
    expect(getRun(runId)!.status).toBe("paused_for_action");
    const pending = listPending("sess-ext");
    expect(pending.some((p) => p.kind === "external_send")).toBe(true);
  });

  it("manual：dispatch 仍會停下等批准（向後相容）", async () => {
    const deps = mkDeps([A("plan", "x"), A("dispatch", "- agentId: a\n  mode: consult\n  task: t")]);
    const runId = await startRun("sess-man", "w1", "g", { policy: "manual", maxSteps: 10, maxWallMs: 60000 }, deps);
    // manual 預設先要 plan 批准，停在 awaiting_plan_approval
    expect(getRun(runId)!.status).toBe("awaiting_plan_approval");
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/autonomyRunner.selfwalk.test.ts`
預期：FAIL（balanced 尚未實作，plan 會卡在 awaiting_plan_approval、dispatch 不會自動跑）。

- [ ] **步驟 3：實現**

3a. import（檔頭第 1-8 行區塊）加政策與插話 store fn：

```ts
import { shouldAutoApprove } from "./autonomyPolicy.js";
import {
  createRun, getRun, updateRunStatus, incrementStep,
  createPendingAction, getPendingAction, decidePendingAction, markActionExecuted,
  supersedePendingForRun, clearPendingInjection,
  type AutonomyRun, type PendingAction, type RunStatus,
} from "./store/autonomy.js";
```

3b. 抽共用 helper（放在 `loop` 函式之前）——派工執行 + 結果敘述，供自動放行與 `approveAction` 共用（DRY）：

```ts
/** 執行一個已（自動或人工）核可的 dispatch 動作，回 ok 與要餵回 PM 的結果敘述。 */
async function runDispatchAndNote(
  deps: AutonomyDeps, actionId: string, workspaceId: string, detail: string,
): Promise<{ ok: boolean; note: string }> {
  const items = parseActions(`=== ACTION ===\nkind: dispatch\ndetail:\n${detail}\n=== END ACTION ===`)[0]?.dispatchItems ?? [];
  try {
    const out = items.length ? await deps.runDispatch(items, workspaceId) : "（無有效派工項）";
    markActionExecuted(actionId, out);
    return { ok: true, note: `派工結果：\n${out.slice(0, 4000)}\n請據此用 next_step 繼續。` };
  } catch (e) {
    markActionExecuted(actionId, e instanceof Error ? e.message : String(e), false);
    return { ok: false, note: "" };
  }
}
```

3c. `startRun`：自動放行 plan 時跳過批准、直接進 loop。把第 74-82 行（建立 plan pending、awaiting_plan_approval）改為：

```ts
  const plan = pickAction(parseActions(out), "plan");
  if (shouldAutoApprove("plan", run.policy)) {
    updateRunStatus(run.id, "running");
    emitRun(deps, run.id);
    await loop(run.id, deps, "計畫已自動核可，請開始執行第一步。");
    return run.id;
  }
  createPendingAction({
    runId: run.id, sessionId, workspaceId, kind: "plan", risk: "high",
    summary: plan?.summary ?? "執行計畫", detail: plan?.detail ?? out.slice(0, 2000),
  });
  updateRunStatus(run.id, "awaiting_plan_approval");
  emitRun(deps, run.id);
  deps.emit(run.id, { kind: "pending" });
  return run.id;
```

> 註：`run.policy` 來自 `createRun`（任務 3）。`startRun` 第 58-63 行的 `createRun({...})` 需把 `opts.policy` 傳入：在該物件加 `policy: opts.policy ?? "manual"`，並把 `opts` 型別（第 55 行）擴為 `{ maxSteps?: number; maxWallMs?: number; policy?: import("./autonomyPolicy.js").PolicyName }`（或 import `PolicyName`）。

3d. `loop`：每輪開頭消化插話；高風險動作改走政策判斷。在第 96-99 行 `while` 開頭、`budgetExceeded` 檢查之後插入插話消化：

```ts
    if (run.pendingInjection) {
      prompt = `使用者插話（高優先，請先消化再繼續）：${run.pendingInjection}\n\n${prompt}`;
      clearPendingInjection(runId);
    }
```

把第 127-134 行（高風險一律 pause）改為政策分支：

```ts
    // 政策：自動放行的 kind 直接執行並續跑；其餘照舊建待批卡並暫停。
    if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }
    if (shouldAutoApprove(action.kind, run.policy)) {
      const pa = createPendingAction({
        runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
        kind: action.kind, risk: "high", summary: action.summary, detail: action.detail,
      });
      decidePendingAction(pa.id, "approved");
      let note = "（已自動執行，請用 next_step 回報結果）";
      if (action.kind === "dispatch") {
        const r = await runDispatchAndNote(deps, pa.id, run.workspaceId, action.detail);
        if (!r.ok) { finalize(deps, runId, "error", "自動派工失敗"); return; }
        note = r.note;
      } else {
        markActionExecuted(pa.id, "已自動核可");
      }
      deps.emit(runId, { kind: "action", action: getPendingAction(pa.id) });
      const cur = getRun(runId);
      if (!cur || cur.status !== "running") return; // 期間被 stop
      prompt = note;
      continue;
    }
    const pa = createPendingAction({
      runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
      kind: action.kind, risk: "high", summary: action.summary, detail: action.detail,
    });
    updateRunStatus(runId, "paused_for_action"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
    return;
```

3e. `approveAction` 改用 helper（DRY）。把第 146-157 行的 dispatch 區塊改為：

```ts
  let resultNote = "（已核可，請執行並用 next_step 回報結果）";
  if (pa.kind === "dispatch") {
    const r = await runDispatchAndNote(deps, actionId, run.workspaceId, pa.detail ?? "");
    if (!r.ok) { finalize(deps, pa.runId, "error", "派工失敗"); return; }
    resultNote = r.note;
  } else {
    markActionExecuted(actionId, "已核可");
  }
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/autonomyRunner.selfwalk.test.ts`
預期：PASS（3 個 it 全綠）。

- [ ] **步驟 5：跑全套確認沒回歸**

運行：`cd server && npm test`
預期：`tsc --noEmit` 無錯 + 既有 vitest 全綠（含原 autonomy 測試，因 manual 行為不變）。

- [ ] **步驟 6：Commit**

```bash
git add server/src/autonomyRunner.ts server/src/autonomyRunner.selfwalk.test.ts
git commit -m "feat(autonomy): policy-gated auto-approve loop + mid-flight injection"
```

---

### 任務 5：API — POST /runs 收 policy、新增 inject 端點

**文件：**
- 修改：`server/src/routes/autonomy.ts:83-93`（POST /runs）、檔尾加 inject 端點
- 測試：`server/src/app.test.ts`

- [ ] **步驟 1：編寫失敗的測試（HTTP 端點，沿用 app.test.ts 模式）**

於 `server/src/app.test.ts` 加（沿用既有 `app.listen(0)` + `fetch` helper；若該檔已有共用 `base` 變數則重用）：

```ts
it("POST /api/autonomy/runs 接受 policy=balanced", async () => {
  // 先開一個 orchestrator session
  const s = await (await fetch(`${base}/api/orchestrator`, { method: "POST" })).json();
  const r = await fetch(`${base}/api/autonomy/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: s.id, goal: "測試目標", policy: "balanced", maxSteps: 3, maxWallMs: 5000 }),
  });
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(typeof j.runId).toBe("string");
});

it("POST /api/autonomy/runs/:id/inject 寫入插話", async () => {
  const s = await (await fetch(`${base}/api/orchestrator`, { method: "POST" })).json();
  const { runId } = await (await fetch(`${base}/api/autonomy/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: s.id, goal: "g", policy: "manual", maxSteps: 3, maxWallMs: 5000 }),
  })).json();
  const r = await fetch(`${base}/api/autonomy/runs/${runId}/inject`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "改方向" }),
  });
  expect(r.status).toBe(200);
});
```

> 註：若 `app.test.ts` 尚無 `base`（ephemeral 埠 + app.listen(0)）的 setup，照該檔現有其他端點測試的既有 setup 複製即可（不要新建依賴）。

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/app.test.ts`
預期：FAIL（policy 未被接受 / inject 端點 404）。

- [ ] **步驟 3：實現**

3a. import（第 7-10 行區塊）補 `setPendingInjection` 與政策守衛：

```ts
import { getRun, getActiveRunForSession, listPending, getPendingAction, markActionExecuted, decidePendingAction, setPendingInjection } from "../store/autonomy.js";
import { isPolicyName } from "../autonomyPolicy.js";
```

3b. `POST /runs`（第 83-93 行）收 `policy`，傳入 `startRun`：

```ts
autonomyRouter.post("/runs", async (req, res) => {
  const { sessionId, goal, maxSteps, maxWallMs, policy } = req.body || {};
  if (!sessionId || typeof goal !== "string" || !goal.trim()) return res.status(400).json({ error: "需要 sessionId 與非空 goal" });
  const sess = getSession(sessionId);
  if (!sess) return res.status(404).json({ error: "session 不存在" });
  if (sess.provider !== "claude") return res.status(400).json({ error: "自主迴圈本期僅支援 claude provider" });
  if (getActiveRunForSession(sessionId)) return res.status(409).json({ error: "此 session 已有進行中的 run" });
  const pol = isPolicyName(policy) ? policy : "manual";
  const deps = makeDeps(req.app.get("io"));
  const runId = await startRun(sessionId, sess.workspaceId, goal.trim(), { maxSteps, maxWallMs, policy: pol }, deps);
  res.json({ runId });
});
```

3c. 檔尾（最後一個 route 之後）加 inject 端點：

```ts
autonomyRouter.post("/runs/:id/inject", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "run 不存在" });
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text 不可空" });
  setPendingInjection(req.params.id, text.trim());
  res.json({ ok: true });
});
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/app.test.ts`
預期：PASS（兩個新 it 綠）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/routes/autonomy.ts server/src/app.test.ts
git commit -m "feat(autonomy): accept policy on POST /runs + add inject endpoint"
```

---

### 任務 6：PM 分類提示（[[SELF_WALK]] 標記）

**文件：**
- 修改：`server/src/routes/sessions.ts:367-373`（PM `extra` system prompt）

- [ ] **步驟 1：在 `extra` 加分類段**

把第 367-373 行的 `extra` 模板，於 `${dispatchGuide}` 之前插入下列段落（字串拼接，無需測試，行為由任務 8 e2e 驗）：

```ts
  const selfWalkGuide = `
## 先判斷：這是「目標」還是「問題」
收到使用者訊息，先自評：
- **目標**（多步、需跨多位同事協作或跨時段才能完成）→ 在回覆**最前面**單獨輸出一行標記 \`[[SELF_WALK]]\`，接著用一句話說「我判斷這是多步目標，將自動規劃並推進，過程中可隨時喊停或補充」。**不要**在這則訊息裡就開始長篇執行。
- **問題**（單次即可答）→ 不要輸出標記，直接照常回答。
- 使用者明說「直接答 / 不要自走」→ 一律當問題；明說「自走完成 / 你自己做完」→ 一律當目標。
`;
```

並把 `${dispatchGuide}` 那行改為 `${selfWalkGuide}${dispatchGuide}`。

- [ ] **步驟 2：型別檢查**

運行：`cd server && npx tsc --noEmit`
預期：PASS。

- [ ] **步驟 3：Commit**

```bash
git add server/src/routes/sessions.ts
git commit -m "feat(orchestrator): PM classifies goal vs question, emits SELF_WALK marker"
```

---

### 任務 7：Client — 偵測 SELF_WALK 啟動自走 + 停/插話控制

**文件：**
- 修改：`client/src/hooks/useChatSession.ts`（偵測標記 → 啟動 run；訂閱 `autonomy:event`）
- 修改：PM 聊天容器（顯示既有 `AutonomyPanel`，傳入 stop / inject 行為）
- 沿用：`client/src/components/AutonomyPanel.tsx`、`client/src/lib/api.ts`

> 動手前先讀這三個檔，沿用既有 socket 訂閱與 fetch 慣例（`api.ts` 已封裝 base URL）。下列為精確的 API 契約與最小邏輯，JSX 依現有 `AutonomyPanel` 樣式擺放。

- [ ] **步驟 1：在 PM 回覆完成時偵測標記並啟動 run**

當 session 的 `agentId === "agents-orchestrator"`、且某則 assistant 訊息含 `[[SELF_WALK]]`、且該 session 目前無 active run 時，呼叫：

```ts
// useChatSession.ts —— 啟動自走（balanced + 階段一預設 ceilings）
async function startSelfWalk(sessionId: string, goal: string) {
  await fetch("/api/autonomy/runs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, goal, policy: "balanced", maxSteps: 12, maxWallMs: 15 * 60 * 1000 }),
  });
}
```

`goal` = 觸發本次 PM 回覆的「使用者最後一則訊息」（從本 hook 既有的 messages 狀態取最後一筆 role==="user"）。啟動後以既有 `GET /api/autonomy/sessions/:sid/run` 輪詢 / 或訂閱 socket `autonomy:event` 更新面板狀態（沿用 `AutonomyPanel` 既有資料來源）。

顯示時把 `[[SELF_WALK]]` 標記從訊息本文移除（沿用既有 sentinel 隱藏慣例，如 `[[CONSULT_RESULTS]]`/`[[EXEC_REPORT]]` 的處理）。

- [ ] **步驟 2：自走進行中顯示「停 / 插話」**

`AutonomyPanel`（或其容器）在 run 狀態為 `running`/`paused_for_action` 時顯示兩個控制：

```ts
// 停
await fetch(`/api/autonomy/runs/${runId}/stop`, { method: "POST" });
// 插話（輸入框送出）
await fetch(`/api/autonomy/runs/${runId}/inject`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ text }),
});
```

高風險動作（external_send/spend/destructive）仍由既有 `ActionApprovalCard` + `POST /api/autonomy/actions/:id/approve|reject` 流程處理（無需改動）。

- [ ] **步驟 3：client 型別檢查**

運行：`cd client && npx tsc -b`
預期：PASS（零錯誤）。

- [ ] **步驟 4：Commit**

```bash
git add client/src
git commit -m "feat(client): trigger self-walk on SELF_WALK marker + stop/inject controls"
```

---

### 任務 8：端到端驗證（真實瀏覽器）

**文件：** 無新檔；手動 + Playwright 驗證腳本（沿用 repo 既有 e2e 慣例）。

- [ ] **步驟 1：啟動 dev**

運行：`npm run dev`（背景），開 http://localhost:5190。

- [ ] **步驟 2：自走全鏈路**

在 PM 聊天輸入一個多步目標（例：「幫我規劃下週三平台的內容並產出草稿」）。預期：
- PM 回覆開頭出現自走宣告（標記已隱藏），自走面板顯示步驟推進。
- dispatch 自動執行（不彈批准卡）；若 PM 申報 external_send/spend/destructive 則彈 `ActionApprovalCard`。
- 撞 12 步或 15 分上限 → 停下回報，出現「續跑/結束」。

- [ ] **步驟 3：停 + 插話**

自走中按「停」→ run 狀態轉 `stopped`。重開一個目標，自走中於插話框輸入「改成只做 IG」→ 下一步 PM 回覆反映新方向。

- [ ] **步驟 4：問答不受影響**

輸入單一問題（例：「shopee 退貨政策重點？」）→ PM 直接回答、**不**啟動自走面板。

- [ ] **步驟 5：Commit（若 e2e 中有微調）**

```bash
git add -A && git commit -m "test(autonomy): e2e verify self-walk, guardrails, stop/inject"
```

---

## 自檢結果

**規格覆蓋度：**
- §4.1 分類觸發 → 任務 6（PM 標記）+ 任務 7 步驟 1（client 啟動）。
- §4.2 自走迴圈 → 任務 4（複用 loop + 自動續跑）。
- §4.3 放行政策（平衡） → 任務 1（政策）+ 任務 4（loop 分支）。
- §4.4 停止條件 → 既有 `budgetExceeded`（步數/時間）+ goal_done/need_input；ceilings 由 client 帶 12/15min（任務 7 步驟 1）。
- §4.5 中途控制 → 停（既有 stopRun，任務 7 步驟 2）+ 插話（任務 3/4/5）。
- §4.6 持久化 → 任務 2/3（欄位）；resume 沿用既有 `pauseRunningRunsOnBoot`/`resumeRun`（manual 既有；balanced run 重啟後為 `paused`，使用者按續跑即可——本階段不自動續跑 balanced，列為 dogfood 後再評估）。
- §4.7 UI → 任務 7（沿用 AutonomyPanel）。
- §4.8 錯誤處理 → 任務 4（派工失敗 finalize error；逾時沿用 runConsult；budget 安全停）。
- §4.9 測試 → 任務 1/3/4/5（單元 + 端點）+ 任務 8（e2e）。

**佔位符掃描：** 無「待定/TODO」。client 任務（7）因需依現有元件樣式擺放 JSX，已提供精確 API 契約 + 最小邏輯碼並要求先讀檔，非佔位符。

**類型一致性：** `PolicyName`（autonomyPolicy.ts）貫穿 store（policy 欄）、autonomyRunner（startRun opts）、route（isPolicyName 守衛）；`shouldAutoApprove`、`runDispatchAndNote`、`setPendingInjection`/`clearPendingInjection` 命名一致並在使用前定義。

**已知邊界（轉 dogfood 觀察）：** balanced 下 `dispatch` 含 execute 模式也自動放行；若受派子 agent 內部做對外動作，不受本層政策管轄（§4.3/§5 已記）。balanced run 的開機自動續跑暫不做。
