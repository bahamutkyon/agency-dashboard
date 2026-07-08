/**
 * 成效回訪帳本測試：store CRUD、listDue 邊界、recordResult 工作區隔離、
 * scheduler due→notified→notify 一次不重發、HTTP 路由含跨區 404、
 * FOLLOWUP 標記解析、cockpit context 含 outcomes、PM prompt 注入。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "./index.js";
import { DEFAULT_WORKSPACE_ID, createWorkspace, deleteWorkspace } from "./store.js";
import {
  createOutcomeCheck, getOutcomeCheck, deleteOutcomeCheck, listOutcomes,
  listDue, listOpen, listRecent, recordResult, markNotified, cancelOutcome,
  detectFollowup, detectFollowups, hasOpenDuplicate,
} from "./store/outcomes.js";
import { sweepDueOutcomes } from "./outcomeScheduler.js";
import { buildCockpitContext } from "./cockpitContext.js";

let server: Server;
let base: string;
const createdIds: string[] = [];
const createdWorkspaceIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const id of createdIds) { try { deleteOutcomeCheck(id); } catch { /* ignore */ } }
  for (const id of createdWorkspaceIds) { try { deleteWorkspace(id); } catch { /* ignore */ } }
  server?.close();
});

// ─── 1. Store CRUD ───────────────────────────────────────────────────────────
describe("store/outcomes CRUD", () => {
  it("createOutcomeCheck + getOutcomeCheck — 建立後可查詢", () => {
    const o = createOutcomeCheck({
      workspaceId: DEFAULT_WORKSPACE_ID,
      description: "露天 Hairball 那檔有沒有詢問/成交",
      dueAt: Date.now() + 7 * 86400000,
      delegationId: "dlg_abc",
      goalId: "goal_xyz",
    });
    createdIds.push(o.id);
    expect(o.id).toMatch(/^oc_/);
    expect(o.status).toBe("pending");
    expect(o.delegationId).toBe("dlg_abc");
    expect(o.goalId).toBe("goal_xyz");
    expect(o.result).toBe("");
    expect(getOutcomeCheck(o.id)?.description).toBe("露天 Hairball 那檔有沒有詢問/成交");
  });

  it("createOutcomeCheck — delegationId/goalId 可空（預設空字串）", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "無連結回訪", dueAt: Date.now() });
    createdIds.push(o.id);
    expect(o.delegationId).toBe("");
    expect(o.goalId).toBe("");
  });

  it("listOutcomes — 依 status 過濾", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "過濾用", dueAt: Date.now() });
    createdIds.push(o.id);
    recordResult(o.id, "已成交 1 台");
    const done = listOutcomes(DEFAULT_WORKSPACE_ID, "done");
    expect(done.some((x) => x.id === o.id)).toBe(true);
    const pending = listOutcomes(DEFAULT_WORKSPACE_ID, "pending");
    expect(pending.some((x) => x.id === o.id)).toBe(false);
  });

  it("deleteOutcomeCheck — 刪除後查不到", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "待刪", dueAt: Date.now() });
    deleteOutcomeCheck(o.id);
    expect(getOutcomeCheck(o.id)).toBeUndefined();
  });
});

