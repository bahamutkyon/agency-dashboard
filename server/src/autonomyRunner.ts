import { parseActions, type ParsedAction } from "./actionProtocol.js";
import type { DispatchItem } from "./dispatchParser.js";
import {
  createRun, getRun, updateRunStatus, incrementStep,
  createPendingAction, getPendingAction, decidePendingAction, markActionExecuted,
  type AutonomyRun, type PendingAction, type RunStatus,
} from "./store/autonomy.js";

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_MAX_WALL_MS = 30 * 60 * 1000;

export interface AutonomyDeps {
  sendTurn: (sessionId: string, prompt: string) => Promise<string>;
  runDispatch: (items: DispatchItem[], workspaceId: string) => Promise<string>;
  now: () => number;
  emit: (runId: string, evt: { kind: "run" | "pending" | "action"; run?: AutonomyRun; action?: PendingAction }) => void;
}

const activeDeps = new Map<string, AutonomyDeps>();

const PROTOCOL = `你正在「自主模式」下工作。請嚴格用以下標記與系統溝通，每次回覆**只輸出一個** ACTION 區塊放在最末尾：
=== ACTION ===
kind: <plan|next_step|goal_done|need_input|dispatch|external_send|destructive|spend>
risk: <high|low>
summary: <一句話>
detail: <細節，可多行>
=== END ACTION ===
規則：
- 四類動作必須先申報、等核可才可執行：dispatch（派工）、external_send（對外發訊息）、destructive（不可逆/破壞）、spend（花錢/交易/安裝）。**嚴禁**未經核可直接執行這四類。
- 每完成一步用 next_step 回報；全部達標用 goal_done；缺關鍵資訊用 need_input。`;

function emitRun(deps: AutonomyDeps, runId: string) {
  const run = getRun(runId);
  if (run) deps.emit(runId, { kind: "run", run });
}

function finalize(deps: AutonomyDeps | undefined, runId: string, status: RunStatus, lastError?: string) {
  updateRunStatus(runId, status, lastError);
  activeDeps.delete(runId);
  if (deps) emitRun(deps, runId);
}

function budgetExceeded(run: AutonomyRun, deps: AutonomyDeps): boolean {
  return run.stepCount >= run.maxSteps || deps.now() >= run.deadlineAt;
}

function pickAction(actions: ParsedAction[], prefer?: string): ParsedAction | undefined {
  if (prefer) { const p = actions.find((a) => a.kind === prefer); if (p) return p; }
  return actions[actions.length - 1];
}

export async function startRun(
  sessionId: string, workspaceId: string, goal: string,
  opts: { maxSteps?: number; maxWallMs?: number } = {},
  deps: AutonomyDeps,
): Promise<string> {
  const run = createRun({
    sessionId, workspaceId, goal,
    maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
    maxWallMs: opts.maxWallMs ?? DEFAULT_MAX_WALL_MS,
    startedAt: deps.now(),
  });
  activeDeps.set(run.id, deps);
  emitRun(deps, run.id);
  const planPrompt = `${PROTOCOL}\n\n# 目標\n${goal}\n\n請先把目標拆成可執行的步驟計畫，用 kind: plan 輸出（risk: high）。先不要執行任何步驟。`;
  let out: string;
  try {
    out = await deps.sendTurn(sessionId, planPrompt);
  } catch (e) {
    finalize(deps, run.id, "error", e instanceof Error ? e.message : String(e));
    return run.id;
  }
  const plan = pickAction(parseActions(out), "plan");
  createPendingAction({
    runId: run.id, sessionId, workspaceId, kind: "plan", risk: "high",
    summary: plan?.summary ?? "執行計畫", detail: plan?.detail ?? out.slice(0, 2000),
  });
  updateRunStatus(run.id, "awaiting_plan_approval");
  emitRun(deps, run.id);
  deps.emit(run.id, { kind: "pending" });
  return run.id;
}

