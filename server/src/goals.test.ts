/**
 * 目標帳本測試：store CRUD、HTTP 路由、orchestrator prompt 注入、
 * GOAL_UPDATE 標記解析、cockpit context 含目標。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "./index.js";
import { DEFAULT_WORKSPACE_ID } from "./store.js";
import { createGoal, updateGoal, deleteGoal, listGoals, detectGoalUpdate, detectGoalUpdates, getGoal } from "./store/goals.js";
import { buildCockpitContext } from "./cockpitContext.js";
import { createWorkspace, deleteWorkspace } from "./store.js";

// ─── 共用 HTTP 測試 infra ────────────────────────────────────────────────────
let server: Server;
let base: string;
const createdGoalIds: string[] = [];
const createdWorkspaceIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const id of createdGoalIds) {
    try { deleteGoal(id); } catch { /* ignore */ }
  }
  for (const id of createdWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
  server?.close();
});

// ─── 1. Store CRUD ───────────────────────────────────────────────────────────
describe("store/goals CRUD", () => {
  it("createGoal + getGoal — 建立後可查詢", () => {
    const g = createGoal({
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "露天月銷 3 台 Hairball",
      metric: "本月成交台數",
      currentValue: "1 台",
      targetValue: "3 台",
      deadline: "2026-07-31",
    });
    createdGoalIds.push(g.id);
    expect(g.id).toMatch(/^goal_/);
    expect(g.title).toBe("露天月銷 3 台 Hairball");
    expect(g.status).toBe("active");
    expect(g.currentValue).toBe("1 台");
    const got = getGoal(g.id);
    expect(got?.id).toBe(g.id);
  });

  it("listGoals — 依 status 過濾", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "封存目標" });
    createdGoalIds.push(g.id);
    updateGoal(g.id, { status: "archived" });
    const active = listGoals(DEFAULT_WORKSPACE_ID, "active");
    expect(active.every((x) => x.status === "active")).toBe(true);
    const archived = listGoals(DEFAULT_WORKSPACE_ID, "archived");
    expect(archived.some((x) => x.id === g.id)).toBe(true);
  });

  it("updateGoal — 更新現值與狀態", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "可更新目標", currentValue: "0" });
    createdGoalIds.push(g.id);
    const updated = updateGoal(g.id, { currentValue: "5", status: "done" });
    expect(updated?.currentValue).toBe("5");
    expect(updated?.status).toBe("done");
  });

  it("updateGoal — 不存在的 id 回 undefined", () => {
    const r = updateGoal("goal_nonexistent_123", { currentValue: "99" });
    expect(r).toBeUndefined();
  });

  it("deleteGoal — 刪除後 getGoal 回 undefined", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "待刪目標" });
    deleteGoal(g.id);
    expect(getGoal(g.id)).toBeUndefined();
  });

  it("updateGoal 工作區隔離 — expectedWorkspaceId 不符 → 拒改回 undefined、值不變", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "隔離目標", currentValue: "原值" });
    createdGoalIds.push(g.id);
    const r = updateGoal(g.id, { currentValue: "被跨區改掉" }, "another-workspace");
    expect(r).toBeUndefined();
    expect(getGoal(g.id)?.currentValue).toBe("原值");
    // 正確工作區照常可改
    const ok = updateGoal(g.id, { currentValue: "新值" }, DEFAULT_WORKSPACE_ID);
    expect(ok?.currentValue).toBe("新值");
  });

  it("deleteGoal 工作區隔離 — 不符 → 回 false 不刪；相符 → 刪除", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "隔離刪除目標" });
    expect(deleteGoal(g.id, "another-workspace")).toBe(false);
    expect(getGoal(g.id)).toBeDefined();
    expect(deleteGoal(g.id, DEFAULT_WORKSPACE_ID)).toBe(true);
    expect(getGoal(g.id)).toBeUndefined();
  });
});

