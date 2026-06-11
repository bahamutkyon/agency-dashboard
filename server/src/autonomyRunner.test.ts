import { describe, it, expect } from "vitest";
import { startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, type AutonomyDeps } from "./autonomyRunner.js";
import { getRun, listPending, getActiveRunForSession } from "./store/autonomy.js";

function makeDeps(scripted: string[]): { deps: AutonomyDeps; sent: string[]; clock: { t: number } } {
  const sent: string[] = [];
  const clock = { t: 1000 };
  let i = 0;
  const deps: AutonomyDeps = {
    sendTurn: async (_sid, prompt) => { sent.push(prompt); return scripted[i++] ?? "=== ACTION ===\nkind: goal_done\nsummary: 收尾\n=== END ACTION ==="; },
    runDispatch: async () => "派工結果",
    now: () => clock.t,
    emit: () => {},
  };
  return { deps, sent, clock };
}

describe("autonomyRunner 狀態機", () => {
  it("規劃 → 等批計畫", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 三步計畫\ndetail: 1.a 2.b 3.c\n=== END ACTION ==="]);
    const runId = await startRun("sess1", "w1", "完成某任務", {}, deps);
    expect(getRun(runId)?.status).toBe("awaiting_plan_approval");
    expect(listPending("sess1").some((p) => p.kind === "plan")).toBe(true);
  });

  it("批計畫 → 逐步跑 → goal_done 結束", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: next_step\nsummary: 第一步完成\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess2", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("done");
    expect(getRun(runId)?.stepCount).toBeGreaterThanOrEqual(1);
  });

  it("遇到高風險動作 → paused_for_action，批准後續行", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: external_send\nrisk: high\nsummary: 寄信給客戶\ndetail: 內容…\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess3", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("paused_for_action");
    const pa = listPending("sess3").find((p) => p.kind === "external_send")!;
    expect(pa).toBeTruthy();
    await approveAction(pa.id);
    expect(getRun(runId)?.status).toBe("done");
  });

  it("拒絕高風險動作 → 指示替代、不殺 run", async () => {
    const { deps, sent } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: destructive\nsummary: 刪資料夾\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 改用別法達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess4", "w1", "g", {}, deps);
    await approvePlan(runId);
    const pa = listPending("sess4").find((p) => p.kind === "destructive")!;
    await rejectAction(pa.id);
    expect(getRun(runId)?.status).toBe("done");
    expect(sent.some((p) => p.includes("被拒") || p.includes("替代"))).toBe(true);
  });

  it("need_input → paused_for_input，provideInput 後續行", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: need_input\nsummary: 請問預算多少\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
    ]);
    const runId = await startRun("sess5", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("paused_for_input");
    await provideInput(runId, "預算一萬");
    expect(getRun(runId)?.status).toBe("done");
  });

  it("步數預算用盡 → budget_exhausted", async () => {
    const loopStep = "=== ACTION ===\nkind: next_step\nsummary: 又一步\n=== END ACTION ===";
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      loopStep, loopStep, loopStep, loopStep, loopStep,
    ]);
    const runId = await startRun("sess6", "w1", "g", { maxSteps: 2 }, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("budget_exhausted");
  });

  it("時間預算用盡 → budget_exhausted", async () => {
    const loopStep = "=== ACTION ===\nkind: next_step\nsummary: 步\n=== END ACTION ===";
    const { deps, clock } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      loopStep, loopStep, loopStep,
    ]);
    const orig = deps.sendTurn;
    deps.sendTurn = async (s, p) => { clock.t += 60_000; return orig(s, p); };
    const runId = await startRun("sess7", "w1", "g", { maxSteps: 99, maxWallMs: 90_000 }, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("budget_exhausted");
  });

  it("stopRun → stopped", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ==="]);
    const runId = await startRun("sess8", "w1", "g", {}, deps);
    await stopRun(runId);
    expect(getRun(runId)?.status).toBe("stopped");
    expect(getActiveRunForSession("sess8")).toBeUndefined();
  });
});
