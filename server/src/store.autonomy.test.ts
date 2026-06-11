import { describe, it, expect } from "vitest";
import {
  createRun, getRun, updateRunStatus, incrementStep, listActiveRuns, getActiveRunForSession,
  createPendingAction, getPendingAction, listPending, decidePendingAction, markActionExecuted,
} from "./store/autonomy.js";

describe("store/autonomy", () => {
  it("createRun → getRun 往返", () => {
    const r = createRun({ sessionId: "s1", workspaceId: "w1", goal: "做一件事", maxSteps: 20, maxWallMs: 1000 });
    expect(r.status).toBe("planning");
    expect(r.stepCount).toBe(0);
    expect(r.deadlineAt).toBeGreaterThan(r.startedAt);
    expect(getRun(r.id)?.goal).toBe("做一件事");
  });
  it("updateRunStatus / incrementStep", () => {
    const r = createRun({ sessionId: "s2", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(r.id, "running");
    expect(getRun(r.id)?.status).toBe("running");
    incrementStep(r.id);
    expect(getRun(r.id)?.stepCount).toBe(1);
  });
  it("getActiveRunForSession 只回未結束的 run", () => {
    const r = createRun({ sessionId: "s3", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    expect(getActiveRunForSession("s3")?.id).toBe(r.id);
    updateRunStatus(r.id, "done");
    expect(getActiveRunForSession("s3")).toBeUndefined();
  });
  it("listActiveRuns 不含終態", () => {
    const a = createRun({ sessionId: "s4", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(a.id, "running");
    const b = createRun({ sessionId: "s5", workspaceId: "w1", goal: "g", maxSteps: 5, maxWallMs: 1000 });
    updateRunStatus(b.id, "stopped");
    const ids = listActiveRuns().map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });
  it("pending action：create → list → decide → executed", () => {
    const pa = createPendingAction({ sessionId: "s6", workspaceId: "w1", kind: "dispatch", risk: "high", summary: "派工", detail: "x" });
    expect(pa.status).toBe("pending");
    expect(listPending("s6").map((p) => p.id)).toContain(pa.id);
    decidePendingAction(pa.id, "approved");
    expect(getPendingAction(pa.id)?.status).toBe("approved");
    markActionExecuted(pa.id, "做完了");
    expect(getPendingAction(pa.id)?.status).toBe("executed");
    expect(getPendingAction(pa.id)?.result).toBe("做完了");
    expect(listPending("s6")).toHaveLength(0);
  });
});
