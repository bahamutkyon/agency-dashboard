/**
 * 交辦台帳進度心跳：從 activity_log 現算 in-flight execute 派工的工具活動進度。
 * 不新增任何寫入路徑，全部唯讀。
 *
 * 效能注意：
 * - activity_log 已有 idx_activity_session (session_id, ts DESC)，
 *   單 session 查詢走 index scan，O(k) k=該 session 的活動筆數。
 * - getBatchDelegationProgress 單一 SQL 查多 session，避免 N+1 全表掃。
 */
import { db } from "../db.js";

export interface DelegationProgress {
  /** 該 sub-session 共執行了幾次 tool_call */
  toolCalls: number;
  /** 最後一次活動（任意 kind）的 ts，無活動時為 null */
  lastActivityAt: number | null;
  /** 最後一個 tool_call 的 summary，無 tool_call 時為 null */
  lastAction: string | null;
}

/**
 * 查單一 sub-session 的工具活動進度。
 * 查詢用 idx_activity_session (session_id, ts DESC) 走 index，不全表掃。
 */
export function getDelegationProgress(subSessionId: string): DelegationProgress {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls,
      MAX(ts) AS last_activity_at,
      (
        SELECT summary FROM activity_log
        WHERE session_id = ? AND kind = 'tool_call'
        ORDER BY ts DESC, rowid DESC LIMIT 1
      ) AS last_action
    FROM activity_log
    WHERE session_id = ?
  `).get(subSessionId, subSessionId) as any;

  if (!row || row.last_activity_at == null) {
    return { toolCalls: 0, lastActivityAt: null, lastAction: null };
  }

  return {
    toolCalls: (row.tool_calls as number) || 0,
    lastActivityAt: row.last_activity_at as number,
    lastAction: (row.last_action as string | null) ?? null,
  };
}

/**
 * 批量查多個 sub-session 的進度，單一 SQL 避免 N+1。
 * 回傳 Map<subSessionId, DelegationProgress>；沒有任何活動的 session 不在 Map 裡。
 */
export function getBatchDelegationProgress(
  subSessionIds: string[],
): Map<string, DelegationProgress> {
  const result = new Map<string, DelegationProgress>();
  if (!subSessionIds.length) return result;

  const ph = subSessionIds.map(() => "?").join(", ");
  // 用關聯子查詢在同一個 SQL 取 lastAction，避免第二次查詢
  const rows = db.prepare(`
    SELECT
      a.session_id,
      SUM(CASE WHEN a.kind = 'tool_call' THEN 1 ELSE 0 END) AS tool_calls,
      MAX(a.ts) AS last_activity_at,
      (
        SELECT a2.summary FROM activity_log a2
        WHERE a2.session_id = a.session_id AND a2.kind = 'tool_call'
        ORDER BY a2.ts DESC, a2.rowid DESC LIMIT 1
      ) AS last_action
    FROM activity_log a
    WHERE a.session_id IN (${ph})
    GROUP BY a.session_id
  `).all(...subSessionIds) as any[];

  for (const row of rows) {
    result.set(row.session_id as string, {
      toolCalls: (row.tool_calls as number) || 0,
      lastActivityAt: (row.last_activity_at as number) ?? null,
      lastAction: (row.last_action as string | null) ?? null,
    });
  }

  return result;
}
