import { db } from "../db.js";

export type ActivityKind = "tool_call" | "tool_result" | "run_started" | "run_step" | "run_done"
  | "action_pending" | "action_approved" | "action_rejected" | "dispatch" | "schedule_fired";

export interface ActivityRow {
  id: string; ts: number; workspaceId: string; sessionId?: string; runId?: string;
  kind: ActivityKind; summary: string; detail?: string; status?: string; totalLen?: number; createdAt: number;
}

export const ACTIVITY_DETAIL_CAP = 2000;
export const ACTIVITY_SUMMARY_CAP = 300;
export const ACTIVITY_MAX_ROWS = 20000;
export const ACTIVITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function rowTo(r: any): ActivityRow {
  return {
    id: r.id, ts: r.ts, workspaceId: r.workspace_id, sessionId: r.session_id ?? undefined,
    runId: r.run_id ?? undefined, kind: r.kind, summary: r.summary, detail: r.detail ?? undefined,
    status: r.status ?? undefined, totalLen: r.total_len ?? undefined, createdAt: r.created_at,
  };
}

export function logActivity(input: {
  workspaceId?: string; sessionId?: string; runId?: string;
  kind: ActivityKind; summary: string; detail?: string; status?: string;
}): ActivityRow {
  const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const summary = (input.summary || "").slice(0, ACTIVITY_SUMMARY_CAP);
  let detail = input.detail ?? null;
  let totalLen: number | null = null;
  if (detail && detail.length > ACTIVITY_DETAIL_CAP) {
    totalLen = detail.length;
    detail = detail.slice(0, ACTIVITY_DETAIL_CAP);
  }
  db.prepare(`
    INSERT INTO activity_log (id, ts, workspace_id, session_id, run_id, kind, summary, detail, status, total_len, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, now, input.workspaceId ?? "", input.sessionId ?? null, input.runId ?? null,
        input.kind, summary, detail, input.status ?? null, totalLen, now);
  const r = db.prepare("SELECT * FROM activity_log WHERE id = ?").get(id);
  return rowTo(r);
}

export function listActivity(opts: { workspaceId?: string; sessionId?: string; kind?: string; limit?: number; before?: number } = {}): ActivityRow[] {
  const where: string[] = [];
  const args: any[] = [];
  if (opts.workspaceId) { where.push("workspace_id = ?"); args.push(opts.workspaceId); }
  if (opts.sessionId) { where.push("session_id = ?"); args.push(opts.sessionId); }
  if (opts.kind) { where.push("kind = ?"); args.push(opts.kind); }
  if (opts.before) { where.push("ts < ?"); args.push(opts.before); }
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const sql = `SELECT * FROM activity_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC, rowid DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, limit) as any[]).map(rowTo);
}

/**
 * 取嚴者清理：刪 30 天前者，再刪超出最近 2 萬筆的舊資料。回傳刪除筆數。
 *
 * 第二段 DELETE 條件為 `ts < cutoff.ts`，故與 cutoff 同毫秒的邊界筆會被保留，
 * 語意為「**至少**保留最近 2 萬筆」，而非精確 2 萬。
 */
export function pruneActivity(): number {
  let removed = 0;
  removed += db.prepare("DELETE FROM activity_log WHERE ts < ?").run(Date.now() - ACTIVITY_MAX_AGE_MS).changes as number;
  const cutoff = db.prepare("SELECT ts FROM activity_log ORDER BY ts DESC LIMIT 1 OFFSET ?").get(ACTIVITY_MAX_ROWS) as any;
  if (cutoff != null) {
    removed += db.prepare("DELETE FROM activity_log WHERE ts < ?").run(cutoff.ts).changes as number;
  }
  return removed;
}

/** 依工具名取關鍵欄位組精簡摘要。 */
export function summarizeTool(name: string, input: any): string {
  const i = input || {};
  if (name === "Bash") return `Bash: ${i.command ?? ""}`;
  if (name === "Write" || name === "Edit" || name === "Read") return `${name}: ${i.file_path ?? i.path ?? ""}`;
  if (name === "Glob" || name === "Grep") return `${name}: ${i.pattern ?? ""}`;
  if (name.startsWith("mcp__")) return `${name}`;
  try { return `${name}: ${JSON.stringify(i).slice(0, 120)}`; } catch { return name; }
}
