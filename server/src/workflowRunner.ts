/**
 * DAG-based workflow runner.
 *
 * Each step has:
 *   - id (auto: step_N)
 *   - dependsOn: ids of upstream steps (default = previous step in array, for backward compat)
 *   - prompt: with {{out}} (last completed dep) or {{stepId.out}} (any upstream)
 *   - pauseBefore / skipIfMatch / retries
 *
 * Engine:
 *   1. Normalize: assign auto-ids to steps without one
 *   2. Validate: dependsOn references exist + no cycles
 *   3. Schedule: topological levels; within a level, run with concurrency = 2
 *   4. For each step: pause check → skip check → execute (with retries) → store output
 *   5. {{out}} resolves to: most recently completed direct dependency's output
 *
 * Retry: exponential backoff. Default 2 retries (3 total attempts), 1.5x timeout.
 */
import { EventEmitter } from "node:events";
import { agentManager } from "./agentManager.js";
import { turnMatches } from "./agentSession.js";
import { withBackgroundSlot } from "./backgroundLimiter.js";
import { createActivityDeadline, type ActivityDeadline } from "./activityDeadline.js";
import {
  getWorkflow, createRun, updateRun, getWorkspace, getRun,
  listWorkflowRunsByStatus,
  MAX_LOOP_ITERATIONS,
  type Workflow, type WorkflowRun, type WorkflowStep, type Provider,
} from "./store.js";
import { routePrompt } from "./smartRouter.js";

interface RunOptions {
  workflowId: string;
  initialInput?: string;
  // Resume options:
  resumeRunId?: string;       // copy outputs from this run for unchanged steps
  fromStepId?: string;        // re-execute this step + its descendants only
}

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_RETRIES = 2;
// per-step 逾時：
// - step.timeoutMs 有設 → 照舊是固定牆鐘（使用者明確指定的上限，尊重它）。
// - 沒設 → 看活動：連續 DEFAULT_TIMEOUT_MS（10 分鐘）沒有任何事件才算逾時，絕對上限 DEFAULT_STEP_MAX_MS。
//   舊版預設固定 5 分鐘——新模型做研究/撰寫類步驟常超過，而 step timeout 又不重試，整條 workflow 直接失敗。
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_STEP_MAX_MS = 45 * 60 * 1000;

/**
 * 判斷該錯誤是否值得重試。
 * - "step timeout"：逾時類，重跑必然再逾時，不重試。
 * - "cancelled"：已中止，不重試。
 * - 其餘（spawn 失敗、網路抖動等）：可重試。
 */
export function isRetryableError(err: Error): boolean {
  return err.message !== "step timeout" && err.message !== "cancelled";
}

export function depsReady(step: WorkflowStep, completed: Set<string>): boolean {
  const deps = step.dependsOn || [];
  if (deps.length === 0) return true;
  const mode = step.dependsOnMode || "all";
  if (mode === "any") return deps.some((d) => completed.has(d));
  return deps.every((d) => completed.has(d));
}

export function normalizeSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s, i) => ({
    ...s,
    id: s.id || `step_${i + 1}`,
    // backward compat: if no explicit dependsOn, depend on previous step
    dependsOn: s.dependsOn !== undefined ? s.dependsOn : (i === 0 ? [] : [steps[i - 1].id || `step_${i}`]),
  }));
}

export function validateGraph(steps: WorkflowStep[]): string | null {
  const ids = new Set(steps.map((s) => s.id!));
  // missing deps?
  for (const s of steps) {
    for (const d of s.dependsOn || []) {
      if (!ids.has(d)) return `step "${s.id}" 依賴不存在的步驟「${d}」`;
    }
  }
  // cycle detection (Kahn's algorithm)
  const inDeg = new Map<string, number>();
  for (const s of steps) inDeg.set(s.id!, (s.dependsOn || []).length);
  const ready: string[] = [];
  for (const [id, n] of inDeg) if (n === 0) ready.push(id);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    visited++;
    for (const s of steps) {
      if ((s.dependsOn || []).includes(id)) {
        const next = (inDeg.get(s.id!) || 0) - 1;
        inDeg.set(s.id!, next);
        if (next === 0) ready.push(s.id!);
      }
    }
  }
  if (visited !== steps.length) return "依賴圖有循環(cycle),無法執行";
  return null;
}

