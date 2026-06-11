import { describe, it, expect } from "vitest";
import { startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, resumeRun, pauseRunningRunsOnBoot, type AutonomyDeps } from "./autonomyRunner.js";
import { getRun, listPending, getActiveRunForSession, listActiveRuns } from "./store/autonomy.js";

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

  it("dispatch 高風險 → approveAction 呼叫 runDispatch 並把結果餵回 loop", async () => {
    const dispatchCalls: { items: any[]; ws: string }[] = [];
    const scripted = [
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: dispatch\nsummary: 派工給研究員\ndetail:\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: 整合完成\n=== END ACTION ===",
    ];
    let i = 0;
    const deps: AutonomyDeps = {
      sendTurn: async () => scripted[i++] ?? "=== ACTION ===\nkind: goal_done\nsummary: x\n=== END ACTION ===",
      runDispatch: async (items, ws) => { dispatchCalls.push({ items, ws }); return "研究員回覆：選題A/B/C"; },
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessD", "wD", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("paused_for_action");
    const pa = listPending("sessD").find((p) => p.kind === "dispatch")!;
    expect(pa).toBeTruthy();
    await approveAction(pa.id);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].items).toEqual([{ agentId: "marketing-trend-researcher", mode: "consult", task: "本週選題" }]);
    expect(dispatchCalls[0].ws).toBe("wD");
    expect(getRun(runId)?.status).toBe("done");
  });

  it("pauseRunningRunsOnBoot 把 active run 轉 paused 並回傳數量", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ==="]);
    const runId = await startRun("sessP", "wP", "g", {}, deps);
    const n = pauseRunningRunsOnBoot(listActiveRuns);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(getRun(runId)?.status).toBe("paused");
  });

  it("resumeRun 從 paused 續跑到 goal_done", async () => {
    const { deps } = makeDeps(["=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ==="]);
    const runId = await startRun("sessR", "wR", "g", {}, deps);
    pauseRunningRunsOnBoot(listActiveRuns);
    expect(getRun(runId)?.status).toBe("paused");
    const { deps: deps2 } = makeDeps(["=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ==="]);
    await resumeRun(runId, deps2);
    expect(getRun(runId)?.status).toBe("done");
  });

  it("sendTurn 進行中被 stop → 不被 in-flight 迭代覆蓋（K1）", async () => {
    let runId = "";
    let i = 0;
    const deps: AutonomyDeps = {
      sendTurn: async () => {
        i++;
        if (i === 1) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        await stopRun(runId); // 模擬使用者在這一步進行中按停
        return "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===";
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    runId = await startRun("sessStop", "wStop", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("stopped"); // 不應被覆蓋成 done
  });

  it("sendTurn 回空字串（session 消失）→ run 轉 error，不空轉", async () => {
    let i = 0;
    const deps: AutonomyDeps = {
      sendTurn: async () => (i++ === 0 ? "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===" : ""),
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessEmpty", "wEmpty", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("error");
  });

  it("重啟後孤兒 pending 被 supersede，reject 不啟動雙迴圈（S1）", async () => {
    const { deps } = makeDeps([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: external_send\nsummary: 寄信\n=== END ACTION ===",
    ]);
    const runId = await startRun("sessZombie", "wZ", "g", {}, deps);
    await approvePlan(runId);
    const pa = listPending("sessZombie").find((p) => p.kind === "external_send")!;
    expect(pa).toBeTruthy();
    pauseRunningRunsOnBoot(listActiveRuns);  // 模擬重啟
    expect(getRun(runId)?.status).toBe("paused");
    expect(listPending("sessZombie")).toHaveLength(0); // 孤兒已 superseded
    await rejectAction(pa.id); // 對孤兒 reject
    expect(getRun(runId)?.status).toBe("paused"); // 沒被改成 running（無雙迴圈）
  });

  it("loop 中 sendTurn 失敗 → run 轉 error（K2）", async () => {
    let i = 0;
    const deps: AutonomyDeps = {
      sendTurn: async () => {
        if (i++ === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        throw new Error("claude 掛了");
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessErr", "wErr", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("error");
    expect(getRun(runId)?.lastError).toContain("claude");
  });
});
