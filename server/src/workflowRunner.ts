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
import {
  getWorkflow, createRun, updateRun, getWorkspace, getRun,
  MAX_LOOP_ITERATIONS,
  type Workflow, type WorkflowRun, type WorkflowStep,
} from "./store.js";

interface RunOptions {
  workflowId: string;
  initialInput?: string;
  // Resume options:
  resumeRunId?: string;       // copy outputs from this run for unchanged steps
  fromStepId?: string;        // re-execute this step + its descendants only
}

const MAX_CONCURRENCY = 2;
const DEFAULT_RETRIES = 2;

function normalizeSteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s, i) => ({
    ...s,
    id: s.id || `step_${i + 1}`,
    // backward compat: if no explicit dependsOn, depend on previous step
    dependsOn: s.dependsOn !== undefined ? s.dependsOn : (i === 0 ? [] : [steps[i - 1].id || `step_${i}`]),
  }));
}

function validateGraph(steps: WorkflowStep[]): string | null {
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

  approve(runId: string) {
    const p = this.paused.get(runId);
    if (p) {
      p.resume();
      this.paused.delete(runId);
    }
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
            updateRun(runId, { status: "running", iterations });
            this.emit("update", runId);
            return; // skip running THIS step; scheduler will pick up the rewound chain
          }
        }
        updateRun(runId, { status: "running" });
        this.emit("update", runId);
      }

      // resolve dependency outputs and substitute prompt vars
      const directDeps = step.dependsOn || [];
      const lastDepOutput = directDeps.length > 0
        ? (outputs[directDeps[directDeps.length - 1]] || "")
        : initialInput || "";
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

      // execute with retries
      const maxRetries = step.retries !== undefined ? step.retries : DEFAULT_RETRIES;
      let lastErr: Error | null = null;
      let baseTimeout = 120_000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal.aborted) throw new Error("cancelled");

        const session = agentManager.start(
          step.agentId,
          `[workflow ${wf.name}] ${step.id} ${attempt > 0 ? `(retry ${attempt})` : ""}`,
          standing || undefined,
          wf.workspaceId,
          false,
        );
        sessionIds[idx] = session.id;
        updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
        this.emit("update", runId);

        try {
          const output = await Promise.race([
            new Promise<string>((resolve, reject) => {
              let buffer = "";
              let assistantText = "";
              const onAbort = () => { reject(new Error("cancelled")); };
              const onEvent = (evt: any) => {
                if (evt.type === "delta") buffer += evt.payload;
                else if (evt.type === "message") assistantText = evt.payload.content;
                else if (evt.type === "result") {
                  session.removeListener("event", onEvent);
                  signal.removeEventListener("abort", onAbort);
                  resolve(assistantText || buffer);
                } else if (evt.type === "error" && String(evt.payload).startsWith("spawn")) {
                  session.removeListener("event", onEvent);
                  signal.removeEventListener("abort", onAbort);
                  reject(new Error(String(evt.payload)));
                }
              };
              session.on("event", onEvent);
              signal.addEventListener("abort", onAbort);
              agentManager.send(session.id, promptText);
            }),
            new Promise<string>((_, reject) => {
              setTimeout(() => reject(new Error("step timeout")), baseTimeout * Math.pow(1.5, attempt));
            }),
          ]);

          outputs[step.id!] = output;
          completed.add(step.id!);
          updateRun(runId, { currentStep: idx, sessionIds, stepOutputs: outputs });
          this.emit("update", runId);
          return;
        } catch (e: any) {
          lastErr = e;
          if (e.message === "cancelled") throw e;
          if (attempt < maxRetries) {
            const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
            console.warn(`[workflow] step ${step.id} attempt ${attempt + 1} failed: ${e.message}; retrying in ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
      }
      throw lastErr || new Error(`step ${step.id} failed`);
    };

    // Schedule loop: keep launching ready steps until all done
    const tickStartReady = async () => {
      while (true) {
        if (signal.aborted) throw new Error("cancelled");
        const ready = steps.filter((s) =>
          !completed.has(s.id!) &&
          !inFlight.has(s.id!) &&
          (s.dependsOn || []).every((d) => completed.has(d))
        );
        if (ready.length === 0) {
          if (inFlight.size === 0) return; // done
          // wait for any in-flight to finish
          await Promise.race([...inFlight.values()]);
          continue;
        }
        // Start up to MAX_CONCURRENCY - inFlight.size new ones
        const slots = MAX_CONCURRENCY - inFlight.size;
        for (const s of ready.slice(0, Math.max(1, slots))) {
          const idx = stepIndexMap.get(s.id!)!;
          const p = tryRunStep(s, idx).finally(() => { inFlight.delete(s.id!); });
          inFlight.set(s.id!, p);
          if (inFlight.size >= MAX_CONCURRENCY) break;
        }
        // wait for at least one to finish before checking again
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
        updateRun(runId, { status: "error", error: e.message, sessionIds, stepOutputs: outputs, endedAt: Date.now() });
      }
      this.emit("update", runId);
      this.active.delete(runId);
    }
  }
}

function ancestorsOf(id: string, steps: WorkflowStep[]): Set<string> {
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

function descendantsOf(id: string, steps: WorkflowStep[]): Set<string> {
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
