import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import type { Schedule } from "./types.js";

function rowToSchedule(r: any): Schedule {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    agentId: r.agent_id,
    prompt: r.prompt,
    cron: r.cron,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at || undefined,
  };
}

export function listSchedules(workspaceId?: string): Schedule[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM schedules WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM schedules ORDER BY created_at DESC").all();
  return (rows as any[]).map(rowToSchedule);
}

export function getSchedule(id: string): Schedule | undefined {
  const r = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as any;
  return r ? rowToSchedule(r) : undefined;
}

export function upsertSchedule(s: Schedule): void {
  const exists = db.prepare("SELECT id FROM schedules WHERE id = ?").get(s.id);
  if (exists) {
    db.prepare(`
      UPDATE schedules SET workspace_id = ?, name = ?, agent_id = ?, prompt = ?,
        cron = ?, enabled = ?, last_run_at = ?
      WHERE id = ?
    `).run(
      s.workspaceId || DEFAULT_WORKSPACE_ID, s.name, s.agentId, s.prompt,
      s.cron, s.enabled ? 1 : 0, s.lastRunAt || null,
      s.id,
    );
  } else {
    db.prepare(`
      INSERT INTO schedules (id, workspace_id, name, agent_id, prompt, cron, enabled, created_at, last_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.workspaceId || DEFAULT_WORKSPACE_ID, s.name, s.agentId, s.prompt,
      s.cron, s.enabled ? 1 : 0, s.createdAt, s.lastRunAt || null,
    );
  }
}

export function deleteSchedule(id: string): void {
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
}
