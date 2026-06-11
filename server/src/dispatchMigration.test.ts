import { describe, it, expect } from "vitest";
import { detectAndEnqueueDispatch } from "./agentManager.js";
import { listPending } from "./store/autonomy.js";
import { parseDispatchMarker } from "./dispatchParser.js";

describe("手動派工 server 端偵測入列", () => {
  it("PM 訊息含 DISPATCH → 寫 pending_actions(kind=dispatch, runId 空)", () => {
    const sid = `pm_${Date.now()}`;
    const content = "我想請教兩位。\n=== DISPATCH ===\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END DISPATCH ===";
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    const pend = listPending(sid);
    expect(pend).toHaveLength(1);
    expect(pend[0].kind).toBe("dispatch");
    expect(pend[0].runId).toBeUndefined();
  });
  it("非 PM agent 不入列", () => {
    const sid = `x_${Date.now()}`;
    detectAndEnqueueDispatch({ id: sid, agentId: "marketing-content-creator", workspaceId: "w1" }, "=== DISPATCH ===\n- agentId: x\n  mode: consult\n  task: y\n=== END DISPATCH ===");
    expect(listPending(sid)).toHaveLength(0);
  });
  it("同一輪 DISPATCH 重複偵測不重複入列", () => {
    const sid = `pm2_${Date.now()}`;
    const content = "=== DISPATCH ===\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END DISPATCH ===";
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    expect(listPending(sid)).toHaveLength(1);
  });
});

describe("手動派工 approve 分流：detail → items 解析", () => {
  // executeDispatch 的實跑路徑會 spawn claude（runConsult），不在單元測試覆蓋；
  // 此處驗證入列後 detail 能被正確解析回 DispatchItem[]，供 approve handler 餵給 executeDispatch。
  it("入列的 pending dispatch detail 可解析回正確 items", () => {
    const sid = `pm3_${Date.now()}`;
    const content = "=== DISPATCH ===\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n- agentId: marketing-content-creator\n  mode: execute\n  task: 寫貼文\n=== END DISPATCH ===";
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w1" }, content);
    const pa = listPending(sid)[0];
    expect(pa.detail).toBeTruthy();
    const plan = parseDispatchMarker(`=== DISPATCH ===\n${pa.detail}\n=== END DISPATCH ===`);
    expect(plan?.items).toEqual([
      { agentId: "marketing-trend-researcher", mode: "consult", task: "本週選題" },
      { agentId: "marketing-content-creator", mode: "execute", task: "寫貼文" },
    ]);
  });
});