// ─── 2. listDue 邊界 ─────────────────────────────────────────────────────────
describe("listDue 到期邊界", () => {
  it("due_at <= now 才算到期；未來的不列入", () => {
    const ws = createWorkspace({ name: "listDue 測試" });
    createdWorkspaceIds.push(ws.id);
    const t = 1_000_000_000_000;
    const past = createOutcomeCheck({ workspaceId: ws.id, description: "已過期", dueAt: t - 1 });
    const exact = createOutcomeCheck({ workspaceId: ws.id, description: "剛好到期", dueAt: t });
    const future = createOutcomeCheck({ workspaceId: ws.id, description: "還沒到", dueAt: t + 1 });
    createdIds.push(past.id, exact.id, future.id);
    const due = listDue(t);
    const ids = due.map((d) => d.id);
    expect(ids).toContain(past.id);
    expect(ids).toContain(exact.id); // 邊界：等於 now 算到期
    expect(ids).not.toContain(future.id);
  });

  it("只列 pending；notified/done/cancelled 不列入", () => {
    const now = Date.now();
    const p = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "pending due", dueAt: now - 100 });
    const n = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "notified due", dueAt: now - 100 });
    createdIds.push(p.id, n.id);
    markNotified(n.id);
    const due = listDue(now);
    expect(due.some((d) => d.id === p.id)).toBe(true);
    expect(due.some((d) => d.id === n.id)).toBe(false);
  });
});

// ─── 3. recordResult 工作區隔離 ──────────────────────────────────────────────
describe("recordResult 工作區隔離", () => {
  it("expectedWorkspaceId 不符 → 拒改回 undefined、狀態不變", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "隔離回訪", dueAt: Date.now() });
    createdIds.push(o.id);
    const r = recordResult(o.id, "跨區偷填", "another-ws");
    expect(r).toBeUndefined();
    expect(getOutcomeCheck(o.id)?.status).toBe("pending");
    expect(getOutcomeCheck(o.id)?.result).toBe("");
    // 正確工作區照常可填
    const ok = recordResult(o.id, "成交 2 台", DEFAULT_WORKSPACE_ID);
    expect(ok?.status).toBe("done");
    expect(ok?.result).toBe("成交 2 台");
  });

  it("cancelOutcome 工作區隔離 — 不符 → undefined 不變", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "取消隔離", dueAt: Date.now() });
    createdIds.push(o.id);
    expect(cancelOutcome(o.id, "another-ws")).toBeUndefined();
    expect(getOutcomeCheck(o.id)?.status).toBe("pending");
    expect(cancelOutcome(o.id, DEFAULT_WORKSPACE_ID)?.status).toBe("cancelled");
  });

  it("deleteOutcomeCheck 工作區隔離 — 不符 → false 不刪", () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "刪除隔離", dueAt: Date.now() });
    createdIds.push(o.id);
    expect(deleteOutcomeCheck(o.id, "another-ws")).toBe(false);
    expect(getOutcomeCheck(o.id)).toBeDefined();
    expect(deleteOutcomeCheck(o.id, DEFAULT_WORKSPACE_ID)).toBe(true);
  });
});

// ─── 3b. hasOpenDuplicate — FOLLOWUP 建立去重（R1） ──────────────────────────
describe("hasOpenDuplicate — FOLLOWUP 去重", () => {
  it("同工作區同描述且未結案 → true；不同描述/不同區 → false", () => {
    const ws = createWorkspace({ name: "dedup 測試" });
    createdWorkspaceIds.push(ws.id);
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "露天回訪", dueAt: Date.now() });
    createdIds.push(o.id);
    expect(hasOpenDuplicate(ws.id, "露天回訪")).toBe(true);
    expect(hasOpenDuplicate(ws.id, "不同描述")).toBe(false);
    expect(hasOpenDuplicate(DEFAULT_WORKSPACE_ID, "露天回訪")).toBe(false);
    // notified 仍算未結案（open）
    markNotified(o.id);
    expect(hasOpenDuplicate(ws.id, "露天回訪")).toBe(true);
    // done 後不再算 duplicate（可重新掛新一輪回訪）
    recordResult(o.id, "done");
    expect(hasOpenDuplicate(ws.id, "露天回訪")).toBe(false);
  });

  it("同一標記兩回合：第二次因 hasOpenDuplicate 命中而跳過 → 只建一筆", () => {
    const ws = createWorkspace({ name: "dedup 兩回合" });
    createdWorkspaceIds.push(ws.id);
    const desc = "露天 Hairball 有沒有成交";
    // 模擬 agentManager FOLLOWUP gate：建立前先查重，命中即 skip。
    const createIfNew = () => {
      if (hasOpenDuplicate(ws.id, desc)) return null;
      const o = createOutcomeCheck({ workspaceId: ws.id, description: desc, dueAt: Date.now() });
      createdIds.push(o.id);
      return o;
    };
    const first = createIfNew();
    const second = createIfNew();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(listOpen(ws.id).filter((x) => x.description === desc)).toHaveLength(1);
  });
});

