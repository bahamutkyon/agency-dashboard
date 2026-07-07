/**
 * AgentManager.reclaimSubprocess — 派工子 session 拿到結果後立即回收 claude 子程序
 *
 * 驗證：
 * 1. idle claude session → stop() 被呼叫、sessionClosedAt 設定、_distillHook 觸發、回 true
 * 2. busy session → 不殺、_distillHook 不呼叫、回 false（保守：使用者可能已接手深聊）
 * 3. 不存在的 session → 回 false
 * 4. provider !== "claude" → 不殺、回 false（無常駐子程序可回收）
 * 5. _distillHook 拋錯 → reclaimSubprocess 不拋、stop 已呼叫、回 true（fail-safe）
 * 6. 與 TTL 路徑共用回收語意：closedAt 記錄、session 留在 Map（可 resume）
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";

function makeFakeSession(opts: {
  status: "idle" | "busy" | "closed" | "error";
  provider?: "claude" | "codex" | "gemini";
  workspaceId?: string;
  agentId?: string;
}) {
  const stopFn = vi.fn(() => { fake.status = "closed"; });
  const fake: any = {
    status: opts.status,
    provider: opts.provider ?? "claude",
    lastActivityAt: Date.now(),
    stop: stopFn,
    removeAllListeners: vi.fn(),
  };
  if (opts.workspaceId !== undefined) fake.workspaceId = opts.workspaceId;
  if (opts.agentId !== undefined) fake.agentId = opts.agentId;
  return fake;
}

describe("AgentManager.reclaimSubprocess", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("idle claude session → stop 被呼叫、closedAt 設定、_distillHook 觸發、回 true", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const sess = makeFakeSession({ status: "idle", provider: "claude", workspaceId: "ws-1", agentId: "agent-1" });
    const sessId = "reclaim-idle-sess";
    m.sessions.set(sessId, sess);

    const ret = mgr.reclaimSubprocess(sessId);

    expect(ret).toBe(true);
    expect(sess.stop).toHaveBeenCalledOnce();
    expect(m.sessionClosedAt.has(sessId)).toBe(true);
    // session 留在 Map（可 resume）
    expect(m.sessions.has(sessId)).toBe(true);
    expect(hookSpy).toHaveBeenCalledOnce();
    expect(hookSpy).toHaveBeenCalledWith(sessId, "ws-1", "agent-1");
  });

  it("busy session → 不殺、_distillHook 不呼叫、回 false", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const sess = makeFakeSession({ status: "busy", provider: "claude", workspaceId: "ws-1", agentId: "agent-1" });
    m.sessions.set("busy-sess", sess);

    const ret = mgr.reclaimSubprocess("busy-sess");

    expect(ret).toBe(false);
    expect(sess.stop).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
    expect(m.sessionClosedAt.has("busy-sess")).toBe(false);
  });

  it("closed session（已回收/終態）→ 不重複回收、不重複蒸餾、回 false", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const sess = makeFakeSession({ status: "closed", provider: "claude", workspaceId: "ws-1", agentId: "agent-1" });
    m.sessions.set("closed-sess", sess);

    const ret = mgr.reclaimSubprocess("closed-sess");

    expect(ret).toBe(false);
    expect(sess.stop).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
    expect(m.sessionClosedAt.has("closed-sess")).toBe(false);
  });

  it("不存在的 session → 回 false", () => {
    const mgr = new AgentManager();
    expect(mgr.reclaimSubprocess("no-such-session")).toBe(false);
  });

  it("provider !== claude → 不殺、回 false", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const sess = makeFakeSession({ status: "idle", provider: "codex", workspaceId: "ws-1", agentId: "agent-1" });
    m.sessions.set("codex-sess", sess);

    const ret = mgr.reclaimSubprocess("codex-sess");

    expect(ret).toBe(false);
    expect(sess.stop).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
  });

  it("_distillHook 拋錯 → reclaimSubprocess 不拋、stop 已呼叫、closedAt 已設、回 true（fail-safe）", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    mgr._distillHook = vi.fn(() => { throw new Error("distill boom"); });

    const sess = makeFakeSession({ status: "idle", provider: "claude", workspaceId: "ws-e", agentId: "agent-e" });
    const sessId = "err-hook-reclaim";
    m.sessions.set(sessId, sess);

    let ret: boolean = false;
    expect(() => { ret = mgr.reclaimSubprocess(sessId); }).not.toThrow();
    expect(ret).toBe(true);
    expect(sess.stop).toHaveBeenCalledOnce();
    expect(m.sessionClosedAt.has(sessId)).toBe(true);
  });

  it("idle claude 但無 workspaceId/agentId → 仍回收（stop+closedAt）但不觸發蒸餾", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const sess = makeFakeSession({ status: "idle", provider: "claude" }); // 無 ws / agent
    const sessId = "no-ctx-reclaim";
    m.sessions.set(sessId, sess);

    const ret = mgr.reclaimSubprocess(sessId);

    expect(ret).toBe(true);
    expect(sess.stop).toHaveBeenCalledOnce();
    expect(m.sessionClosedAt.has(sessId)).toBe(true);
    expect(hookSpy).not.toHaveBeenCalled();
  });
});
