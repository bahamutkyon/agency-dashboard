import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import { parseTags } from "./helpers.js";
import type { PromptTemplate } from "./types.js";

function rowToTemplate(r: any): PromptTemplate {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    body: r.body,
    agentId: r.agent_id || undefined,
    tags: parseTags(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTemplates(workspaceId?: string): PromptTemplate[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM templates WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all();
  return (rows as any[]).map(rowToTemplate);
}

export function upsertTemplate(t: PromptTemplate): void {
  const exists = db.prepare("SELECT id FROM templates WHERE id = ?").get(t.id);
  if (exists) {
    db.prepare(`
      UPDATE templates SET workspace_id = ?, name = ?, body = ?, agent_id = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      t.workspaceId || DEFAULT_WORKSPACE_ID, t.name, t.body,
      t.agentId || null, JSON.stringify(t.tags || []), t.updatedAt,
      t.id,
    );
  } else {
    db.prepare(`
      INSERT INTO templates (id, workspace_id, name, body, agent_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t.id, t.workspaceId || DEFAULT_WORKSPACE_ID, t.name, t.body,
      t.agentId || null, JSON.stringify(t.tags || []),
      t.createdAt, t.updatedAt,
    );
  }
}

export function deleteTemplate(id: string): void {
  db.prepare("DELETE FROM templates WHERE id = ?").run(id);
}
