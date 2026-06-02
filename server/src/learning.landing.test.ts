/**
 * Phase 3+4 整合測試：批准提案後依 source + kind 落地到正確的 scope。
 * 直接打 HTTP endpoint（沿用 app.test.ts 模式）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "./index.js";
import { db } from "./db.js";
import type { AddressInfo } from "node:net";
import { createProposal } from "./learningStore.js";

let baseUrl = "";
let server: any;

beforeAll(async () => {
  server = (app as any).listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.prepare("DELETE FROM learning_proposals WHERE agent_id LIKE 'test-land-%'").run();
  db.prepare("DELETE FROM agent_craft_memory WHERE agent_id LIKE 'test-land-%'").run();
  db.prepare("DELETE FROM category_capability_memory WHERE category LIKE 'test-land-%'").run();
});

async function approve(id: string, body: any = {}): Promise<any> {
  const r = await fetch(`${baseUrl}/api/learning/proposals/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

describe("批准落地 - source 規則", () => {
  it("source='capability-learning:agent' + kind='craft' → 落到 global（批量學習產出當通用方法論）", async () => {
    const p = createProposal({
      agentId: "test-land-bagent-1",
      workspaceId: "ws_test_A",
      kind: "craft",
      scope: "agent-global",
      content: "批量學習 craft 條目",
      source: "capability-learning:agent",
    });
    const res = await approve(p!.id);
    expect(res.status).toBe(200);
    expect(res.body.landed.scope).toBe("global");
    // DB 應該有條目 scope='global' workspace_id=''
    const row = db.prepare("SELECT * FROM agent_craft_memory WHERE agent_id = ?").get("test-land-bagent-1") as any;
    expect(row.scope).toBe("global");
    expect(row.workspace_id).toBe("");
  });

  it("source='conversation:xxx' + kind='craft' → 落到當下工作區（情境性手藝）", async () => {
    const p = createProposal({
      agentId: "test-land-cagent-1",
      workspaceId: "ws_test_B",
      kind: "craft",
      scope: "agent-global",
      content: "對話現場 craft",
      source: "conversation:sess_xyz",
    });
    const res = await approve(p!.id);
    expect(res.status).toBe(200);
    expect(res.body.landed.scope).toBe("workspace");
    const row = db.prepare("SELECT * FROM agent_craft_memory WHERE agent_id = ?").get("test-land-cagent-1") as any;
    expect(row.scope).toBe("workspace");
    expect(row.workspace_id).toBe("ws_test_B");
  });

  it("source='conversation:xxx' + kind='domain' → 落到 global（通用領域知識）", async () => {
    const p = createProposal({
      agentId: "test-land-cagent-2",
      workspaceId: "ws_test_B",
      kind: "domain",
      scope: "agent-global",
      content: "對話現場 domain 知識",
      source: "conversation:sess_xyz",
    });
    const res = await approve(p!.id);
    expect(res.status).toBe(200);
    expect(res.body.landed.scope).toBe("global");
    const row = db.prepare("SELECT * FROM agent_craft_memory WHERE agent_id = ?").get("test-land-cagent-2") as any;
    expect(row.scope).toBe("global");
  });

  it("使用者覆寫 asScope='global' → 強制 global，無視預設規則", async () => {
    const p = createProposal({
      agentId: "test-land-override",
      workspaceId: "ws_test_A",
      kind: "craft",
      scope: "agent-global",
      content: "本應 workspace 但被強制 global",
      source: "conversation:sess_xyz",
    });
    const res = await approve(p!.id, { asScope: "global" });
    expect(res.status).toBe(200);
    expect(res.body.landed.scope).toBe("global");
  });

  it("category 提案：批量學習 → category global", async () => {
    const p = createProposal({
      agentId: "__category__:test-land-cat-unique-XYZ-987",
      workspaceId: "default",
      kind: "domain",
      scope: "category",
      content: "獨特測試類能力條目-zZ" + Math.random().toString(36).slice(2, 10),
      source: "capability-learning:category",
    });
    expect(p).not.toBeNull();
    const res = await approve(p!.id);
    expect(res.status).toBe(200);
    expect(res.body.landed.scope).toBe("global");
    const row = db.prepare("SELECT * FROM category_capability_memory WHERE category = ?").get("test-land-cat-unique-XYZ-987") as any;
    expect(row.scope).toBe("global");
    expect(row.workspace_id).toBe("");
    // 額外 cleanup
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run("test-land-cat-unique-XYZ-987");
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run("__category__:test-land-cat-unique-XYZ-987");
  });
});
