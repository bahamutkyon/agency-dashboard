import { describe, it, expect, vi } from "vitest";
import { startRun } from "./autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending } from "./store/autonomy.js";
import type { AutonomyDeps } from "./autonomyRunner.js";

function mkDeps(turns: string[]): AutonomyDeps {
  let i = 0;
  return {
    sendTurn: vi.fn(async () => turns[Math.min(i++, turns.length - 1)]),
    runDispatch: vi.fn(async () => "（同事回覆：完成）"),
    now: () => Date.now(),
    emit: () => {},
  };
}
const A = (kind: string, detail = "") => `=== ACTION ===\nkind: ${kind}\nrisk: high\nsummary: ${kind}\ndetail: ${detail}\n=== END ACTION ===`;

describe("balanced 自走", () => {
  it("balanced：plan 不彈批准卡、dispatch 自動跑、goal_done 收尾", async () => {
    const dispatch = A("dispatch", "- agentId: marketing-trend-researcher\n  mode: consult\n  task: 研究選題");
    const deps = mkDeps([A("plan", "步驟1 派工"), dispatch, A("goal_done", "完成")]);
    const runId = await startRun("sess-bal", "w1", "做一份內容企劃", { policy: "balanced", maxSteps: 10, maxWallMs: 60000 }, deps);
    expect(getActiveRunForSession("sess-bal")).toBeUndefined();
    expect(getRun(runId)!.status).toBe("done");
    expect(listPending("sess-bal").length).toBe(0);
    expect(deps.runDispatch).toHaveBeenCalledTimes(1);
  });

  it("balanced：external_send 仍會停下等批准（paused_for_action）", async () => {
    const deps = mkDeps([A("plan", "x"), A("external_send", "寄信給客戶"), A("goal_done", "done")]);
    const runId = await startRun("sess-ext", "w1", "通知客戶", { policy: "balanced", maxSteps: 10, maxWallMs: 60000 }, deps);
    expect(getRun(runId)!.status).toBe("paused_for_action");
    const pending = listPending("sess-ext");
    expect(pending.some((p) => p.kind === "external_send")).toBe(true);
  });

  it("manual：plan 仍要批准（向後相容）", async () => {
    const deps = mkDeps([A("plan", "x"), A("dispatch", "- agentId: a\n  mode: consult\n  task: t")]);
    const runId = await startRun("sess-man", "w1", "g", { policy: "manual", maxSteps: 10, maxWallMs: 60000 }, deps);
    expect(getRun(runId)!.status).toBe("awaiting_plan_approval");
  });
});
