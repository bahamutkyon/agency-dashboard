import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "./index.js";
import { deleteWorkspace, deleteSession } from "./store.js";

// HTTP 端點 smoke 測試：用 ephemeral 埠（listen(0)）起一個臨時 server 打真實路由，
// 不撞正在跑的 dev server、不需新依賴。會寫 DB 的測試（建工作區/session）在 afterAll
// 清掉，沿用既有 store 測試慣例。

let server: Server;
let base: string;
const createdWorkspaceIds: string[] = [];
const createdSessionIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const id of createdWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
  for (const id of createdSessionIds) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  server?.close();
});

describe("HTTP 端點 smoke", () => {
  it("GET /api/health → 200 {ok:true}", async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("GET /api/agents → 200 且 agents 非空", async () => {
    const r = await fetch(`${base}/api/agents`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { agents: unknown[] };
    expect(Array.isArray(j.agents)).toBe(true);
    expect(j.agents.length).toBeGreaterThan(0);
  });

  it("POST /api/orchestrator/:id/dispatch 不存在的 session → 404", async () => {
    const r = await fetch(`${base}/api/orchestrator/__nonexistent__/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ agentId: "x", mode: "consult", task: "t" }] }),
    });
    expect(r.status).toBe(404);
  });

  it("POST /api/orchestrator/:id/dispatch items 空 → 400（需先有真 session）", async () => {
    // 建一個真 orchestrator session（不送訊息、不花 token），再用空 items 打驗證早退。
    const s = (await (await fetch(`${base}/api/orchestrator`, { method: "POST" })).json()) as { id: string };
    expect(s.id).toBeTruthy();
    createdSessionIds.push(s.id);
    const r = await fetch(`${base}/api/orchestrator/${s.id}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(r.status).toBe(400);
  });

  it("workspaces CRUD：POST 建立 → GET 列表含它 → DELETE 成功", async () => {
    const created = (await (await fetch(`${base}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "__test_ws_endpoint__" }),
    })).json()) as { id: string };
    expect(created.id).toBeTruthy();
    createdWorkspaceIds.push(created.id);

    const list = (await (await fetch(`${base}/api/workspaces`)).json()) as { id: string }[];
    expect(list.some((w) => w.id === created.id)).toBe(true);

    const del = await fetch(`${base}/api/workspaces/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("GET /api/learning/study/tiers 回 hot/cold/dormant", async () => {
    const r = await fetch(`${base}/api/learning/study/tiers`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toHaveProperty("hot"); expect(j).toHaveProperty("cold"); expect(j).toHaveProperty("dormant");
    expect(j).toHaveProperty("excluded");
  });

  it("POST /api/learning/study/override 設定 hot 回 ok", async () => {
    const r = await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "marketing-content-creator", override: "hot" }),
    });
    expect(r.status).toBe(200);
    // 清除避免污染後續測試的分層
    await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "marketing-content-creator", override: null }),
    });
  });

  it("POST /api/learning/study/override 非法 override 回 400", async () => {
    const r = await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "x", override: "bogus" }),
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/learning/study/schedules 回 hot/cold 兩列", async () => {
    const j = (await (await fetch(`${base}/api/learning/study/schedules`)).json()) as any[];
    expect(j.map((s: any) => s.tier).sort()).toEqual(["cold", "hot"]);
  });
});
