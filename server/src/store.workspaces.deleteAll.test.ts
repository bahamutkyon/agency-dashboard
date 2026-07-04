/**
 * deleteWorkspace — 全表清理 + 交易
 *
 * 驗證刪除工作區時，所有 workspace_id 關聯表的資料都被清除，
 * 且全域 agent_craft_memory 與其他工作區資料不受影響。
 */
import { describe, it, expect, afterEach } from "vitest";
import { createWorkspace, deleteWorkspace } from "./store.js";
import { db } from "./db.js";

const cleanupIds: string[] = [];
afterEach(() => {
  for (const id of cleanupIds.splice(0)) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
});

function seedAll(wsId: string) {
  const sessId = `sess_${wsId}`;
  db.prepare("INSERT OR IGNORE INTO sessions (id, workspace_id, agent_id, title, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(sessId, wsId, "test-agent", "T", "claude", 1000, 1000);
  db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)")
    .run(sessId, "user", "hello", 1001);
  db.prepare("INSERT OR IGNORE INTO projects (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(`proj_${wsId}`, wsId, "P", 1000, 1000);
  db.prepare("INSERT OR IGNORE INTO workflows (id, workspace_id, name, steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`wf_${wsId}`, wsId, "W", "[]", 1000, 1000);
  db.prepare("INSERT OR IGNORE INTO workflow_runs (id, workflow_id, workspace_id, status, started_at) VALUES (?, ?, ?, ?, ?)")
    .run(`wfr_${wsId}`, `wf_${wsId}`, wsId, "done", 1000);
  db.prepare("INSERT OR REPLACE INTO agent_memory (workspace_id, agent_id, content, updated_at) VALUES (?, ?, ?, ?)")
    .run(wsId, "test-agent", "mem", 1000);
  db.prepare("INSERT OR IGNORE INTO autonomy_runs (id, session_id, workspace_id, goal, status, max_steps, started_at, deadline_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`ar_${wsId}`, sessId, wsId, "g", "done", 5, 1000, 2000, 1000, 1000);
  db.prepare("INSERT OR IGNORE INTO pending_actions (id, session_id, workspace_id, kind, risk, summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`pa_${wsId}`, sessId, wsId, "dispatch", "high", "x", "pending", 1000);
  db.prepare("INSERT OR IGNORE INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("test-agent", wsId, "workspace", "craft", 1000);
  db.prepare("INSERT OR IGNORE INTO activity_log (id, ts, workspace_id, kind, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`al_${wsId}`, 1000, wsId, "tool_call", "act", 1000);
  db.prepare("INSERT OR IGNORE INTO schedules (id, workspace_id, name, agent_id, prompt, cron, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(`sch_${wsId}`, wsId, "S", "test-agent", "p", "0 * * * *", 1000);
  db.prepare("INSERT OR IGNORE INTO templates (id, workspace_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`tpl_${wsId}`, wsId, "T", "body", 1000, 1000);
  db.prepare("INSERT OR IGNORE INTO notes (id, workspace_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`note_${wsId}`, wsId, "N", "body", 1000, 1000);
  db.prepare("INSERT OR IGNORE INTO learning_proposals (id, agent_id, workspace_id, kind, scope, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`lp_${wsId}`, "test-agent", wsId, "fact", "workspace", "c", "t", 1000);
}

describe("deleteWorkspace — 全表清理", () => {
  it("刪除工作區同時清空所有關聯表（14 個表）", () => {
    const ws = createWorkspace({ name: "del-all-test" });
    const wsId = ws.id;
    const sessId = `sess_${wsId}`;

    seedAll(wsId);

    const result = deleteWorkspace(wsId);
    expect(result).toBe(true);

    // 工作區本體
    expect(db.prepare("SELECT id FROM workspaces WHERE id = ?").get(wsId)).toBeUndefined();
    // sessions + messages
    expect(db.prepare("SELECT id FROM sessions WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM messages WHERE session_id = ?").get(sessId)).toBeUndefined();
    // 原本漏刪的表
    expect(db.prepare("SELECT id FROM projects WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM workflows WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM workflow_runs WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT workspace_id FROM agent_memory WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM autonomy_runs WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM pending_actions WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM agent_craft_memory WHERE workspace_id = ? AND scope = 'workspace'").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM activity_log WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM learning_proposals WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    // 原本已有的表
    expect(db.prepare("SELECT id FROM schedules WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM templates WHERE workspace_id = ?").get(wsId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM notes WHERE workspace_id = ?").get(wsId)).toBeUndefined();
  });

  it("全域 agent_craft_memory（scope != 'workspace'）不受影響", () => {
    const ws = createWorkspace({ name: "del-global-test" });
    const wsId = ws.id;

    // 插入全域記憶（不屬於任何工作區）
    db.prepare("INSERT OR IGNORE INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("global-agent", "", "global", "通用方法論", 1000);
    db.prepare("INSERT OR IGNORE INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("global-agent", "", "legacy-global", "遷移前記憶", 1000);

    deleteWorkspace(wsId);

    // 全域條目應仍存在
    const globalRow = db.prepare("SELECT scope FROM agent_craft_memory WHERE agent_id = 'global-agent' AND workspace_id = '' AND scope = 'global'").get();
    expect(globalRow).toBeTruthy();
    const legacyRow = db.prepare("SELECT scope FROM agent_craft_memory WHERE agent_id = 'global-agent' AND workspace_id = '' AND scope = 'legacy-global'").get();
    expect(legacyRow).toBeTruthy();

    // 清除測試資料
    db.prepare("DELETE FROM agent_craft_memory WHERE agent_id = 'global-agent' AND workspace_id = ''").run();
  });

  it("其他工作區的資料完全不受影響", () => {
    const ws1 = createWorkspace({ name: "del-ws1" });
    const ws2 = createWorkspace({ name: "del-ws2" });
    cleanupIds.push(ws2.id); // ws2 由 afterEach 清理

    // 在 ws2 插入各種資料
    db.prepare("INSERT OR IGNORE INTO projects (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(`proj_${ws2.id}`, ws2.id, "WS2 Project", 1000, 1000);
    db.prepare("INSERT OR IGNORE INTO notes (id, workspace_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`note_${ws2.id}`, ws2.id, "WS2 Note", "body", 1000, 1000);
    db.prepare("INSERT OR REPLACE INTO agent_memory (workspace_id, agent_id, content, updated_at) VALUES (?, ?, ?, ?)")
      .run(ws2.id, "agent-x", "ws2 memory", 1000);

    // 刪除 ws1
    deleteWorkspace(ws1.id);

    // ws2 資料應完整保留
    expect(db.prepare("SELECT id FROM projects WHERE workspace_id = ?").get(ws2.id)).toBeTruthy();
    expect(db.prepare("SELECT id FROM notes WHERE workspace_id = ?").get(ws2.id)).toBeTruthy();
    expect(db.prepare("SELECT workspace_id FROM agent_memory WHERE workspace_id = ?").get(ws2.id)).toBeTruthy();
  });

  it("刪除預設工作區回傳 false，不做任何刪除", () => {
    const result = deleteWorkspace("default");
    expect(result).toBe(false);
    // 預設工作區應仍存在
    expect(db.prepare("SELECT id FROM workspaces WHERE id = 'default'").get()).toBeTruthy();
  });
});
