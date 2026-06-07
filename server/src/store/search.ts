import { db } from "../db.js";
import { parseTags } from "./helpers.js";
import type { SearchHit } from "./types.js";

// --- Search (much faster than the old JSON scan) ---

export function searchSessions(q: string, workspaceId?: string): SearchHit[] {
  if (!q.trim()) return [];
  const like = `%${q}%`;

  // Find session IDs whose title or any message matches.
  const sessRows = (workspaceId
    ? db.prepare(`
        SELECT DISTINCT s.id, s.title, s.agent_id, s.workspace_id, s.updated_at
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.workspace_id = ?
          AND (s.title LIKE ? OR m.content LIKE ?)
        ORDER BY s.updated_at DESC
        LIMIT 50
      `).all(workspaceId, like, like)
    : db.prepare(`
        SELECT DISTINCT s.id, s.title, s.agent_id, s.workspace_id, s.updated_at
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.title LIKE ? OR m.content LIKE ?
        ORDER BY s.updated_at DESC
        LIMIT 50
      `).all(like, like)) as any[];

  const out: SearchHit[] = [];
  for (const row of sessRows) {
    const titleHit = row.title.toLowerCase().includes(q.toLowerCase());
    const matchedRows = db.prepare(`
      SELECT role, content, ts FROM messages WHERE session_id = ? AND content LIKE ?
      ORDER BY ts ASC LIMIT 5
    `).all(row.id, like) as any[];
    const matches = matchedRows.map((m) => {
      const idx = m.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(m.content.length, idx + q.length + 80);
      return {
        ts: m.ts,
        role: m.role,
        snippet: (start > 0 ? "…" : "") + m.content.slice(start, end) + (end < m.content.length ? "…" : ""),
      };
    });
    const matchCount = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND content LIKE ?").get(row.id, like) as any).c;
    out.push({
      sessionId: row.id,
      title: row.title,
      agentId: row.agent_id,
      workspaceId: row.workspace_id,
      updatedAt: row.updated_at,
      titleHit,
      matchCount,
      matches,
    });
  }
  return out;
}

// --- Tags aggregation ---

export function aggregateTags(workspaceId?: string): { name: string; count: number }[] {
  const rows = (workspaceId
    ? db.prepare("SELECT tags FROM sessions WHERE workspace_id = ?").all(workspaceId)
    : db.prepare("SELECT tags FROM sessions").all()) as any[];
  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const t of parseTags(r.tags)) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
