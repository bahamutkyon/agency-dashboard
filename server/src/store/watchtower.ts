/**
 * store/watchtower.ts — 常駐看守任務 CRUD + 日誌
 *
 * 全部查詢帶 workspace_id，嚴格工作區隔離。
 */
import { db } from "../db.js";

// ─── 型別 ───────────────────────────────────────────────────────────────────

export type WatchtowerDecision = "act" | "skip" | "quiet" | "quota" | "overlap" | "error";

export interface WatchtowerTask {
  id: string;
  workspaceId: string;
  name: string;
  cron: string;
  enabled: number; // 1=啟用, 0=停用（DB 儲整數）
  quietHours: string; // 如 "22-8"，空=無
  dailyQuota: number;
  lastFiredAt: number | null;
  lastConclusion: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WatchtowerLog {
  id: string;
  taskId: string;
  workspaceId: string;
  firedAt: number;
  decision: WatchtowerDecision;
  reason: string;
  runId: string | null;
  createdAt: number;
}

// ─── Row 轉換 ────────────────────────────────────────────────────────────────

function rowToTask(r: any): WatchtowerTask {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    cron: r.cron,
    enabled: r.enabled,
    quietHours: r.quiet_hours ?? "",
    dailyQuota: r.daily_quota,
    lastFiredAt: r.last_fired_at ?? null,
    lastConclusion: r.last_conclusion ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToLog(r: any): WatchtowerLog {
  return {
    id: r.id,
    taskId: r.task_id,
    workspaceId: r.workspace_id,
    firedAt: r.fired_at,
    decision: r.decision as WatchtowerDecision,
    reason: r.reason,
    runId: r.run_id ?? null,
    createdAt: r.created_at,
  };
}

// ─── Task CRUD ───────────────────────────────────────────────────────────────

export function listWatchtowerTasks(workspaceId?: string): WatchtowerTask[] {
  if (workspaceId) {
    return (db.prepare(
      "SELECT * FROM watchtower_tasks WHERE workspace_id = ? ORDER BY created_at DESC",
    ).all(workspaceId) as any[]).map(rowToTask);
  }
  return (db.prepare("SELECT * FROM watchtower_tasks ORDER BY created_at DESC").all() as any[]).map(rowToTask);
}

export function listEnabledTasks(): WatchtowerTask[] {
  return (db.prepare("SELECT * FROM watchtower_tasks WHERE enabled = 1").all() as any[]).map(rowToTask);
}

export function getWatchtowerTask(id: string): WatchtowerTask | undefined {
  const r = db.prepare("SELECT * FROM watchtower_tasks WHERE id = ?").get(id) as any;
  return r ? rowToTask(r) : undefined;
}

export function createWatchtowerTask(input: {
  workspaceId: string;
  name: string;
  cron: string;
  quietHours?: string;
  dailyQuota?: number;
  enabled?: boolean;
}): WatchtowerTask {
  const id = `wt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO watchtower_tasks
      (id, workspace_id, name, cron, enabled, quiet_hours, daily_quota, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.name,
    input.cron,
    input.enabled !== false ? 1 : 0,
    input.quietHours ?? "",
    input.dailyQuota ?? 3,
    now,
    now,
  );
  return getWatchtowerTask(id)!;
}

export function updateWatchtowerTask(
  id: string,
  patch: Partial<{
    name: string;
    cron: string;
    enabled: boolean;
    quietHours: string;
    dailyQuota: number;
  }>,
  expectedWorkspaceId?: string,
): WatchtowerTask | undefined {
  const cur = getWatchtowerTask(id);
  if (!cur) return undefined;
  if (expectedWorkspaceId !== undefined && cur.workspaceId !== expectedWorkspaceId) return undefined;
  const now = Date.now();
  db.prepare(`
    UPDATE watchtower_tasks SET
      name = ?, cron = ?, enabled = ?, quiet_hours = ?, daily_quota = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name ?? cur.name,
    patch.cron ?? cur.cron,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled,
    patch.quietHours ?? cur.quietHours,
    patch.dailyQuota ?? cur.dailyQuota,
    now,
    id,
  );
  return getWatchtowerTask(id)!;
}

export function deleteWatchtowerTask(id: string, expectedWorkspaceId?: string): boolean {
  if (expectedWorkspaceId) {
    const cur = getWatchtowerTask(id);
    if (!cur || cur.workspaceId !== expectedWorkspaceId) return false;
  }
  db.prepare("DELETE FROM watchtower_tasks WHERE id = ?").run(id);
  return true;
}

export function updateLastFired(taskId: string): void {
  db.prepare("UPDATE watchtower_tasks SET last_fired_at = ?, updated_at = ? WHERE id = ?")
    .run(Date.now(), Date.now(), taskId);
}

export function updateLastConclusion(taskId: string, conclusion: string): void {
  db.prepare("UPDATE watchtower_tasks SET last_conclusion = ?, updated_at = ? WHERE id = ?")
    .run(conclusion, Date.now(), taskId);
}

// ─── Log ──────────────────────────────────────────────────────────────────────

export function appendLog(input: {
  taskId: string;
  workspaceId: string;
  decision: WatchtowerDecision;
  reason: string;
  runId?: string;
}): WatchtowerLog {
  const id = `wtl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO watchtower_logs (id, task_id, workspace_id, fired_at, decision, reason, run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.taskId,
    input.workspaceId,
    now,
    input.decision,
    input.reason,
    input.runId ?? null,
    now,
  );
  return getLog(id)!;
}

function getLog(id: string): WatchtowerLog | undefined {
  const r = db.prepare("SELECT * FROM watchtower_logs WHERE id = ?").get(id) as any;
  return r ? rowToLog(r) : undefined;
}

export function listLogs(taskId: string, workspaceId: string, limit = 50): WatchtowerLog[] {
  const cap = Math.min(Math.max(1, limit), 200);
  // rowid DESC tiebreak：同毫秒 fired_at 時保證「最後插入的排最前」（決策 log 穩定在 [0]）。
  return (db.prepare(
    "SELECT * FROM watchtower_logs WHERE task_id = ? AND workspace_id = ? ORDER BY fired_at DESC, rowid DESC LIMIT ?",
  ).all(taskId, workspaceId, cap) as any[]).map(rowToLog);
}

export function listLogsByWorkspace(workspaceId: string, limit = 100): WatchtowerLog[] {
  const cap = Math.min(Math.max(1, limit), 500);
  return (db.prepare(
    "SELECT * FROM watchtower_logs WHERE workspace_id = ? ORDER BY fired_at DESC, rowid DESC LIMIT ?",
  ).all(workspaceId, cap) as any[]).map(rowToLog);
}

/**
 * 計算今日 decision='act' 次數（與 daily_quota 比對）。
 * "今日" 定義為 Asia/Taipei 日期（以 now 為基準，找同一天 00:00~23:59 的 log）。
 * 實作：取 now 當天 Taipei 午夜 0 點（UNIX ms），篩 fired_at >= 該時戳。
 */
export function countActsToday(taskId: string, now: number): number {
  // "今日" = Asia/Taipei 日期。台灣無 DST，午夜固定 +08:00。
  const todayStr = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date(now)); // "YYYY-MM-DD"
  const midnightTaipei = new Date(`${todayStr}T00:00:00+08:00`).getTime();
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM watchtower_logs WHERE task_id = ? AND decision = 'act' AND fired_at >= ?",
  ).get(taskId, midnightTaipei) as { cnt: number };
  return row.cnt;
}

/**
 * 取該看守任務最近一次「升級成 autonomy run」（decision='act'）的 run_id。
 * 供 overlap guard 判斷「上一個升級的 run 是否還沒終結」用（避免 run 進入 paused
 * 時 scheduler 的 in-memory running set 已清空 → 下次 fire 又升級一個並存孤兒 run）。
 */
export function getLastActRunId(taskId: string): string | null {
  const r = db.prepare(
    "SELECT run_id FROM watchtower_logs WHERE task_id = ? AND decision = 'act' AND run_id IS NOT NULL ORDER BY fired_at DESC, rowid DESC LIMIT 1",
  ).get(taskId) as { run_id: string } | undefined;
  return r?.run_id ?? null;
}
