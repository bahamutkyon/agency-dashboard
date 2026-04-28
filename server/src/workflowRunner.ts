/**
 * Sequential workflow runner. For each step, spawns an agent session, sends
 * the step's prompt (with `{{out}}` substituted with the previous step's
 * output), and waits for the result event before moving on.
 *
 * Each step's session is persisted normally so the user can review the full
 * conversation of any step from the History panel.
 */
import { EventEmitter } from "node:events";
import { agentManager } from "./agentManager.js";
import {
  getWorkflow, createRun, updateRun, getWorkspace, type Workflow, type WorkflowRun,
} from "./store.js";

interface RunOptions {
  workflowId: string;
  initialInput?: string; // overrides {{out}} for the FIRST step
}

class WorkflowRunner extends EventEmitter {
  private active = new Map<string, AbortController>();

  async run(opts: RunOptions): Promise<WorkflowRun> {
    const wf = getWorkflow(opts.workflowId);
    if (!wf) throw new Error("workflow not found");
    if (wf.steps.length === 0) throw new Error("workflow has no steps");

    const run = createRun(wf.id, wf.workspaceId);
    const ctrl = new AbortController();
    this.active.set(run.id, ctrl);

    // run async; return the initial run record immediately
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
      const promptText = step.prompt.replace(/\{\{out\}\}/g, prevOutput || "(無上一步輸出)");

      // start session
      const session = agentManager.start(
        step.agentId,
        `[workflow ${wf.name}] step ${i + 1}/${wf.steps.length}`,
        standing || undefined,
        wf.workspaceId,
      );
      sessionIds.push(session.id);
      updateRun(runId, { currentStep: i, sessionIds });
      this.emit("update", runId);

      // wait for result event
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
          } else if (evt.type === "error" && evt.payload && String(evt.payload).startsWith("spawn")) {
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
