import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import { parseTags } from "./helpers.js";
import type { Workspace, AgentMemory } from "./types.js";

function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    standingContext: r.standing_context || "",
    memory: r.memory || "",
    enabledMcps: parseTags(r.enabled_mcps),
    chromeCdpPort: r.chrome_cdp_port ?? undefined,
    createdAt: r.created_at,
  };
}

export function listWorkspaces(): Workspace[] {
  const rows = db.prepare("SELECT * FROM workspaces ORDER BY created_at").all() as any[];
  return rows.map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | undefined {
  const r = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
  return r ? rowToWorkspace(r) : undefined;
}

export function createWorkspace(input: { name: string; description?: string; standingContext?: string }): Workspace {
  const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO workspaces (id, name, description, standing_context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description || "", input.standingContext || "", Date.now());
  return getWorkspace(id)!;
}

export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "standingContext" | "memory" | "enabledMcps" | "chromeCdpPort">>): Workspace | undefined {
  const cur = getWorkspace(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workspaces SET name = ?, description = ?, standing_context = ?, memory = ?, enabled_mcps = ?, chrome_cdp_port = ?
    WHERE id = ?
  `).run(
    next.name, next.description, next.standingContext, next.memory || "",
    JSON.stringify(next.enabledMcps || []),
    next.chromeCdpPort ?? null,
    id,
  );
  return getWorkspace(id);
}

export function appendWorkspaceMemory(id: string, entry: string): void {
  const w = getWorkspace(id);
  if (!w) return;
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const next = (w.memory || "").trim();
  const updated = next ? `${next}\n- [${ts}] ${entry.trim()}` : `- [${ts}] ${entry.trim()}`;
  // Cap memory at ~10KB to prevent unbounded growth
  const capped = updated.length > 10000 ? "(舊記憶已壓縮)\n" + updated.slice(-9000) : updated;
  db.prepare("UPDATE workspaces SET memory = ? WHERE id = ?").run(capped, id);
}

// =============== Agent Memory (workspace × agent) ===============

export function getAgentMemory(workspaceId: string, agentId: string): AgentMemory | null {
  const r = db.prepare(`
    SELECT workspace_id, agent_id, content, updated_at, distilled_from_session_id
    FROM agent_memory WHERE workspace_id = ? AND agent_id = ?
  `).get(workspaceId, agentId) as any;
  if (!r) return null;
  return {
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    content: r.content || "",
    updatedAt: r.updated_at,
    distilledFromSessionId: r.distilled_from_session_id,
  };
}

export function setAgentMemory(workspaceId: string, agentId: string, content: string, sessionId?: string): void {
  // Cap at 4 KB so injection cost stays reasonable
  const capped = content.length > 4000 ? content.slice(0, 4000) + "\n\n…(已截斷)" : content;
  db.prepare(`
    INSERT INTO agent_memory (workspace_id, agent_id, content, updated_at, distilled_from_session_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at,
      distilled_from_session_id = excluded.distilled_from_session_id
  `).run(workspaceId, agentId, capped, Date.now(), sessionId || null);
}

export function deleteAgentMemory(workspaceId: string, agentId: string): boolean {
  const r = db.prepare("DELETE FROM agent_memory WHERE workspace_id = ? AND agent_id = ?").run(workspaceId, agentId);
  return r.changes > 0;
}

export function deleteWorkspace(id: string): boolean {
  if (id === DEFAULT_WORKSPACE_ID) return false; // protect default
  const tx = db.prepare("BEGIN"); tx.run();
  try {
    db.prepare("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(id);
    db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM schedules WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM templates WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM notes WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    db.prepare("COMMIT").run();
    return true;
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}
