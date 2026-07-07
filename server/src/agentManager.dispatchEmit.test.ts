/**
 * A2 — detectAndEnqueueDispatch 建立 pending 後 emit autonomy:event
 *
 * 現況：建 pending 後只 notify()，前端 useAutonomy 要切走切回才看得到卡片。
 * 修正：拿到 io 後於建立成功時 emit("autonomy:event", { sessionId, kind:"pending:new" })，
 * 讓 useAutonomy 現成的 handler 立即 refresh 彈出批准卡。
 */
import { describe, it, expect, vi } from "vitest";
import { detectAndEnqueueDispatch } from "./agentManager.js";
import { listPending } from "./store/autonomy.js";

const DISPATCH = `這是 PM 的計畫：
=== DISPATCH ===
- agentId: designer
  mode: consult
  task: 設計首頁
- agentId: developer
  mode: execute
  task: 實作登入
=== END DISPATCH ===`;

describe("detectAndEnqueueDispatch A2 emit", () => {
  it("建立 pending 成功後 emit autonomy:event(kind=pending:new)", () => {
    const io = { emit: vi.fn() };
    const sid = `emit_a2_${Date.now().toString(36)}`;
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w" }, DISPATCH, io);
    expect(listPending(sid)).toHaveLength(1);
    expect(io.emit).toHaveBeenCalledWith("autonomy:event", { sessionId: sid, kind: "pending:new" });
  });

  it("去重命中（相同 detail）不重複建立、不再 emit", () => {
    const io = { emit: vi.fn() };
    const sid = `emit_a2_dedup_${Date.now().toString(36)}`;
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w" }, DISPATCH, io);
    detectAndEnqueueDispatch({ id: sid, agentId: "agents-orchestrator", workspaceId: "w" }, DISPATCH, io);
    expect(listPending(sid)).toHaveLength(1);
    expect(io.emit).toHaveBeenCalledTimes(1);
  });

  it("非 orchestrator session 不建立也不 emit", () => {
    const io = { emit: vi.fn() };
    const sid = `emit_a2_nonpm_${Date.now().toString(36)}`;
    detectAndEnqueueDispatch({ id: sid, agentId: "marketing-content-creator", workspaceId: "w" }, DISPATCH, io);
    expect(listPending(sid)).toHaveLength(0);
    expect(io.emit).not.toHaveBeenCalled();
  });
});