// ─── 4. listOpen / listRecent ────────────────────────────────────────────────
describe("listOpen / listRecent", () => {
  it("listOpen 含 pending+notified；不含 done/cancelled", () => {
    const ws = createWorkspace({ name: "listOpen 測試" });
    createdWorkspaceIds.push(ws.id);
    const p = createOutcomeCheck({ workspaceId: ws.id, description: "open-pending", dueAt: Date.now() });
    const n = createOutcomeCheck({ workspaceId: ws.id, description: "open-notified", dueAt: Date.now() });
    const d = createOutcomeCheck({ workspaceId: ws.id, description: "open-done", dueAt: Date.now() });
    createdIds.push(p.id, n.id, d.id);
    markNotified(n.id);
    recordResult(d.id, "done");
    const open = listOpen(ws.id);
    const ids = open.map((x) => x.id);
    expect(ids).toContain(p.id);
    expect(ids).toContain(n.id);
    expect(ids).not.toContain(d.id);
  });

  it("listRecent 只回 done、上限 n", () => {
    const ws = createWorkspace({ name: "listRecent 測試" });
    createdWorkspaceIds.push(ws.id);
    for (let i = 0; i < 3; i++) {
      const o = createOutcomeCheck({ workspaceId: ws.id, description: `done-${i}`, dueAt: Date.now() });
      createdIds.push(o.id);
      recordResult(o.id, `結果 ${i}`);
    }
    const recent = listRecent(ws.id, 2);
    expect(recent.length).toBe(2);
    expect(recent.every((x) => x.status === "done")).toBe(true);
  });
});

// ─── 5. Scheduler：due→notified→notify 一次不重發 ───────────────────────────
describe("sweepDueOutcomes 排程掃描", () => {
  it("到期 pending → 標記 notified + notify 一次 + emit", () => {
    const ws = createWorkspace({ name: "sweep 測試" });
    createdWorkspaceIds.push(ws.id);
    const t = 2_000_000_000_000;
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "sweep 回訪", dueAt: t - 1 });
    createdIds.push(o.id);
    const notified: any[] = [];
    const emitted: any[] = [];
    const n = sweepDueOutcomes({
      now: t,
      notify: (evt) => notified.push(evt),
      emit: (event, payload) => emitted.push({ event, payload }),
    });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(getOutcomeCheck(o.id)?.status).toBe("notified");
    expect(notified.some((e) => e.kind === "成效回訪" && e.title.includes("sweep 回訪"))).toBe(true);
    expect(emitted.some((e) => e.event === "outcome:due" && e.payload.id === o.id)).toBe(true);
  });

  it("冪等：第二輪掃描不重發（已 notified）", () => {
    const ws = createWorkspace({ name: "sweep 冪等測試" });
    createdWorkspaceIds.push(ws.id);
    const t = 2_100_000_000_000;
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "冪等回訪", dueAt: t - 1 });
    createdIds.push(o.id);
    const notified: any[] = [];
    sweepDueOutcomes({ now: t, notify: (e) => notified.push(e) });
    sweepDueOutcomes({ now: t, notify: (e) => notified.push(e) });
    const hits = notified.filter((e) => e.title.includes("冪等回訪"));
    expect(hits.length).toBe(1);
  });
});

