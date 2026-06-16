import { db } from "../db.js";
import type { ActionKind, Risk } from "../actionProtocol.js";

export type RunStatus = "planning" | "awaiting_plan_approval" | "running" | "paused_for_action" | "paused_for_input" | "paused" | "done" | "stopped" | "budget_exhausted" | "error";
export type PendingStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "superseded";

export interface AutonomyRun {
  id: string; sessionId: string; workspaceId: string; goal: string; status: RunStatus;
  stepCount: number; maxSteps: number; startedAt: number; deadlineAt: number;
  endedAt?: number; lastError?: string; policy: import("../autonomyPolicy.js").PolicyName; pendingInjection?: string; createdAt: number; updatedAt: number;
}
export interface PendingAction {
  id: string; runId?: string; sessionId: string; workspaceId: string; kind: ActionKind; risk: Risk;
  summary: string; detail?: string; status: PendingStatus; result?: string; createdAt: number; decidedAt?: number;
}

const ACTIVE_RUN_STATES: RunStatus[] = ["planning", "awaiting_plan_approval", "running", "paused_for_action", "paused_for_input", "paused"];
const TERMINAL_RUN_STATES: RunStatus[] = ["done", "stopped", "budget_exhausted", "error"];

function rowToRun(r: any): AutonomyRun {
  return {
    id: r.id, sessionId: r.session_id, workspaceId: r.workspace_id, goal: r.goal, status: r.status,
    stepCount: r.step_count, maxSteps: r.max_steps, startedAt: r.started_at, deadlineAt: r.deadline_at,
    endedAt: r.ended_at ?? undefined, lastError: r.last_error ?? undefined, policy: (r.policy ?? "manual"), pendingInjection: r.pending_injection ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToAction(r: any): PendingAction {
  return {
    id: r.id, runId: r.run_id ?? undefined, sessionId: r.session_id, workspaceId: r.workspace_id,
    kind: r.kind, risk: r.risk, summary: r.summary, detail: r.detail ?? undefined,
    status: r.status, result: r.result ?? undefined, createdAt: r.created_at, decidedAt: r.decided_at ?? undefined,
  };
}

export function createRun(input: { sessionId: string; workspaceId: string; goal: string; maxSteps: number; maxWallMs: number; startedAt?: number; policy?: import("../autonomyPolicy.js").PolicyName }): AutonomyRun {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = input.startedAt ?? Date.now();
  db.prepare(`
    INSERT INTO autonomy_runs (id, session_id, workspace_id, goal, status, step_count, max_steps, started_at, deadline_at, policy, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'planning', 0, ?, ?, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.workspaceId, input.goal, input.maxSteps, now, now + input.maxWallMs, input.policy ?? "manual", now, now);
  return getRun(id)!;
}
export function getRun(id: string): AutonomyRun | undefined {
  const r = db.prepare("SELECT * FROM autonomy_runs WHERE id = ?").get(id) as any;
  return r ? rowToRun(r) : undefined;
}
export function updateRunStatus(id: string, status: RunStatus, lastError?: string): void {
  const ended = TERMINAL_RUN_STATES.includes(status) ? Date.now() : null;
  db.prepare("UPDATE autonomy_runs SET status = ?, last_error = ?, ended_at = ?, updated_at = ? WHERE id = ?")
    .run(status, lastError ?? null, ended, Date.now(), id);
}
export function incrementStep(id: string): void {
  db.prepare("UPDATE autonomy_runs SET step_count = step_count + 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
}
export function listActiveRuns(): AutonomyRun[] {
  const ph = ACTIVE_RUN_STATES.map(() => "?").join(",");
  return (db.prepare(`SELECT * FROM autonomy_runs WHERE status IN (${ph}) ORDER BY created_at`).all(...ACTIVE_RUN_STATES) as any[]).map(rowToRun);
}
export function getActiveRunForSession(sessionId: string): AutonomyRun | undefined {
  const ph = ACTIVE_RUN_STATES.map(() => "?").join(",");
  const r = db.prepare(`SELECT * FROM autonomy_runs WHERE session_id = ? AND status IN (${ph}) ORDER BY created_at DESC LIMIT 1`).get(sessionId, ...ACTIVE_RUN_STATES) as any;
  return r ? rowToRun(r) : undefined;
}

export function createPendingAction(input: { runId?: string; sessionId: string; workspaceId: string; kind: ActionKind; risk: Risk; summary: string; detail?: string }): PendingAction {
  const id = `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO pending_actions (id, run_id, session_id, workspace_id, kind, risk, summary, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, input.runId ?? null, input.sessionId, input.workspaceId, input.kind, input.risk, input.summary, input.detail ?? null, Date.now());
  return getPendingAction(id)!;
}
export function getPendingAction(id: string): PendingAction | undefined {
  const r = db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as any;
  return r ? rowToAction(r) : undefined;
}
export function listPending(sessionId: string): PendingAction[] {
  return (db.prepare("SELECT * FROM pending_actions WHERE session_id = ? AND status = 'pending' ORDER BY created_at").all(sessionId) as any[]).map(rowToAction);
}
export function decidePendingAction(id: string, status: Extract<PendingStatus, "approved" | "rejected">): void {
  db.prepare("UPDATE pending_actions SET status = ?, decided_at = ? WHERE id = ?").run(status, Date.now(), id);
}
export function markActionExecuted(id: string, result: string, ok = true): void {
  db.prepare("UPDATE pending_actions SET status = ?, result = ? WHERE id = ?").run(ok ? "executed" : "failed", result.slice(0, 4000), id);
}

/** 把某 run 名下仍 pending 的動作標記為 superseded（重啟時清孤兒卡用）。 */
export function supersedePendingForRun(runId: string): void {
  db.prepare("UPDATE pending_actions SET status = 'superseded', decided_at = ? WHERE run_id = ? AND status = 'pending'").run(Date.now(), runId);
}

/** 設定/清除中途插話（自走進行中使用者打字的高優先指示）。 */
export function setPendingInjection(runId: string, text: string): void {
  db.prepare("UPDATE autonomy_runs SET pending_injection = ?, updated_at = ? WHERE id = ?").run(text, Date.now(), runId);
}
export function clearPendingInjection(runId: string): void {
  db.prepare("UPDATE autonomy_runs SET pending_injection = NULL, updated_at = ? WHERE id = ?").run(Date.now(), runId);
}
