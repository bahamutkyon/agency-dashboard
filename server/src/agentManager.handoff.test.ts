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

  it("handler 丟例外 → 不外拋，訊息照樣存檔", () => {
    const { id, mgr, fake } = wire("agents-orchestrator", "👨‍💼 專案經理");
    mgr.registerHandoffHandler(() => { throw new Error("boom"); });
    expect(() => fake.emit("event", { type: "message", payload: { content: HANDOFF_MSG } })).not.toThrow();
    expect(getSession(id)!.messages.some((m) => m.role === "assistant" && m.content === HANDOFF_MSG)).toBe(true);
  });
});
