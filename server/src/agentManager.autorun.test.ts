/**
 * G1 — 聊天內一鍵起自走：orchestrator gate + autorun 標記偵測
 *
 * 標記格式：=== AUTORUN: <目標句> ===
 * Gate：只認 agents-orchestrator 輸出，子 agent 輸出相同標記不觸發
 */
import { describe, it, expect, vi } from "vitest";
import { detectAndEnqueueAutorun } from "./agentManager.js";

const AUTORUN_CONTENT = `好的，我建議開始自走迴圈來完成這個目標：
=== AUTORUN: 本週完成行銷週報並發布 ===
請確認是否啟動自走模式。`;

describe("G1 detectAndEnqueueAutorun — orchestrator gate", () => {
  it("orchestrator 輸出含 AUTORUN 標記 → emit autorun:pending 帶目標", () => {
    const io = { emit: vi.fn() };
    const sid = `autorun_g1_${Date.now().toString(36)}`;
    detectAndEnqueueAutorun(
      { id: sid, agentId: "agents-orchestrator", workspaceId: "w1" },
      AUTORUN_CONTENT,
      io,
    );
    expect(io.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = io.emit.mock.calls[0];
    expect(event).toBe("autonomy:event");
    expect(payload.kind).toBe("autorun:pending");
    expect(payload.sessionId).toBe(sid);
    expect(payload.goal).toBe("本週完成行銷週報並發布");
  });

  it("子 agent 輸出相同 AUTORUN 標記 → gate 擋住，不 emit（安全關鍵）", () => {
    const io = { emit: vi.fn() };
    const sid = `autorun_subagent_${Date.now().toString(36)}`;
    // 子 agent（非 orchestrator）照抄標記
    detectAndEnqueueAutorun(
      { id: sid, agentId: "marketing-content-creator", workspaceId: "w1" },
      AUTORUN_CONTENT,
      io,
    );
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("orchestrator 輸出無 AUTORUN 標記 → 不 emit", () => {
    const io = { emit: vi.fn() };
    const sid = `autorun_nomatch_${Date.now().toString(36)}`;
    detectAndEnqueueAutorun(
      { id: sid, agentId: "agents-orchestrator", workspaceId: "w1" },
      "這是普通的 PM 回覆，沒有自走標記",
      io,
    );
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("無 io 時不拋例外（io 選填）", () => {
    expect(() =>
      detectAndEnqueueAutorun(
        { id: "sess_noio", agentId: "agents-orchestrator", workspaceId: "w1" },
        AUTORUN_CONTENT,
        undefined,
      )
    ).not.toThrow();
  });

  it("空目標句（=== AUTORUN:  ===）→ 不 emit（防空目標起 run）", () => {
    const io = { emit: vi.fn() };
    detectAndEnqueueAutorun(
      { id: "sess_empty_goal", agentId: "agents-orchestrator", workspaceId: "w1" },
      "=== AUTORUN:  ===",
      io,
    );
    expect(io.emit).not.toHaveBeenCalled();
  });

  it("目標句帶空白仍正確 trim", () => {
    const io = { emit: vi.fn() };
    detectAndEnqueueAutorun(
      { id: "sess_trim", agentId: "agents-orchestrator", workspaceId: "w1" },
      "=== AUTORUN:  整理本週報告  ===",
      io,
    );
    expect(io.emit).toHaveBeenCalledTimes(1);
    expect(io.emit.mock.calls[0][1].goal).toBe("整理本週報告");
  });
});
