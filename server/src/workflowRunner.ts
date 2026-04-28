/**
 * Sequential workflow runner with pause + skip-if support.
 *
 * Each step can optionally:
 *   - pauseBefore: pause runner before this step, wait for user `approve()`
 *   - skipIfMatch: a regex; if previous {{out}} matches → skip this step
 *
 * For each agent step, spawns an agent session, sends the rendered prompt
 * (with `{{out}}` substituted), waits for the result event before moving on.
 * Each step's session is persisted normally so the user can review the full
 * conversation of any step from the History panel.
 */
import { EventEmitter } from "node:events";
import { agentManager } from "./agentManager.js";
import {
  getWorkflow, createRun, updateRun, getWorkspace, getRun,
  type Workflow, type WorkflowRun,
} from "./store.js";

interface RunOptions {
  workflowId: string;
  initialInput?: string;
}

interface PausedRun {
  resume: () => void;
}

class WorkflowRunner extends EventEmitter {
  private active = new Map<string, AbortController>();
  private paused = new Map<string, PausedRun>();

  async run(opts: RunOptions): Promise<WorkflowRun> {
    const wf = getWorkflow(opts.workflowId);
    if (!wf) throw new Error("workflow not found");
    if (wf.steps.length === 0) throw new Error("workflow has no steps");

    const run = createRun(wf.id, wf.workspaceId);
    const ctrl = new AbortController();
    this.active.set(run.id, ctrl);

    this.execute(wf, run.id, opts.initialInput || "", ctrl.signal).catch((e) => {
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
    if (p) { this.paused.delete(runId); }
  }

  approve(runId: string) {
    const p = this.paused.get(runId);
    if (p) {
      p.resume();
      this.paused.delete(runId);
    }
  }

  private async execute(wf: Workflow, runId: string, initialInput: string, signal: AbortSignal) {
    const standing = getWorkspace(wf.workspaceId)?.standingContext || "";
    let prevOutput = initialInput;
    const sessionIds: string[] = [];

    for (let i = 0; i < wf.steps.length; i++) {
      if (signal.aborted) {
        updateRun(runId, { status: "cancelled", endedAt: Date.now() });
        this.emit("update", runId);
        return;
      }
      const step = wf.steps[i];

      // skipIf: check if previous output matches the regex
      if (step.skipIfMatch && prevOutput) {
        try {
          const re = new RegExp(step.skipIfMatch, "i");
          if (re.test(prevOutput)) {
            console.log(`[workflow] step ${i} skipped (skipIfMatch matched)`);
            sessionIds.push(""); // placeholder for skipped step
            updateRun(runId, { currentStep: i, sessionIds });
            this.emit("update", runId);
            continue;
          }
        } catch (e) {
          console.warn(`[workflow] invalid skipIfMatch regex on step ${i}:`, step.skipIfMatch);
        }
      }

      // pauseBefore: wait for user approval
      if (step.pauseBefore) {
        updateRun(runId, { status: "paused", currentStep: i, sessionIds });
        this.emit("update", runId);
        await new Promise<void>((resolve, reject) => {
          this.paused.set(runId, { resume: resolve });
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
        });
        // re-check abort
        if (signal.aborted) {
          updateRun(runId, { status: "cancelled", endedAt: Date.now() });
          this.emit("update", runId);
          return;
        }
        updateRun(runId, { status: "running" });
        this.emit("update", runId);
      }

      const promptText = step.prompt.replace(/\{\{out\}\}/g, prevOutput || "(無上一步輸出)");

      const session = agentManager.start(
        step.agentId,
        `[workflow ${wf.name}] step ${i + 1}/${wf.steps.length}`,
        standing || undefined,
        wf.workspaceId,
        false,
      );
      sessionIds.push(session.id);
      updateRun(runId, { currentStep: i, sessionIds });
      this.emit("update", runId);

      const output = await new Promise<string>((resolve, reject) => {
        let buffer = "";
        let assistantText = "";
        const onAbort = () => {
          session.removeListener("event", onEvent);
          reject(new Error("cancelled"));
        };
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
      });

      prevOutput = output;
    }

    updateRun(runId, {
      status: "done",
      currentStep: wf.steps.length,
      sessionIds,
      endedAt: Date.now(),
    });
    this.emit("update", runId);
    this.active.delete(runId);
  }
}

export const workflowRunner = new WorkflowRunner();