export async function approvePlan(runId: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "awaiting_plan_approval") return;
  updateRunStatus(runId, "running");
  emitRun(deps, runId);
  await loop(runId, deps, "計畫已核可，請開始執行第一步。");
}

async function loop(runId: string, deps: AutonomyDeps, firstPrompt: string): Promise<void> {
  let prompt = firstPrompt;
  while (true) {
    let run = getRun(runId);
    if (!run || run.status !== "running") return;
    if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }

    let out: string;
    try {
      out = await deps.sendTurn(run.sessionId, `${PROTOCOL}\n\n${prompt}`);
    } catch (e) {
      finalize(deps, runId, "error", e instanceof Error ? e.message : String(e));
      return;
    }
    // K1：sendTurn 期間可能被 stop/pause，重讀確認仍可推進
    run = getRun(runId);
    if (!run || run.status !== "running") return;
    incrementStep(runId);
    const action = pickAction(parseActions(out));

    if (!action || action.kind === "next_step") {
      run = getRun(runId)!;
      if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }
      prompt = "請繼續執行下一步，朝目標推進。";
      continue;
    }
    if (action.kind === "goal_done") { finalize(deps, runId, "done"); return; }
    if (action.kind === "need_input") {
      const pa = createPendingAction({ runId, sessionId: run.sessionId, workspaceId: run.workspaceId, kind: "need_input", risk: "low", summary: action.summary, detail: action.detail });
      updateRunStatus(runId, "paused_for_input"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
      return;
    }
    // 高風險：先判預算（I3），超限不彈卡
    if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }
    const pa = createPendingAction({
      runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
      kind: action.kind, risk: "high", summary: action.summary, detail: action.detail,
    });
    updateRunStatus(runId, "paused_for_action"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
    return;
  }
}

export async function approveAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  const run = getRun(pa.runId);
  if (!deps || !run || run.status !== "paused_for_action") return;
  decidePendingAction(actionId, "approved");
  let resultNote = "（已核可，請執行並用 next_step 回報結果）";
  if (pa.kind === "dispatch") {
    const items = parseActions(`=== ACTION ===\nkind: dispatch\ndetail:\n${pa.detail ?? ""}\n=== END ACTION ===`)[0]?.dispatchItems ?? [];
    let out: string;
    try {
      out = items.length ? await deps.runDispatch(items, run.workspaceId) : "（無有效派工項）";
    } catch (e) {
      markActionExecuted(actionId, e instanceof Error ? e.message : String(e), false);
      finalize(deps, pa.runId, "error", "派工失敗");
      return;
    }
    markActionExecuted(actionId, out);
    resultNote = `派工結果：\n${out.slice(0, 4000)}\n請據此用 next_step 繼續。`;
  } else {
    markActionExecuted(actionId, "已核可");
  }
  // K1：runDispatch 期間可能被 stop；重讀確認仍是 paused_for_action 才續行
  const cur = getRun(pa.runId);
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  if (!cur || cur.status !== "paused_for_action") return;
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, resultNote);
}

export async function rejectAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  if (!deps) return;
  decidePendingAction(actionId, "rejected");
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, `你剛申報的動作「${pa.summary}」被拒絕，請改用替代方案，或若無替代則用 goal_done 收尾並說明。`);
}

export async function provideInput(runId: string, text: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "paused_for_input") return;
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, `使用者補充資訊：${text}\n請據此繼續。`);
}

export async function stopRun(runId: string): Promise<void> {
  const deps = activeDeps.get(runId);
  finalize(deps, runId, "stopped");
}

export function pauseRunningRunsOnBoot(listActiveRunsFn: () => AutonomyRun[]): number {
  const active = listActiveRunsFn();
  for (const r of active) updateRunStatus(r.id, "paused");
  return active.length;
}

export async function resumeRun(runId: string, deps: AutonomyDeps): Promise<void> {
  const run = getRun(runId);
  if (!run || run.status !== "paused") return;
  activeDeps.set(runId, deps);
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, "（已從中斷處恢復）請接續朝目標執行下一步。");
}