// ─── 6. detectFollowup 標記解析 ─────────────────────────────────────────────
describe("detectFollowup", () => {
  it("正確格式 → 解析 days 與 description", () => {
    const hit = detectFollowup("上架完成。\n=== FOLLOWUP: 7d | 露天 Hairball 那檔有沒有詢問/成交 ===\n以上。");
    expect(hit).not.toBeNull();
    expect(hit?.days).toBe(7);
    expect(hit?.description).toBe("露天 Hairball 那檔有沒有詢問/成交");
  });

  it("允許小數天數", () => {
    expect(detectFollowup("=== FOLLOWUP: 0.5d | 半天後查 ===")?.days).toBe(0.5);
  });

  it("缺標記 → null", () => {
    expect(detectFollowup("一般訊息，沒有任何標記")).toBeNull();
  });

  it("天數非正 → null（壞標記略過）", () => {
    expect(detectFollowup("=== FOLLOWUP: 0d | 查什麼 ===")).toBeNull();
  });

  it("超過上限 90 天 → null", () => {
    expect(detectFollowup("=== FOLLOWUP: 120d | 太久 ===")).toBeNull();
  });

  it("描述空 → null", () => {
    expect(detectFollowup("=== FOLLOWUP: 7d |  ===")).toBeNull();
  });
});

// ─── 7. HTTP Routes（含跨區 404） ────────────────────────────────────────────
describe("HTTP /api/outcomes 路由", () => {
  it("POST（dueInDays）→ 201 建立", async () => {
    const r = await fetch(`${base}/api/outcomes?workspace=${DEFAULT_WORKSPACE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "HTTP 回訪", dueInDays: 3 }),
    });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { id: string; description: string };
    expect(j.description).toBe("HTTP 回訪");
    createdIds.push(j.id);
  });

  it("POST 缺 description → 400", async () => {
    const r = await fetch(`${base}/api/outcomes?workspace=${DEFAULT_WORKSPACE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueInDays: 3 }),
    });
    expect(r.status).toBe(400);
  });

  it("GET ?status=pending → 200 陣列", async () => {
    const r = await fetch(`${base}/api/outcomes?workspace=${DEFAULT_WORKSPACE_ID}&status=pending`);
    expect(r.status).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  it("PATCH /:id/result → 200 done", async () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "填結果測試", dueAt: Date.now() });
    createdIds.push(o.id);
    const r = await fetch(`${base}/api/outcomes/${o.id}/result`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "成交 3 台" }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { status: string; result: string };
    expect(j.status).toBe("done");
    expect(j.result).toBe("成交 3 台");
  });

  it("PATCH /:id/result 跨工作區 → 404（隔離）", async () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "路由隔離", dueAt: Date.now() });
    createdIds.push(o.id);
    const r = await fetch(`${base}/api/outcomes/${o.id}/result?workspace=other-ws`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "跨區填" }),
    });
    expect(r.status).toBe(404);
    expect(getOutcomeCheck(o.id)?.status).toBe("pending");
  });

  it("PATCH /:id/cancel → 200 cancelled", async () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "取消測試", dueAt: Date.now() });
    createdIds.push(o.id);
    const r = await fetch(`${base}/api/outcomes/${o.id}/cancel?workspace=${DEFAULT_WORKSPACE_ID}`, { method: "PATCH" });
    expect(r.status).toBe(200);
    expect((await r.json() as { status: string }).status).toBe("cancelled");
  });

  it("DELETE 跨工作區 → 404", async () => {
    const o = createOutcomeCheck({ workspaceId: DEFAULT_WORKSPACE_ID, description: "刪除路由隔離", dueAt: Date.now() });
    createdIds.push(o.id);
    const r = await fetch(`${base}/api/outcomes/${o.id}?workspace=other-ws`, { method: "DELETE" });
    expect(r.status).toBe(404);
    expect(getOutcomeCheck(o.id)).toBeDefined();
  });
});

