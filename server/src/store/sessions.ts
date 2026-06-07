import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import { parseTags } from "./helpers.js";
import type { Message, Provider, SessionRecord, SessionSummary } from "./types.js";

function rowToSession(r: any, messages: Message[]): SessionRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    title: r.title,
    provider: (r.provider as Provider) || "claude",
    claudeSessionId: r.claude_session_id || undefined,
    codexThreadId: r.codex_thread_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: parseTags(r.tags),
    messages,
  };
}

function loadMessages(sessionId: string): Message[] {
  const rows = db.prepare("SELECT role, content, ts FROM messages WHERE session_id = ? ORDER BY id ASC, ts ASC").all(sessionId) as any[];
  return rows.map((r) => ({ role: r.role, content: r.content, ts: r.ts }));
}

export function getSession(id: string): SessionRecord | undefined {
  const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!r) return undefined;
  return rowToSession(r, loadMessages(id));
}

export function listSessions(workspaceId?: string): SessionRecord[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
  // For list view we don't fetch messages (heavy). Caller can use getSession if needed.
  return (rows as any[]).map((r) => rowToSession(r, []));
}

/**
 * 列出 session 並附上訊息數與最後一句預覽 —— 全部在「單一查詢」內完成。
 * 取代舊的 `listSessions().map(getSession)` 模式（每筆 session 一次查詢，
 * 且把整串訊息全文撈出只為了數長度）。correlated subquery 走 idx_messages_session
 * 索引，數百筆 session 也只是一次表掃描。
 */
export function listSessionsWithCounts(workspaceId?: string): SessionSummary[] {
  const sql = `
    SELECT s.*,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
      (SELECT m.content FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_content,
      (SELECT m.role    FROM messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_role
    FROM sessions s
    ${workspaceId ? "WHERE s.workspace_id = ?" : ""}
    ORDER BY s.updated_at DESC
  `;
  const rows = (workspaceId
    ? db.prepare(sql).all(workspaceId)
    : db.prepare(sql).all()) as any[];
  return rows.map((r) => {
    const { messages: _omit, ...rest } = rowToSession(r, []);
    return {
      ...rest,
      messageCount: Number(r.message_count) || 0,
      lastSnippet: r.last_content != null ? String(r.last_content) : null,
      lastRole: (r.last_role as Message["role"]) || null,
    };
  });
}

/**
 * Upsert a session. If messages array is provided, we replace all stored
 * messages with the new array — caller is responsible for being consistent.
 */
export function upsertSession(s: SessionRecord): void {
  const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(s.id);
  const provider = s.provider || "claude";
  if (existing) {
    db.prepare(`
      UPDATE sessions SET workspace_id = ?, agent_id = ?, title = ?,
        provider = ?, claude_session_id = ?, codex_thread_id = ?,
        tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      s.workspaceId || DEFAULT_WORKSPACE_ID, s.agentId, s.title,
      provider, s.claudeSessionId || null, s.codexThreadId || null,
      JSON.stringify(s.tags || []), s.updatedAt,
      s.id,
    );
  } else {
    db.prepare(`
      INSERT INTO sessions (id, workspace_id, agent_id, title, provider, claude_session_id, codex_thread_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.workspaceId || DEFAULT_WORKSPACE_ID, s.agentId, s.title,
      provider, s.claudeSessionId || null, s.codexThreadId || null,
      JSON.stringify(s.tags || []),
      s.createdAt, s.updatedAt,
    );
  }

  // Only replace messages if a non-empty array was passed (preserves existing
  // messages when caller just wants to update title/tags/etc).
  if (s.messages && s.messages.length > 0) {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(s.id);
    const ins = db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)");
    for (const m of s.messages) ins.run(s.id, m.role, m.content, m.ts);
  }
}

export function appendMessage(sessionId: string, m: Message): void {
  db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)").run(
    sessionId, m.role, m.content, m.ts,
  );
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(m.ts, sessionId);
}

export function setSessionClaudeId(sessionId: string, claudeSessionId: string): void {
  db.prepare("UPDATE sessions SET claude_session_id = ? WHERE id = ?").run(claudeSessionId, sessionId);
}

export function setSessionCodexThread(sessionId: string, codexThreadId: string): void {
  db.prepare("UPDATE sessions SET codex_thread_id = ? WHERE id = ?").run(codexThreadId, sessionId);
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
