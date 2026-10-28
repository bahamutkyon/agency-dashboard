import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import { parseTags } from "./helpers.js";
import type { Workspace, AgentMemory } from "./types.js";

/** 工作區累積記憶（REMEMBER）上限；超過保留最新的部分。 */
export const WORKSPACE_MEMORY_MAX = 30_000;
/** 同事記憶（蒸餾）存檔上限。 */
export const AGENT_MEMORY_MAX = 8_000;

function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    standingContext: r.standing_context || "",
    memory: r.memory || "",
    enabledMcps: parseTags(r.enabled_mcps),
    chromeCdpPort: r.chrome_cdp_port ?? undefined,
    workingDir: r.working_dir ?? undefined,
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

export function createWorkspace(input: { name: string; description?: string; standingContext?: string; id?: string }): Workspace {
  const id = input.id || `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO workspaces (id, name, description, standing_context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description || "", input.standingContext || "", Date.now());
  return getWorkspace(id)!;
}

export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "standingContext" | "memory" | "enabledMcps" | "chromeCdpPort" | "workingDir">>): Workspace | undefined {
  const cur = getWorkspace(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workspaces SET name = ?, description = ?, standing_context = ?, memory = ?, enabled_mcps = ?, chrome_cdp_port = ?, working_dir = ?
    WHERE id = ?
  `).run(
    next.name, next.description, next.standingContext, next.memory || "",
    JSON.stringify(next.enabledMcps || []),
    next.chromeCdpPort ?? null,
    next.workingDir ?? null,
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
  // 上限防止無限增長；超過時保留最新的部分。舊值 10K（標成「已壓縮」其實是直接刪掉最舊的事實），
  // 1M context 世代放寬到 30K，並誠實標示是移除。
  const capped = updated.length > WORKSPACE_MEMORY_MAX
    ? "（較早的記憶已移除，以下保留最新的部分）\n" + updated.slice(-(WORKSPACE_MEMORY_MAX - 3000))
    : updated;
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
  // 上限讓注入成本可控。舊值 4000、蒸餾目標 1500 字：實測最大的同事記憶已到 1700+ 字（模型頂著上限寫）。
  // 1M context 世代放寬（蒸餾目標 3000 字、存檔上限 8000）。
  const capped = content.length > AGENT_MEMORY_MAX ? content.slice(0, AGENT_MEMORY_MAX) + "\n\n…(已截斷)" : content;
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
  db.prepare("BEGIN").run();
  try {
    // messages 透過 session_id 關聯，先刪再刪 sessions
    db.prepare("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(id);
    db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM schedules WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM templates WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM notes WHERE workspace_id = ?").run(id);
    // 以下為原本漏刪的表 ——————————————————————————————————————————————
    db.prepare("DELETE FROM projects WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workflows WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workflow_runs WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM agent_memory WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM autonomy_runs WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM pending_actions WHERE workspace_id = ?").run(id);
    // agent_craft_memory：只刪 workspace-scope 條目；
    // scope='global'/'legacy-global' 的全域記憶不受工作區刪除影響
    db.prepare("DELETE FROM agent_craft_memory WHERE workspace_id = ? AND scope = 'workspace'").run(id);
    // category_capability_memory：同樣只刪 workspace-scope；global scope 不受影響
    db.prepare("DELETE FROM category_capability_memory WHERE workspace_id = ? AND scope = 'workspace'").run(id);
    db.prepare("DELETE FROM activity_log WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM learning_proposals WHERE workspace_id = ?").run(id);
    // ——————————————————————————————————————————————————————————————————
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    db.prepare("COMMIT").run();
    return true;
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}
