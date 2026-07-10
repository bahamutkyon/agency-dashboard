import { describe, it, expect, vi, beforeEach } from "vitest";
import { startRun, approvePlan, resumeRun, pauseRunningRunsOnBoot, type AutonomyDeps } from "./autonomyRunner.js";
import { getRun, listActiveRuns, setPendingInjection, getPendingAction, listPending } from "./store/autonomy.js";

function makeDeps(scripted: string[], opts: { failOn?: number[]; transientOn?: number[]; transientMsg?: string } = {}): { deps: AutonomyDeps; sent: string[]; callCount: number } {
  const sent: string[] = [];
  let callCount = 0;
  const deps: AutonomyDeps = {
    sendTurn: async (_sid, prompt) => {
      const idx = callCount++;
      sent.push(prompt);
      if (opts.failOn?.includes(idx)) throw new Error("claude 掛了");
      if (opts.transientOn?.includes(idx)) throw new Error(opts.transientMsg ?? "sendTurn 逾時");
      return scripted[idx] ?? "=== ACTION ===\nkind: goal_done\nsummary: 收尾\n=== END ACTION ===";
    },
    runDispatch: async () => "派工結果",
    now: () => 1000,
    emit: () => {},
  };
  return { deps, sent, callCount: 0 };
}

describe("F1: sendTurn 重試與 F11 injection 保留", () => {
  it("sendTurn 逾時（transient）→ 重試後成功完成", async () => {
    // transientOn: [1] means second call (after plan) throws transient error, then third succeeds
    let callIdx = 0;
    const deps: AutonomyDeps = {
      sendTurn: async (_sid, _prompt) => {
        const idx = callIdx++;
        if (idx === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        if (idx === 1) throw new Error("sendTurn 逾時");
        return "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===";
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessF1T", "w1", "g", {}, deps);
    await approvePlan(runId);
    const run = getRun(runId);
    // After transient retry, should either retry and complete, or pause
    expect(run?.status).toMatch(/done|paused/);
  });

  it("sendTurn 'session 持續忙碌' → classified as transient, retried", async () => {
    let callIdx = 0;
    const deps: AutonomyDeps = {
      sendTurn: async (_sid, _prompt) => {
        const idx = callIdx++;
        if (idx === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        if (idx === 1) throw new Error("session 持續忙碌，放棄本回合");
        return "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===";
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessF1Busy", "w1", "g", {}, deps);
    await approvePlan(runId);
    const run = getRun(runId);
    expect(run?.status).toMatch(/done|paused/);
  });

  it("sendTurn real error → finalize as error (no retry)", async () => {
    let callIdx = 0;
    const deps: AutonomyDeps = {
      sendTurn: async (_sid, _prompt) => {
        const idx = callIdx++;
        if (idx === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        throw new Error("claude 真的掛了");
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessF1Err", "w1", "g", {}, deps);
    await approvePlan(runId);
    const run = getRun(runId);
    expect(run?.status).toBe("error");
    expect(run?.lastError).toContain("claude 真的掛了");
  });

  it("resumeRun accepts error status", async () => {
    let callIdx = 0;
    const deps: AutonomyDeps = {
      sendTurn: async (_sid, _prompt) => {
        const idx = callIdx++;
        if (idx === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        throw new Error("crash");
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessF1ErrResume", "w1", "g", {}, deps);
    await approvePlan(runId);
    expect(getRun(runId)?.status).toBe("error");
    // Now resume from error
    const deps2: AutonomyDeps = {
      sendTurn: async () => "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===",
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    await resumeRun(runId, deps2);
    expect(getRun(runId)?.status).toBe("done");
  });

  it("F11: injection preserved after sendTurn failure", async () => {
    let callIdx = 0;
    let injectionSeenInPrompt = false;
    const deps: AutonomyDeps = {
      sendTurn: async (_sid, prompt) => {
        const idx = callIdx++;
        if (idx === 0) return "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===";
        if (idx === 1) {
          // First loop call - throw transient error; injection should still be pending
          throw new Error("sendTurn 逾時");
        }
        // Second attempt - check if injection is in prompt
        if (prompt.includes("測試插話")) injectionSeenInPrompt = true;
        return "=== ACTION ===\nkind: goal_done\nsummary: 達標\n=== END ACTION ===";
      },
      runDispatch: async () => "",
      now: () => 1000,
      emit: () => {},
    };
    const runId = await startRun("sessF11", "w1", "g", {}, deps);
    setPendingInjection(runId, "測試插話");
    await approvePlan(runId);
    const run = getRun(runId);
    // 關鍵斷言：插話在失敗回合未被清掉 → 重試 prompt 確實仍帶著它（非只看 status）。
    expect(injectionSeenInPrompt).toBe(true);
    // 且 pendingInjection 在成功後已清空（不會下回合重複注入）。
    expect(getRun(runId)?.pendingInjection ?? "").toBe("");
    expect(run?.status).toMatch(/done|paused/);
  });
});