interface PausedRun {
  // resume(loopToStepId?) — if a step id passed, pause handler signals
  // executor to loop back to that step. Otherwise, just continue.
  resume: (loopToStepId?: string) => void;
}

class WorkflowRunner extends EventEmitter {
  private active = new Map<string, AbortController>();
  private paused = new Map<string, PausedRun>();

  /**
   * @internal 僅供測試注入：覆寫 step 執行邏輯，繞過 agentManager 依賴。
   * 設定後，每個 step 呼叫此函式取代真實執行。timeout 仍以 step.timeoutMs 計。
   */
  _testStepRunner?: (step: WorkflowStep, promptText: string, signal: AbortSignal) => Promise<string>;

  validate(workflowId: string): { ok: boolean; error?: string; steps?: WorkflowStep[] } {
    const wf = getWorkflow(workflowId);
    if (!wf) return { ok: false, error: "workflow not found" };
    if (wf.steps.length === 0) return { ok: false, error: "no steps" };
    const steps = normalizeSteps(wf.steps);
    const err = validateGraph(steps);
    if (err) return { ok: false, error: err };
    return { ok: true, steps };
  }

  async run(opts: RunOptions): Promise<WorkflowRun> {
    const wf = getWorkflow(opts.workflowId);
    if (!wf) throw new Error("workflow not found");
    if (wf.steps.length === 0) throw new Error("workflow has no steps");

    const steps = normalizeSteps(wf.steps);
    const err = validateGraph(steps);
    if (err) throw new Error(err);

    const run = createRun(wf.id, wf.workspaceId);
    const ctrl = new AbortController();
    this.active.set(run.id, ctrl);

    // seed outputs from a previous run if resuming
    let initialOutputs: Record<string, string> = {};
    let skipBefore: Set<string> = new Set();
    if (opts.resumeRunId) {
      const prior = getRun(opts.resumeRunId);
      if (prior) {
        initialOutputs = { ...(prior.stepOutputs || {}) };
        if (opts.fromStepId) {
          // determine ancestors of fromStepId - those are the ones to KEEP
          const keep = ancestorsOf(opts.fromStepId, steps);
          // skipBefore = all steps NOT in `keep` AND NOT fromStepId-or-descendants
          const reExec = new Set([opts.fromStepId, ...descendantsOf(opts.fromStepId, steps)]);
          for (const s of steps) {
            if (!reExec.has(s.id!) && initialOutputs[s.id!] !== undefined) {
              skipBefore.add(s.id!);
            }
          }
        } else {
          // resume incomplete: skip steps that already have outputs
          for (const s of steps) {
            if (initialOutputs[s.id!] !== undefined) skipBefore.add(s.id!);
          }
        }
      }
    }

    this.execute(wf, run.id, opts.initialInput || "", steps, initialOutputs, skipBefore, ctrl.signal).catch((e) => {
      console.error(`[workflow] run ${run.id} failed:`, e);
      updateRun(run.id, { status: "error", error: e.message, endedAt: Date.now() });
      this.emit("update", run.id);
    });

    return run;
  }

  cancel(runId: string) {
    const c = this.active.get(runId);
    if (c) c.abort();
    const p = this.paused.get(runId);
    if (p) this.paused.delete(runId);
  }

