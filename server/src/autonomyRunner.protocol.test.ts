/**
 * autonomyRunner — PROTOCOL 瘦身
 *
 * 驗證：
 * 1. 首回合（planPrompt）帶完整 PROTOCOL 全文
 * 2. loop 第二步之後只帶一行提醒，不重貼全文
 * 3. resume 後的第一次 sendTurn 重貼全文（安全優先）
 * 4. resume 後的第二步只帶提醒
 */
import { describe, it, expect } from "vitest";
import {
  startRun,
  approvePlan,
  resumeRun,
  pauseRunningRunsOnBoot,
  PROTOCOL,
  PROTOCOL_REMINDER,
  type AutonomyDeps,
} from "./autonomyRunner.js";
import { getRun, listActiveRuns } from "./store/autonomy.js";

function makeDepsCapture(scripted: string[]): { deps: AutonomyDeps; sent: string[] } {
  const sent: string[] = [];
  let i = 0;
  const deps: AutonomyDeps = {
    sendTurn: async (_sid, prompt) => {
      sent.push(prompt);
      return scripted[i++] ?? "=== ACTION ===\nkind: goal_done\nsummary: done\n=== END ACTION ===";
    },
    runDispatch: async () => "派工結果",
    now: () => Date.now(),
    emit: () => {},
  };
  return { deps, sent };
}

describe("autonomyRunner PROTOCOL 瘦身", () => {
  it("startRun 的 planPrompt 含完整 PROTOCOL 全文", async () => {
    const { deps, sent } = makeDepsCapture([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
    ]);
    await startRun("proto-plan-sess", "proto-ws", "做個測試", {}, deps);
    // planPrompt 是 sent[0]
    expect(sent[0]).toContain(PROTOCOL);
  });

  it("loop 第二步只含提醒，不含完整 PROTOCOL", async () => {
    const { deps, sent } = makeDepsCapture([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
      "=== ACTION ===\nkind: next_step\nsummary: 第一步完成\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: done\n=== END ACTION ===",
    ]);
    const runId = await startRun("proto-loop-sess", "proto-ws2", "做個測試", {}, deps);
    await approvePlan(runId);
    // sent[0] = planPrompt（含 PROTOCOL）
    // sent[1] = loop 第一步（核可後）
    // sent[2] = loop 第二步
    // 所有 loop 步驟（sent[1..] ）只含提醒，不含完整 PROTOCOL 區塊的核心文字
    // 用 PROTOCOL 的前幾個獨特字元（「你正在「自主模式」」）來驗證
    const protocolSignature = "你正在「自主模式」下工作";
    expect(sent[0]).toContain(protocolSignature); // planPrompt 含
    expect(sent[1]).not.toContain(protocolSignature); // loop step 不含
    // 但 loop step 要含提醒
    expect(sent[1]).toContain(PROTOCOL_REMINDER);
  });

  it("resume 後第一步重貼全文", async () => {
    // 1. startRun → plan approval pending（不呼叫 approvePlan，讓 run 停在 awaiting_plan_approval）
    const { deps } = makeDepsCapture([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
    ]);
    const runId = await startRun("proto-resume-sess", "proto-ws3", "做個測試", {}, deps);
    // planPrompt 已送，protocolSentForRun.has(runId) 為 true
    expect(getRun(runId)?.status).toBe("awaiting_plan_approval");

    // 2. 模擬 server 重啟：pause 並清除 protocolSentForRun
    pauseRunningRunsOnBoot(listActiveRuns);
    expect(getRun(runId)?.status).toBe("paused");

    // 3. resume，捕捉新的 sendTurn
    const { deps: deps2, sent: sent2 } = makeDepsCapture([
      "=== ACTION ===\nkind: goal_done\nsummary: done\n=== END ACTION ===",
    ]);
    await resumeRun(runId, deps2);
    // resume 後第一個 sendTurn 應含完整 PROTOCOL
    expect(sent2[0]).toContain("你正在「自主模式」下工作");
  });

  it("resume 後第二步只帶提醒", async () => {
    // 1. startRun → awaiting_plan_approval（不 approvePlan）
    const { deps } = makeDepsCapture([
      "=== ACTION ===\nkind: plan\nsummary: 計畫\n=== END ACTION ===",
    ]);
    const runId = await startRun("proto-resume2-sess", "proto-ws4", "做個測試", {}, deps);
    expect(getRun(runId)?.status).toBe("awaiting_plan_approval");

    // 2. 模擬 server 重啟
    pauseRunningRunsOnBoot(listActiveRuns);

    // 3. resume 帶 2 步（第一步 next_step，第二步 goal_done）
    const { deps: deps2, sent: sent2 } = makeDepsCapture([
      "=== ACTION ===\nkind: next_step\nsummary: 第一步完成\n=== END ACTION ===",
      "=== ACTION ===\nkind: goal_done\nsummary: done\n=== END ACTION ===",
    ]);
    await resumeRun(runId, deps2);
    // sent2[0] 應含全文 PROTOCOL
    expect(sent2[0]).toContain("你正在「自主模式」下工作");
    // sent2[1] 應只含提醒，不含全文
    expect(sent2[1]).not.toContain("你正在「自主模式」下工作");
    expect(sent2[1]).toContain(PROTOCOL_REMINDER);
  });
});

describe("autonomyRunner PROTOCOL — 派工不是高風險動作（2026-11-25 根因修正）", () => {
  // 11-19 起內部派工已由政策直接執行（dispatchRisk 只攔對外），但 PROTOCOL 還把 dispatch 跟
  // 對外發送/破壞/花錢並列為「高風險、嚴禁自己執行」，專案經理因此回「不派工、不對外、不花錢」。
  const highRiskLine = PROTOCOL.split("\n").find((l) => l.includes("高風險")) ?? "";
  it("高風險那一條不再列 dispatch，且仍保留另外三類", () => {
    expect(highRiskLine).not.toBe("");
    expect(highRiskLine).not.toContain("dispatch");
    expect(highRiskLine).not.toContain("派工");
    for (const k of ["external_send", "destructive", "spend"]) expect(highRiskLine).toContain(k);
  });
  it("明講派工是正常工作方式、專業的事交給同事", () => {
    const dispatchLine = PROTOCOL.split("\n").find((l) => l.includes("dispatch") && l.includes("正常")) ?? "";
    expect(dispatchLine).toContain("同事");
  });
});
