import { db } from "../db.js";

export interface Project {
  id: string; workspaceId: string; name: string; memory: string;
  createdAt: number; updatedAt: number;
}

const MEMORY_MAX = 8192;

function rowToProject(r: any): Project {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, memory: r.memory ?? "", createdAt: r.created_at, updatedAt: r.updated_at };
}

export function createProject(input: { workspaceId: string; name: string }): Project {
  const id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare("INSERT INTO projects (id, workspace_id, name, memory, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)")
    .run(id, input.workspaceId, input.name, now, now);
  return getProject(id)!;
}
export function getProject(id: string): Project | undefined {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
  return r ? rowToProject(r) : undefined;
}
export function listProjects(workspaceId: string): Project[] {
  return (db.prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId) as any[]).map(rowToProject);
}
export function renameProject(id: string, name: string): void {
  db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
}
export function getProjectMemory(id: string): string | undefined {
  const r = db.prepare("SELECT memory FROM projects WHERE id = ?").get(id) as any;
  return r ? (r.memory ?? "") : undefined;
}
export function setProjectMemory(id: string, content: string): void {
  // 滾動截斷：超過上限保留最新(尾端)。
  const trimmed = content.length > MEMORY_MAX ? content.slice(content.length - MEMORY_MAX) : content;
  db.prepare("UPDATE projects SET memory = ?, updated_at = ? WHERE id = ?").run(trimmed, Date.now(), id);
}
export function deleteProject(id: string): void {
  db.prepare("UPDATE sessions SET project_id = NULL WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}
