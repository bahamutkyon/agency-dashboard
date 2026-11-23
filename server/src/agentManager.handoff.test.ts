import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { shouldDetectHandoff, AgentManager } from "./agentManager.js";
import { upsertSession, getSession, deleteSession, DEFAULT_WORKSPACE_ID } from "./store.js";

describe("shouldDetectHandoff", () => {
  it("只認專案經理＋有工作區＋非自動化場次", () => {
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "👨‍💼 專案經理" })).toBe(true);
    expect(shouldDetectHandoff({ agentId: "content-creator", workspaceId: "w", title: "x" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: undefined, title: "x" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "[排程] 週報" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "🤝 受派諮詢：x" })).toBe(false);
  });
});

// 接線：message 事件 → 偵測 HANDOFF → 呼叫註冊的 handler；handler 例外不得影響存檔。
const HANDOFF_MSG = "交接單整理好了\n=== HANDOFF ===\n🎯 目標：定價\n⏭️ 下一步：拍照\n=== END HANDOFF ===";
const created: string[] = [];
afterEach(() => { for (const id of created) { try { deleteSession(id); } catch { /* ignore */ } } created.length = 0; });

function wire(agentId: string, title: string) {
  const id = `hoff_wire_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  upsertSession({ id, workspaceId: DEFAULT_WORKSPACE_ID, agentId, title, provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  created.push(id);
  const mgr = new AgentManager();
  const io = { emit: vi.fn() };
  mgr.setIo(io);
  const fake = Object.assign(new EventEmitter(), { id, agentId, workspaceId: DEFAULT_WORKSPACE_ID });
  (mgr as any).attachPersistence(fake);
  return { id, mgr, io, fake };
}

describe("message 事件的交接接線", () => {
  it("專案經理輸出 HANDOFF → handler 收到 (場次, 交接單內文, io)", () => {
    const { id, mgr, io, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn();
    mgr.registerHandoffHandler(h);
    fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } });
    expect(h).toHaveBeenCalledWith(id, "🎯 目標：定價\n⏭️ 下一步：拍照", io);
  });

  it("沒有標記、或非專案經理 → 不呼叫", () => {
    const a = wire("agents-orchestrator", "👨‍💼 專案經理");
    const ha = vi.fn(); a.mgr.registerHandoffHandler(ha);
    a.fake.emit("event", { type: "message", payload: { content: "普通回覆" } });
    expect(ha).not.toHaveBeenCalled();
    const b = wire("content-creator", "x");
    const hb = vi.fn(); b.mgr.registerHandoffHandler(hb);
    b.fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } });
    expect(hb).not.toHaveBeenCalled();
  });

  it("自動化場次（排程）的專案經理輸出 HANDOFF → 不呼叫", () => {
    const { mgr, fake } = wire("agents-orchestrator", "[排程] 週報");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } });
    expect(h).not.toHaveBeenCalled();
  });

  it("專案經理照抄手冊範本示範格式 → 不呼叫（誤觸發防護）", () => {
    const { mgr, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    const demo = "交接單長這樣：\n```\n=== HANDOFF ===\n🎯 目標：這場要達成什麼\n⏭️ 下一步：接手後第一件要做的事\n=== END HANDOFF ===\n```";
    fake.emit("event", { type: "message", payload: { content: demo } });
    expect(h).not.toHaveBeenCalled();
  });

  it("handler 丟例外 → 不外拋，訊息照樣存檔", () => {
    const { id, mgr, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    mgr.registerHandoffHandler(() => { throw new Error("boom"); });
    expect(() => fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } })).not.toThrow();
    expect(getSession(id)!.messages.some((m) => m.role === "assistant" && m.content === HANDOFF_MSG)).toBe(true);
  });
});

// 按鈕強制交接：PM 沒照格式也要交接（拿它最後一則回覆當交接單）。
describe("按鈕強制交接的保底", () => {
  it("強制回合結束沒有 HANDOFF 標記 → 用最後一則回覆當交接單呼叫 handler", () => {
    const { id, mgr, io, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    (mgr as any).markForcedHandoff(id);
    fake.emit("event", { type: "message", payload: { content: "我先看一下檔案" } });
    fake.emit("event", { type: "message", payload: { content: "交接整理好了：售價 1200、不走 FBA" } });
    expect(h).not.toHaveBeenCalled();
    fake.emit("event", { type: "result", payload: {} });
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(id, "交接整理好了：售價 1200、不走 FBA", io);
  });

  it("強制回合有 HANDOFF 標記 → 只交接一次（結束時不再保底）", () => {
    const { mgr, fake, id } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    (mgr as any).markForcedHandoff(id);
    fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } });
    fake.emit("event", { type: "result", payload: {} });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("沒按鈕（一般回合）結束 → 不保底", () => {
    const { mgr, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    fake.emit("event", { type: "message", payload: { content: "普通回覆" } });
    fake.emit("event", { type: "result", payload: {} });
    expect(h).not.toHaveBeenCalled();
  });

  it("強制回合出錯中斷 → 清掉，下一回合結束不會誤交接", () => {
    const { mgr, fake, id } = wire("agents-orchestrator", "👨‍💼 專案經理");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    (mgr as any).markForcedHandoff(id);
    fake.emit("event", { type: "status", payload: "error" });
    fake.emit("event", { type: "message", payload: { content: "下一回合的回覆" } });
    fake.emit("event", { type: "result", payload: {} });
    expect(h).not.toHaveBeenCalled();
  });

  it("自動化場次即使被標強制也不交接", () => {
    const { mgr, fake, id } = wire("agents-orchestrator", "[排程] 週報");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    (mgr as any).markForcedHandoff(id);
    fake.emit("event", { type: "message", payload: { content: "回覆" } });
    fake.emit("event", { type: "result", payload: {} });
    expect(h).not.toHaveBeenCalled();
  });
});

describe("send：交接意圖附提醒（只送模型、不進歷史）", () => {
  function withFakeSend(agentId: string) {
    const w = wire(agentId, "👨‍💼 專案經理");
    const sent: string[] = [];
    Object.assign(w.fake, { send: (t: string) => { sent.push(t); return "sent"; }, queuedMessages: [] });
    (w.mgr as any).sessions.set(w.id, w.fake);
    return { ...w, sent };
  }

  it("專案經理＋交接說法 → 送出的文字帶提醒，DB 存原文", () => {
    const { id, mgr, sent } = withFakeSend("agents-orchestrator");
    expect(mgr.send(id, "幫我接續到下個專案經理").ok).toBe(true);
    expect(sent[0]).toContain("=== HANDOFF ===");
    expect(sent[0]).toContain("幫我接續到下個專案經理");
    const users = getSession(id)!.messages.filter((m) => m.role === "user");
    expect(users.at(-1)!.content).toBe("幫我接續到下個專案經理");
  });

  it("forceHandoff → 帶按鈕版提醒並標記強制（回合結束會保底）", () => {
    const { id, mgr, sent, fake } = withFakeSend("agents-orchestrator");
    const h = vi.fn(); mgr.registerHandoffHandler(h);
    mgr.send(id, "請整理交接，換到新對話繼續", { forceHandoff: true });
    expect(sent[0]).toContain("交接鈕");
    fake.emit("event", { type: "message", payload: { content: "整理好了" } });
    fake.emit("event", { type: "result", payload: {} });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("一般訊息、或非專案經理 → 不加提醒", () => {
    const a = withFakeSend("agents-orchestrator");
    a.mgr.send(a.id, "售價定 1200");
    expect(a.sent[0]).not.toContain("HANDOFF");
    const b = withFakeSend("content-creator");
    b.mgr.send(b.id, "請整理交接");
    expect(b.sent[0]).not.toContain("HANDOFF");
  });
});