  async approve(runId: string): Promise<{ newRunId?: string }> {
    const p = this.paused.get(runId);
    if (p) {
      // 同 process 內仍活著的 paused run：直接 resume，原 run 續跑
      p.resume();
      this.paused.delete(runId);
      return {};
    }
    // 孤兒 paused run（重啟後 this.paused Map 已清空）：
    // 從 DB 取回 stepOutputs + currentStep，起一個 resume run 接續執行。
    const dbRun = getRun(runId);
    if (!dbRun || dbRun.status !== "paused") return {};
    const wf = getWorkflow(dbRun.workflowId);
    if (!wf || wf.steps.length === 0) return {};
    const steps = normalizeSteps(wf.steps);
    const fromStep = steps[dbRun.currentStep];
    if (!fromStep?.id) return {};
    // 起一個新 run：跳過已完成的步驟，從 pausedStep 開始重跑
    const newRun = await this.run({
      workflowId: dbRun.workflowId,
      resumeRunId: runId,
      fromStepId: fromStep.id,
    });
    return { newRunId: newRun.id };
  }

  /**
   * Loop back from a paused step. Re-executes from `toStepId` (forgetting its
   * output and all descendants). Bumps iteration counter for that step;
   * refuses if it would exceed MAX_LOOP_ITERATIONS.
   */
  loopBack(runId: string, toStepId: string): { ok: boolean; error?: string } {
    const p = this.paused.get(runId);
    if (!p) return { ok: false, error: "run is not paused" };
    p.resume(toStepId);
    this.paused.delete(runId);
    return { ok: true };
  }

