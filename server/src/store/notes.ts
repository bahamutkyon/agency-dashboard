import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import type { Note } from "./types.js";

function rowToNote(r: any): Note {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    body: r.body,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listNotes(workspaceId?: string): Note[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM notes WHERE workspace_id = ? ORDER BY pinned DESC, updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC").all();
  return (rows as any[]).map(rowToNote);
}

export function getNote(id: string): Note | undefined {
  const r = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as any;
  return r ? rowToNote(r) : undefined;
}

export function upsertNote(n: Note): void {
  const exists = db.prepare("SELECT id FROM notes WHERE id = ?").get(n.id);
  if (exists) {
    db.prepare(`
      UPDATE notes SET workspace_id = ?, title = ?, body = ?, pinned = ?, updated_at = ?
      WHERE id = ?
    `).run(n.workspaceId || DEFAULT_WORKSPACE_ID, n.title, n.body, n.pinned ? 1 : 0, n.updatedAt, n.id);
  } else {
    db.prepare(`
      INSERT INTO notes (id, workspace_id, title, body, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(n.id, n.workspaceId || DEFAULT_WORKSPACE_ID, n.title, n.body, n.pinned ? 1 : 0, n.createdAt, n.updatedAt);
  }
}

export function deleteNote(id: string): void {
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
}
