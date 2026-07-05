import { db } from "../db.js";
import { getBatchDelegationProgress, type DelegationProgress } from "./delegationProgress.js";

export type DelegationMode = "consult" | "execute";
export type DelegationStatus = "queued" | "running" | "done" | "failed" | "orphaned";

export interface Delegation {
  id: string;
  pmSessionId: string;
  workspaceId: string;
  agentId: string;
  mode: DelegationMode;
  task: string;
  status: DelegationStatus;
  subSessionId?: string;
  resultExcerpt?: string;
  createdAt: number;
  endedAt?: number;
}

const TASK_MAX = 200;
const EXCERPT_MAX = 500;
const IN_FLIGHT_STATUSES: DelegationStatus[] = ["queued", "running"];

function rowTo(r: any): Delegation {
  return {
    id: r.id,
    pmSessionId: r.pm_session_id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    mode: r.mode,
    task: r.task,
    status: r.status,
    subSessionId: r.sub_session_id ?? undefined,
    resultExcerpt: r.result_excerpt ?? undefined,
    createdAt: r.created_at,
    endedAt: r.ended_at ?? undefined,
  };
}

/**
 * 建立一筆派工台帳記錄，status 預設 'running'。
 * 記帳失敗不可讓呼叫端崩潰——此函式 throw 讓呼叫端的 try/catch 包住。
 */
export function createDelegation(input: {
  pmSessionId: string;
  workspaceId: string;
  agentId: string;
  mode: DelegationMode;
  task: string;
  subSessionId?: string;
}): string {
  const id = `dlg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const task = input.task.slice(0, TASK_MAX);
  db.prepare(`
    INSERT INTO delegations (id, pm_session_id, workspace_id, agent_id, mode, task, status, sub_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
  `).run(id, input.pmSessionId, input.workspaceId, input.agentId, input.mode, task, input.subSessionId ?? null, now);
  return id;
}

/**
 * 結束一筆派工台帳記錄：更新 status、ended_at、result 摘要。
 */
export function finishDelegation(id: string, result: { status: "done" | "failed"; resultExcerpt?: string }): void {
  const excerpt = result.resultExcerpt ? result.resultExcerpt.slice(0, EXCERPT_MAX) : null;
  db.prepare(`
    UPDATE delegations SET status = ?, result_excerpt = ?, ended_at = ? WHERE id = ?
  `).run(result.status, excerpt, Date.now(), id);
}

/** 依 id 查一筆派工台帳。找不到回 undefined。 */
export function getDelegation(id: string): Delegation | undefined {
  const r = db.prepare("SELECT * FROM delegations WHERE id = ?").get(id) as any;
  return r ? rowTo(r) : undefined;
}

export interface ListDelegationsOpts {
  pmSessionId?: string;
  workspaceId?: string;
  inFlightOnly?: boolean;
}

/**
 * 查詢派工台帳。inFlightOnly=true 時只回 status in (queued, running)。
 */
export function listDelegations(opts: ListDelegationsOpts = {}, limit = 50): Delegation[] {
  const where: string[] = [];
  const args: any[] = [];

  if (opts.pmSessionId) { where.push("pm_session_id = ?"); args.push(opts.pmSessionId); }
  if (opts.workspaceId) { where.push("workspace_id = ?"); args.push(opts.workspaceId); }
  if (opts.inFlightOnly) {
    const ph = IN_FLIGHT_STATUSES.map(() => "?").join(", ");
    where.push(`status IN (${ph})`);
    args.push(...IN_FLIGHT_STATUSES);
  }

  const cap = Math.min(Math.max(1, limit), 200);
  const sql = `SELECT * FROM delegations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, cap) as any[]).map(rowTo);
}

// ─── 進度心跳 ─────────────────────────────────────────────────────────────────

export type { DelegationProgress };

/** listDelegations 的擴充版，附帶 progress 欄位給 in-flight execute 項。 */
export interface DelegationWithProgress extends Delegation {
  /** 只有 mode=execute 且 status in (running,queued) 且有 subSessionId 的項目才有此欄位 */
  progress?: DelegationProgress;
}

/**
 * 查詢派工台帳，對 status in (running,queued) 且 mode=execute 且有 subSessionId 的項目
 * 附上從 activity_log 現算的進度（toolCalls / lastActivityAt / lastAction）。
 * done/failed/orphaned 的項目不計算進度（已結束，不需更新）。
 *
 * 效能：批量查 activity_log（單一 SQL GROUP BY），不 N+1。
 */
export function listDelegationsWithProgress(
  opts: ListDelegationsOpts = {},
  limit = 50,
): DelegationWithProgress[] {
  const rows = listDelegations(opts, limit);

  // 篩出需要計算進度的 sub-session id
  const targets = rows.filter(
    (r) =>
      r.mode === "execute" &&
      (r.status === "running" || r.status === "queued") &&
      r.subSessionId,
  );

  if (!targets.length) return rows;

  const progressMap = getBatchDelegationProgress(targets.map((r) => r.subSessionId!));

  return rows.map((r) => {
    if (
      r.mode === "execute" &&
      (r.status === "running" || r.status === "queued") &&
      r.subSessionId
    ) {
      const prog = progressMap.get(r.subSessionId);
      if (prog !== undefined) return { ...r, progress: prog };
    }
    return r;
  });
}

// ─── 開機對帳 ────────────────────────────────────────────────────────────────

/**
 * 開機對帳：把 status in (queued, running) 的記錄標成 'orphaned'（server 重啟前未完成的在途派工）。
 * 回傳被標記的筆數。
 */
export function reconcileDelegationsOnBoot(): number {
  const ph = IN_FLIGHT_STATUSES.map(() => "?").join(", ");
  const result = db.prepare(
    `UPDATE delegations SET status = 'orphaned', ended_at = ? WHERE status IN (${ph})`
  ).run(Date.now(), ...IN_FLIGHT_STATUSES);
  return result.changes as number;
}
