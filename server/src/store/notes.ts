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

/**
 * 將研究產出存成可被 BM25 檢索的 note（id 前綴 rnote_，標題前綴 [研究]）。
 * 沿用既有 upsertNote，不新增欄位、不改 schema。
 * 回傳寫入的 note id。
 */
export function saveResearchNote(input: {
  workspaceId: string;
  topic: string;
  summary: string;
  sources?: string[];
  agentId?: string;
}): string {
  const now = Date.now();
  const dateStr = new Intl.DateTimeFormat("sv-SE").format(new Date(now));
  const id = `rnote_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const title = `[研究] ${input.topic}`;
  const sourcesSection =
    input.sources && input.sources.length > 0
      ? input.sources.map((s) => `- ${s}`).join("\n")
      : "- (無)";
  const body = [
    `## 主題`,
    input.topic,
    ``,
    `## 結論摘要`,
    input.summary,
    ``,
    `## 來源`,
    sourcesSection,
    ``,
    `## 研究日期`,
    dateStr,
    ``,
    `## Agent`,
    input.agentId ?? "(未指定)",
  ].join("\n");

  upsertNote({
    id,
    workspaceId: input.workspaceId,
    title,
    body,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}