// ─── 8. cockpitContext 含 outcomes ───────────────────────────────────────────
describe("buildCockpitContext — 含成效回訪", () => {
  it("有 open outcome 的工作區，outcomes.open 非空", () => {
    const ws = createWorkspace({ name: "cockpit outcome 測試" });
    createdWorkspaceIds.push(ws.id);
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "cockpit 回訪", dueAt: Date.now() + 86400000 });
    createdIds.push(o.id);
    const pack = buildCockpitContext();
    const entry = pack.workspaces.find((w) => w.id === ws.id);
    expect(entry).toBeDefined();
    expect(entry?.outcomes.open.some((x) => x.id === o.id)).toBe(true);
  });

  it("有 done outcome 的工作區，outcomes.recent 帶結果", () => {
    const ws = createWorkspace({ name: "cockpit done 測試" });
    createdWorkspaceIds.push(ws.id);
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "cockpit done 回訪", dueAt: Date.now() });
    createdIds.push(o.id);
    recordResult(o.id, "已詢問 5 次");
    const pack = buildCockpitContext();
    const entry = pack.workspaces.find((w) => w.id === ws.id);
    expect(entry?.outcomes.recent.some((x) => x.result === "已詢問 5 次")).toBe(true);
  });
});

// ─── 9. PM prompt 注入有/無 outcomes ────────────────────────────────────────
describe("orchestrator session — 成效回訪注入", () => {
  it("有 open 回訪時 POST /api/orchestrator 成功（200）", async () => {
    const ws = createWorkspace({ name: "outcome 注入測試" });
    createdWorkspaceIds.push(ws.id);
    const o = createOutcomeCheck({ workspaceId: ws.id, description: "注入回訪", dueAt: Date.now() + 86400000 });
    createdIds.push(o.id);
    const r = await fetch(`${base}/api/orchestrator?workspace=${ws.id}`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(typeof ((await r.json()) as { id: string }).id).toBe("string");
  });

  it("無回訪時 POST /api/orchestrator 也成功（outcomesBlock 為空不影響）", async () => {
    const ws = createWorkspace({ name: "無回訪工作區" });
    createdWorkspaceIds.push(ws.id);
    const r = await fetch(`${base}/api/orchestrator?workspace=${ws.id}`, { method: "POST" });
    expect(r.status).toBe(200);
  });
});

// ─── 10. detectFollowups（複數版）多標記 ────────────────────────────────────
describe("detectFollowups（複數版）", () => {
  it("單標記 → 陣列長度 1", () => {
    const hits = detectFollowups("=== FOLLOWUP: 7d | 查詢露天成交 ===");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ days: 7, description: "查詢露天成交" });
  });

  it("多標記 → 全部解析", () => {
    const content = `=== FOLLOWUP: 3d | 第一件 ===\n中間文字\n=== FOLLOWUP: 14d | 第二件 ===`;
    const hits = detectFollowups(content);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ days: 3, description: "第一件" });
    expect(hits[1]).toEqual({ days: 14, description: "第二件" });
  });

  it("上限 5 筆——第 6 筆被截", () => {
    const parts = Array.from({ length: 6 }, (_, i) => `=== FOLLOWUP: ${i + 1}d | 項目 ${i} ===`);
    const hits = detectFollowups(parts.join("\n"));
    expect(hits).toHaveLength(5);
  });

  it("無標記 → 空陣列", () => {
    expect(detectFollowups("一般訊息")).toHaveLength(0);
  });

  it("含壞標記（天數 0 / 超限 / 描述空）→ 只回有效的", () => {
    const content = [
      "=== FOLLOWUP: 0d | 天數非正 ===",
      "=== FOLLOWUP: 200d | 超限 ===",
      "=== FOLLOWUP: 7d |  ===",
      "=== FOLLOWUP: 5d | 有效的那筆 ===",
    ].join("\n");
    const hits = detectFollowups(content);
    expect(hits).toHaveLength(1);
    expect(hits[0].description).toBe("有效的那筆");
  });
});