// ─── 2. HTTP Routes ──────────────────────────────────────────────────────────
describe("HTTP /api/goals 路由", () => {
  it("POST /api/goals?workspace=... → 201 建立", async () => {
    const r = await fetch(`${base}/api/goals?workspace=${DEFAULT_WORKSPACE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP 測試目標", metric: "件數", targetValue: "10" }),
    });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { id: string; title: string };
    expect(j.title).toBe("HTTP 測試目標");
    createdGoalIds.push(j.id);
  });

  it("POST /api/goals 缺 title → 400", async () => {
    const r = await fetch(`${base}/api/goals?workspace=${DEFAULT_WORKSPACE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric: "沒有 title" }),
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/goals?workspace=...&status=active → 200 陣列", async () => {
    const r = await fetch(`${base}/api/goals?workspace=${DEFAULT_WORKSPACE_ID}&status=active`);
    expect(r.status).toBe(200);
    const j = await r.json() as unknown[];
    expect(Array.isArray(j)).toBe(true);
  });

  it("PATCH /api/goals/:id → 200 更新", async () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "PATCH 測試", currentValue: "0" });
    createdGoalIds.push(g.id);
    const r = await fetch(`${base}/api/goals/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: "3" }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { currentValue: string };
    expect(j.currentValue).toBe("3");
  });

  it("PATCH /api/goals/:id 跨工作區 → 404（隔離）", async () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "路由隔離目標" });
    createdGoalIds.push(g.id);
    const r = await fetch(`${base}/api/goals/${g.id}?workspace=other-ws`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: "跨區改" }),
    });
    expect(r.status).toBe(404);
    expect(getGoal(g.id)?.currentValue).not.toBe("跨區改");
  });

  it("DELETE /api/goals/:id 跨工作區 → 404（隔離）", async () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "路由隔離刪除" });
    createdGoalIds.push(g.id);
    const r = await fetch(`${base}/api/goals/${g.id}?workspace=other-ws`, { method: "DELETE" });
    expect(r.status).toBe(404);
    expect(getGoal(g.id)).toBeDefined();
  });

  it("PATCH /api/goals/:id 不存在 → 404", async () => {
    const r = await fetch(`${base}/api/goals/__nope__`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: "1" }),
    });
    expect(r.status).toBe(404);
  });

  it("DELETE /api/goals/:id → 200 {ok:true}", async () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "DELETE 測試" });
    const r = await fetch(`${base}/api/goals/${g.id}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
    expect(getGoal(g.id)).toBeUndefined();
  });
});

// ─── 3. Orchestrator prompt 含 active 目標區塊 / 無目標不注入 ─────────────────
describe("orchestrator session — 目標注入", () => {
  it("有 active 目標時，POST /api/orchestrator 成功（200），session 已建立", async () => {
    // 建立一個帶目標的工作區
    const ws = createWorkspace({ name: "目標注入測試工作區" });
    createdWorkspaceIds.push(ws.id);
    const g = createGoal({
      workspaceId: ws.id,
      title: "月銷 5 台",
      metric: "成交台數",
      currentValue: "2 台",
      targetValue: "5 台",
      deadline: "2026-08-31",
    });
    createdGoalIds.push(g.id);

    const r = await fetch(`${base}/api/orchestrator?workspace=${ws.id}`, { method: "POST" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { id: string };
    expect(typeof j.id).toBe("string");
  });

  it("無 active 目標時，POST /api/orchestrator 也成功（goalsBlock 為空不影響啟動）", async () => {
    const ws = createWorkspace({ name: "無目標工作區" });
    createdWorkspaceIds.push(ws.id);
    const r = await fetch(`${base}/api/orchestrator?workspace=${ws.id}`, { method: "POST" });
    expect(r.status).toBe(200);
  });
});

// ─── 4. GOAL_UPDATE 標記解析 ─────────────────────────────────────────────────
describe("detectGoalUpdate", () => {
  it("正確格式 → 解析 goalId 和 newValue", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "GOAL_UPDATE 測試目標", currentValue: "1 台" });
    createdGoalIds.push(g.id);
    const content = `這個月表現很好！\n=== GOAL_UPDATE: ${g.id} | 3 台 ===\n以上是更新。`;
    const hit = detectGoalUpdate(content);
    expect(hit).not.toBeNull();
    expect(hit?.goalId).toBe(g.id);
    expect(hit?.newValue).toBe("3 台");
  });

  it("缺少標記 → 回 null", () => {
    expect(detectGoalUpdate("這是一般訊息，沒有任何標記。")).toBeNull();
  });

  it("格式錯誤（無 | 分隔）→ 回 null", () => {
    expect(detectGoalUpdate("=== GOAL_UPDATE: goal_abc ===")).toBeNull();
  });

  it("空 goalId → 回 null", () => {
    expect(detectGoalUpdate("=== GOAL_UPDATE:  | 5 台 ===")).toBeNull();
  });

  it("空 newValue → 回 null", () => {
    expect(detectGoalUpdate("=== GOAL_UPDATE: goal_abc |  ===")).toBeNull();
  });

  it("updateGoal 接收 detectGoalUpdate 結果 → 現值確實更新", () => {
    const g = createGoal({ workspaceId: DEFAULT_WORKSPACE_ID, title: "閉環測試", currentValue: "0" });
    createdGoalIds.push(g.id);
    const content = `=== GOAL_UPDATE: ${g.id} | 7 台 ===`;
    const hit = detectGoalUpdate(content);
    expect(hit).not.toBeNull();
    const updated = updateGoal(hit!.goalId, { currentValue: hit!.newValue });
    expect(updated?.currentValue).toBe("7 台");
  });
});