  private async execute(
    wf: Workflow,
    runId: string,
    initialInput: string,
    steps: WorkflowStep[],
    initialOutputs: Record<string, string>,
    skipBefore: Set<string>,
    signal: AbortSignal,
  ) {
    const standing = getWorkspace(wf.workspaceId)?.standingContext || "";
    const outputs: Record<string, string> = { ...initialOutputs };
    const sessionIds: string[] = [];
    const completed = new Set<string>(Object.keys(initialOutputs).filter((k) => skipBefore.has(k)));
    const stepIndexMap = new Map<string, number>();
    steps.forEach((s, i) => stepIndexMap.set(s.id!, i));

    // initialize sessionIds array — placeholder for skipped/completed
    for (const s of steps) sessionIds.push(skipBefore.has(s.id!) ? "" : "");

    // Track running in-flight
    const inFlight = new Map<string, Promise<void>>();

    const iterations: Record<string, number> = {};

    // helper: rewind outputs for a step + all its descendants
    const rewindFrom = (stepId: string) => {
      const reExec = new Set([stepId, ...descendantsOf(stepId, steps)]);
      for (const sid of reExec) {
        delete outputs[sid];
        completed.delete(sid);
      }
    };

    const tryRunStep = async (step: WorkflowStep, idx: number): Promise<void> => {
      // pauseBefore
      if (step.pauseBefore) {
        updateRun(runId, { status: "paused", currentStep: idx, sessionIds, stepOutputs: outputs });
        this.emit("update", runId);
        const decision = await new Promise<{ loopTo?: string }>((resolve, reject) => {
          this.paused.set(runId, { resume: (loopTo?: string) => resolve({ loopTo }) });
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
        });
        if (signal.aborted) throw new Error("cancelled");

        if (decision.loopTo) {
          // user wants to loop back to a previous step
          const target = steps.find((s) => s.id === decision.loopTo);
          if (target) {
            const cnt = (iterations[decision.loopTo] || 0) + 1;
            if (cnt > MAX_LOOP_ITERATIONS) {
              throw new Error(`達到最大迴圈次數 ${MAX_LOOP_ITERATIONS},強制停止`);
            }
            iterations[decision.loopTo] = cnt;
            console.log(`[workflow] loop back to ${decision.loopTo} (iteration ${cnt})`);
            rewindFrom(decision.loopTo);
            // iterations 為單次執行的記憶體迴圈計數，DB 層未設此欄、不持久化。
            updateRun(runId, { status: "running" });
            this.emit("update", runId);
            return; // skip running THIS step; scheduler will pick up the rewound chain
          }
        }
        updateRun(runId, { status: "running" });
        this.emit("update", runId);
      }

      // resolve dependency outputs and substitute prompt vars
      const directDeps = step.dependsOn || [];
      // For "any" mode, pick the first completed dep's output (the "winner");
      // for "all" mode, pick the last dep's output (chain semantics).
      let lastDepOutput = initialInput || "";
      if (directDeps.length > 0) {
        if ((step.dependsOnMode || "all") === "any") {
          const winner = directDeps.find((d) => outputs[d] !== undefined);
          lastDepOutput = winner ? (outputs[winner] || "") : "";
        } else {
          lastDepOutput = outputs[directDeps[directDeps.length - 1]] || "";
        }
      }
      let promptText = step.prompt
        .replace(/\{\{out\}\}/g, lastDepOutput || "(無上一步輸出)");
      // {{stepId.out}} — substitute any upstream step's output
      promptText = promptText.replace(/\{\{([a-z0-9_-]+)\.out\}\}/gi, (_m, sid) => {
        return outputs[sid] !== undefined ? outputs[sid] : `(找不到 ${sid} 的輸出)`;
      });

      // skipIfMatch
      if (step.skipIfMatch) {
        try {
          const re = new RegExp(step.skipIfMatch, "i");
          if (re.test(lastDepOutput)) {
            outputs[step.id!] = "(SKIPPED — 條件命中)";
            completed.add(step.id!);
            sessionIds[idx] = "";
            updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
            this.emit("update", runId);
            return;
          }
        } catch (e) {
          console.warn(`[workflow] invalid skipIfMatch on step ${step.id}:`, step.skipIfMatch);
        }
      }

      // resolve provider for this step
      let stepProvider: Provider = "claude";
      if (step.provider === "codex") stepProvider = "codex";
      else if (step.provider === "auto") {
        try {
          const decision = await routePrompt(promptText, "claude");
          stepProvider = decision.provider;
          console.log(`[workflow] step ${step.id} auto-routed → ${stepProvider} (${decision.reason})`);
        } catch { stepProvider = "claude"; }
      }

      // ── 測試注入路徑 ──────────────────────────────────────────────────────────
      // _testStepRunner 設定時完全繞過 agentManager，供單元測試使用。
      // timeout 仍以 step.timeoutMs ?? DEFAULT_TIMEOUT_MS 計。不走重試迴圈。
      if (this._testStepRunner) {
        if (signal.aborted) throw new Error("cancelled");
        const testMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let testTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
        try {
          const output = await Promise.race([
            this._testStepRunner(step, promptText, signal),
            new Promise<string>((_, reject) => {
              testTimeoutHandle = setTimeout(() => reject(new Error("step timeout")), testMs);
            }),
          ]);
          outputs[step.id!] = output;
          completed.add(step.id!);
          sessionIds[idx] = "";
          updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
          this.emit("update", runId);
        } finally {
          if (testTimeoutHandle !== null) { clearTimeout(testTimeoutHandle); testTimeoutHandle = null; }
        }
        return;
      }
      // ── 結束測試注入路徑 ───────────────────────────────────────────────────────

      // execute with retries
      const maxRetries = step.retries !== undefined ? step.retries : DEFAULT_RETRIES;
      let lastErr: Error | null = null;
      // per-step timeout：step.timeoutMs 有設 → 固定牆鐘；沒設 → 看活動（見 DEFAULT_TIMEOUT_MS 註解）。
      const explicitTimeout = step.timeoutMs !== undefined;
      const stepTimeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal.aborted) throw new Error("cancelled");

        const session = agentManager.start(
          step.agentId,
          `[workflow ${wf.name}] ${step.id} ${attempt > 0 ? `(retry ${attempt})` : ""}`,
          standing || undefined,
          wf.workspaceId,
          false,
          stepProvider,
          undefined,
          { unattended: true }, // workflow 步驟沒有人即時回覆
        );
        sessionIds[idx] = session.id;
        updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
        this.emit("update", runId);

        // Track whether this attempt succeeded so finally can decide cleanup.
        let attemptSucceeded = false;
        let onEvent: ((evt: any) => void) | null = null;
        let onAbort: (() => void) | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        // 物件包一層：deadline 在 Promise executor（閉包）裡才建立，直接用 let 會被 TS 窄化成 null。
        const activity: { deadline: ActivityDeadline | null } = { deadline: null };

        try {
          // 背景總量限流：workflow step 雖已有 per-run maxConcurrency（預設 2），但仍是
          // 背景工作、會與排程/派工/學習/幕僚長爭同一份 API 額度。搶到槽才 send，槽持有到
          // 本次 attempt settle（result / step timeout / spawn error / abort）才 release。
          // session 已 start（cheap、未打 API），真正 send 延到槽內。
          const output = await withBackgroundSlot(() => {
            // 若排隊等槽期間 run 已被 abort，不再送出 API 請求（節省配額）
            if (signal.aborted) throw new Error("cancelled");
            return Promise.race([
            new Promise<string>((resolve, reject) => {
              let buffer = "";
              let assistantText = "";
              let myTurnId: number | undefined; // 本回合 turnId：只認自己那回合的 result
              onAbort = () => { reject(new Error("cancelled")); };
              onEvent = (evt: any) => {
                activity.deadline?.touch(); // 還在吐字/用工具就不算逾時（僅「看活動」模式）
                if (evt.type === "delta") { if (turnMatches(myTurnId, evt.turnId)) buffer += evt.payload; }
                else if (evt.type === "message") { if (turnMatches(myTurnId, evt.turnId)) assistantText = evt.payload.content; }
                else if (evt.type === "result") {
                  if (turnMatches(myTurnId, evt.turnId)) resolve(assistantText || buffer);
                } else if (evt.type === "error" && String(evt.payload).startsWith("spawn")) {
                  reject(new Error(String(evt.payload)));
                }
              };
              session.on("event", onEvent);
              signal.addEventListener("abort", onAbort);
              myTurnId = agentManager.send(session.id, promptText).turnId;
            }),
            new Promise<string>((_, reject) => {
              const scaled = stepTimeoutMs * Math.pow(1.5, attempt);
              if (explicitTimeout) {
                timeoutHandle = setTimeout(() => reject(new Error("step timeout")), scaled);
              } else {
                activity.deadline = createActivityDeadline({
                  idleMs: scaled,
                  hardMs: DEFAULT_STEP_MAX_MS,
                  onExpire: () => reject(new Error("step timeout")),
                });
              }
            }),
            ]);
          }, { label: `workflow:${step.id}` });

          attemptSucceeded = true;
          outputs[step.id!] = output;
          completed.add(step.id!);
          updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
          this.emit("update", runId);
          return;
        } catch (e: any) {
          lastErr = e;
          if (e.message === "cancelled") throw e;
          // 逾時類不重試——重跑必然再逾時，白燒 token
          if (!isRetryableError(e)) break;
          if (attempt < maxRetries) {
            const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
            console.warn(`[workflow] step ${step.id} attempt ${attempt + 1} failed: ${e.message}; retrying in ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
          }
        } finally {
          // 清除逾時計時器，避免 handle 殘留。
          if (timeoutHandle !== null) { clearTimeout(timeoutHandle); timeoutHandle = null; }
          activity.deadline?.clear();
          activity.deadline = null;
          // Always remove listeners to prevent leaks on timeout / error paths.
          if (onEvent) session.removeListener("event", onEvent);
          if (onAbort) signal.removeEventListener("abort", onAbort);
          // Stop and remove zombie sessions from failed / timed-out attempts.
          // Successful attempts keep their session alive (caller may need it).
          if (!attemptSucceeded) {
            agentManager.stop(session.id);
          }
        }
      }
      throw lastErr || new Error(`step ${step.id} failed`);
    };

    const maxConcurrency = wf.maxConcurrency && wf.maxConcurrency > 0 ? wf.maxConcurrency : DEFAULT_MAX_CONCURRENCY;

    // Schedule loop: keep launching ready steps until all done
    const tickStartReady = async () => {
      while (true) {
        if (signal.aborted) throw new Error("cancelled");
        const ready = steps.filter((s) =>
          !completed.has(s.id!) &&
          !inFlight.has(s.id!) &&
          depsReady(s, completed)
        );
        if (ready.length === 0) {
          if (inFlight.size === 0) return; // done
          await Promise.race([...inFlight.values()]);
          continue;
        }
        const slots = maxConcurrency - inFlight.size;
        for (const s of ready.slice(0, Math.max(1, slots))) {
          const idx = stepIndexMap.get(s.id!)!;
          const p = tryRunStep(s, idx).finally(() => { inFlight.delete(s.id!); });
          inFlight.set(s.id!, p);
          if (inFlight.size >= maxConcurrency) break;
        }
        if (inFlight.size > 0) {
          await Promise.race([...inFlight.values()]);
        }
      }
    };

    try {
      await tickStartReady();
      updateRun(runId, {
        status: "done",
        currentStep: steps.length,
        sessionIds,
        stepOutputs: outputs,
        endedAt: Date.now(),
      });
      this.emit("update", runId);
      this.active.delete(runId);
    } catch (e: any) {
      if (e.message === "cancelled") {
        updateRun(runId, { status: "cancelled", sessionIds, stepOutputs: outputs, endedAt: Date.now() });
      } else {
        // Fail-fast：主動 abort 所有在途兄弟步驟，避免孤兒 session 繼續燒 token。
        // this.active 在 delete 之前仍有 entry，abort 後兄弟步驟收到 signal 會 throw "cancelled"。
        this.active.get(runId)?.abort();
        updateRun(runId, { status: "error", error: e.message, sessionIds, stepOutputs: outputs, endedAt: Date.now() });
      }
      this.emit("update", runId);
      this.active.delete(runId);
    }
  }
}

export function ancestorsOf(id: string, steps: WorkflowStep[]): Set<string> {
  const out = new Set<string>();
  const stepsById = new Map(steps.map((s) => [s.id!, s]));
  const visit = (sid: string) => {
    const s = stepsById.get(sid);
    if (!s) return;
    for (const d of s.dependsOn || []) {
      if (!out.has(d)) {
        out.add(d);
        visit(d);
      }
    }
  };
  visit(id);
  return out;
}

export function descendantsOf(id: string, steps: WorkflowStep[]): Set<string> {
  const out = new Set<string>();
  const visit = (sid: string) => {
    for (const s of steps) {
      if ((s.dependsOn || []).includes(sid) && !out.has(s.id!)) {
        out.add(s.id!);
        visit(s.id!);
      }
    }
  };
  visit(id);
  return out;
}

export const workflowRunner = new WorkflowRunner();

/**
 * 開機對帳：
 * - status='running' → 標記為 'error'（in-memory AbortController 重啟後已消失，無法安全繼續）。
 * - status='paused'  → 保持 paused 不變。
 *   paused run 的 stepOutputs + currentStep 已持久化在 DB，
 *   可透過既有 resume API（resumeRunId + fromStepId）由 UI 續跑。
 *   直接改 error 會丟失中間結果，得不償失。
 *
 * 回傳受影響的 running run 數（paused 不計）。
 */
export function reconcileWorkflowRunsOnBoot(): number {
  const running = listWorkflowRunsByStatus("running");
  const msg = "server restarted — 請重新啟動 workflow run";
  for (const r of running) {
    updateRun(r.id, { status: "error", error: msg, endedAt: Date.now() });
  }
  return running.length;
}
