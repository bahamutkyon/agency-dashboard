import { db, DEFAULT_WORKSPACE_ID } from "../db.js";
import type { Workflow, WorkflowRun } from "./types.js";

function rowToWorkflow(r: any): Workflow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description || "",
    steps: JSON.parse(r.steps || "[]"),
    maxConcurrency: r.max_concurrency ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listWorkflows(workspaceId?: string): Workflow[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM workflows WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all();
  return (rows as any[]).map(rowToWorkflow);
}

export function getWorkflow(id: string): Workflow | undefined {
  const r = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as any;
  return r ? rowToWorkflow(r) : undefined;
}

export function upsertWorkflow(w: Workflow): void {
  const exists = db.prepare("SELECT id FROM workflows WHERE id = ?").get(w.id);
  if (exists) {
    db.prepare(`
      UPDATE workflows SET workspace_id = ?, name = ?, description = ?, steps = ?, max_concurrency = ?, updated_at = ?
      WHERE id = ?
    `).run(
      w.workspaceId || DEFAULT_WORKSPACE_ID, w.name, w.description, JSON.stringify(w.steps),
      w.maxConcurrency ?? null, w.updatedAt, w.id,
    );
  } else {
    db.prepare(`
      INSERT INTO workflows (id, workspace_id, name, description, steps, max_concurrency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      w.id, w.workspaceId || DEFAULT_WORKSPACE_ID, w.name, w.description, JSON.stringify(w.steps),
      w.maxConcurrency ?? null, w.createdAt, w.updatedAt,
    );
  }
}

export function deleteWorkflow(id: string): void {
  db.prepare("DELETE FROM workflow_runs WHERE workflow_id = ?").run(id);
  db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
}

// --- Workflow Runs ---

function rowToRun(r: any): WorkflowRun {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workspaceId: r.workspace_id,
    status: r.status,
    currentStep: r.current_step,
    sessionIds: JSON.parse(r.session_ids || "[]"),
    stepOutputs: JSON.parse(r.step_outputs || "{}"),
    error: r.error || undefined,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
  };
}

export function createRun(workflowId: string, workspaceId: string): WorkflowRun {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, workspace_id, status, current_step, session_ids, started_at)
    VALUES (?, ?, ?, 'running', 0, '[]', ?)
  `).run(id, workflowId, workspaceId, Date.now());
  return getRun(id)!;
}

export function getRun(id: string): WorkflowRun | undefined {
  const r = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as any;
  return r ? rowToRun(r) : undefined;
}

export function listRuns(workflowId: string): WorkflowRun[] {
  const rows = db.prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20").all(workflowId);
  return (rows as any[]).map(rowToRun);
}

export function updateRun(id: string, patch: Partial<Pick<WorkflowRun, "status" | "currentStep" | "sessionIds" | "stepOutputs" | "error" | "endedAt">>) {
  const cur = getRun(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workflow_runs SET
      status = ?, current_step = ?, session_ids = ?, step_outputs = ?, error = ?, ended_at = ?
    WHERE id = ?
  `).run(
    next.status, next.currentStep,
    JSON.stringify(next.sessionIds), JSON.stringify(next.stepOutputs || {}),
    next.error || null, next.endedAt || null, id,
  );
}