// ─── 6. detectGoalUpdates（複數版）多標記 ──────────────────────────────────────
describe("detectGoalUpdates（複數版）", () => {
  it("單標記 → 陣列長度 1", () => {
    const hits = detectGoalUpdates("=== GOAL_UPDATE: goal_abc | 3 台 ===");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ goalId: "goal_abc", newValue: "3 台" });
  });

  it("多標記 → 全部解析", () => {
    const content = `=== GOAL_UPDATE: goal_1 | 5 台 ===\n中間文字\n=== GOAL_UPDATE: goal_2 | 10 件 ===`;
    const hits = detectGoalUpdates(content);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ goalId: "goal_1", newValue: "5 台" });
    expect(hits[1]).toEqual({ goalId: "goal_2", newValue: "10 件" });
  });

  it("上限 5 筆——第 6 筆被截", () => {
    const parts = Array.from({ length: 6 }, (_, i) => `=== GOAL_UPDATE: goal_${i} | ${i} ===`);
    const hits = detectGoalUpdates(parts.join("\n"));
    expect(hits).toHaveLength(5);
  });

  it("無標記 → 空陣列", () => {
    expect(detectGoalUpdates("一般訊息")).toHaveLength(0);
  });

  it("壞格式（無 |）→ 空陣列", () => {
    expect(detectGoalUpdates("=== GOAL_UPDATE: goal_abc ===")).toHaveLength(0);
  });
});

// ─── 5. cockpitContext 含目標 ────────────────────────────────────────────────
describe("buildCockpitContext — 含工作區目標", () => {
  it("有 active 目標的工作區，goals 陣列非空", () => {
    const ws = createWorkspace({ name: "cockpit 目標測試" });
    createdWorkspaceIds.push(ws.id);
    const g = createGoal({
      workspaceId: ws.id,
      title: "Cockpit 目標",
      metric: "KPI",
      currentValue: "3",
      targetValue: "10",
      deadline: "2026-12-31",
    });
    createdGoalIds.push(g.id);
    // 沒有 memory 也沒有 latestReport，但有 goals → 應該被納入
    const pack = buildCockpitContext();
    const wsEntry = pack.workspaces.find((w) => w.id === ws.id);
    expect(wsEntry).toBeDefined();
    expect(wsEntry?.goals.length).toBeGreaterThan(0);
    const goalEntry = wsEntry?.goals.find((x) => x.id === g.id);
    expect(goalEntry?.title).toBe("Cockpit 目標");
    expect(goalEntry?.currentValue).toBe("3");
  });

  it("沒有 active 目標的空工作區（也無 memory）→ 不出現在 workspaces 列表", () => {
    const ws = createWorkspace({ name: "空工作區" });
    createdWorkspaceIds.push(ws.id);
    const pack = buildCockpitContext();
    expect(pack.workspaces.find((w) => w.id === ws.id)).toBeUndefined();
  });
});
