/**
 * AgentManager — idle TTL 回收時自動觸發同事記憶蒸餾
 *
 * 驗證（以 agentManager.idleTTL.test.ts 風格，注入 fake _distillHook）：
 * 1. idle + TTL 逾時 + 有 workspaceId/agentId → _distillHook 被呼叫（觸發蒸餾）
 * 2. idle + TTL 逾時 + 無 workspaceId → _distillHook 不呼叫（無 context 可蒸餾）
 * 3. idle + TTL 逾時 + 無 agentId → _distillHook 不呼叫
 * 4. busy 狀態 → _distillHook 不呼叫（busy 不回收）
 * 5. _distillHook 同步拋錯 → cleanupIdleSessions 不拋、stop() 已呼叫、sessionClosedAt 已設（fail-safe）
 * 6. 多 session 混合：只有 idle+逾時+有 context 的觸發 hook
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分鐘

/**
 * 建立假 session，支援設定 workspaceId / agentId（控制蒸餾鉤子是否觸發）。
 * stop() 呼叫時自動把 status 改為 "closed"，模擬真實 AgentSession 行為。
 */
function makeFakeSession(opts: {
  status: "idle" | "busy" | "closed" | "error";
  provider?: "claude" | "codex" | "gemini";
  lastActivityAt?: number;
  workspaceId?: string;
  agentId?: string;
}) {
  const stopFn = vi.fn(() => { fake.status = "closed"; });
  const fake: any = {
    status: opts.status,
    provider: opts.provider ?? "claude",
    lastActivityAt: opts.lastActivityAt ?? Date.now(),
    stop: stopFn,
    removeAllListeners: vi.fn(),
  };
  if (opts.workspaceId !== undefined) fake.workspaceId = opts.workspaceId;
  if (opts.agentId !== undefined) fake.agentId = opts.agentId;
  return fake;
}

describe("AgentManager.cleanupIdleSessions — 自動蒸餾觸發", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("idle + 逾時 + 有 workspaceId + agentId → _distillHook 被呼叫一次，傳入正確參數", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({
      status: "idle",
      provider: "claude",
      lastActivityAt: staleAt,
      workspaceId: "ws-auto",
      agentId: "engineering-coder",
    });
    const sessId = "auto-distill-trigger-sess";
    m.sessions.set(sessId, sess);

    m.cleanupIdleSessions();

    expect(sess.stop).toHaveBeenCalledOnce();  // 回收正常完成
    expect(hookSpy).toHaveBeenCalledOnce();
    expect(hookSpy).toHaveBeenCalledWith(sessId, "ws-auto", "engineering-coder");
  });

  it("idle + 逾時 + 無 workspaceId → _distillHook 不呼叫（無 context，回收仍完成）", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    // 無 workspaceId，也無 agentId
    const sess = makeFakeSession({ status: "idle", provider: "claude", lastActivityAt: staleAt });
    m.sessions.set("no-ws-sess", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).toHaveBeenCalledOnce();   // 回收仍完成
    expect(hookSpy).not.toHaveBeenCalled();
  });

  it("idle + 逾時 + 有 workspaceId 但無 agentId → _distillHook 不呼叫", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({
      status: "idle", provider: "claude", lastActivityAt: staleAt,
      workspaceId: "ws-only",
      // agentId 未設
    });
    m.sessions.set("no-agent-sess", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).toHaveBeenCalledOnce();
    expect(hookSpy).not.toHaveBeenCalled();
  });

  it("busy 狀態 → stop() 不呼叫、_distillHook 不呼叫", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({
      status: "busy", provider: "claude", lastActivityAt: staleAt,
      workspaceId: "ws-busy", agentId: "agent-busy",
    });
    m.sessions.set("busy-sess", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
  });

  it("_distillHook 同步拋錯 → cleanupIdleSessions 不拋、stop() 已完成、sessionClosedAt 已設（fail-safe）", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    mgr._distillHook = vi.fn(() => { throw new Error("hook exploded"); });

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({
      status: "idle", provider: "claude", lastActivityAt: staleAt,
      workspaceId: "ws-err", agentId: "agent-err",
    });
    const sessId = "err-hook-sess";
    m.sessions.set(sessId, sess);

    // 即使 hook 拋錯，cleanupIdleSessions 本身不應拋
    expect(() => m.cleanupIdleSessions()).not.toThrow();
    // 回收在 hook 呼叫前已完成
    expect(sess.stop).toHaveBeenCalledOnce();
    expect(m.sessionClosedAt.has(sessId)).toBe(true);
  });

  it("多 session 混合：只有 idle+逾時+有 context 的觸發 hook，其他不影響", () => {
    const mgr = new AgentManager();
    const m = mgr as any;
    const hookSpy = vi.fn();
    mgr._distillHook = hookSpy;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const freshAt = Date.now() - 60_000; // 只閒置 1 分鐘

    const shouldDistill = makeFakeSession({
      status: "idle", provider: "claude", lastActivityAt: staleAt,
      workspaceId: "ws-ok", agentId: "agent-ok",
    });
    const noContext = makeFakeSession({
      status: "idle", provider: "claude", lastActivityAt: staleAt,
      // 無 workspaceId / agentId
    });
    const fresh = makeFakeSession({
      status: "idle", provider: "claude", lastActivityAt: freshAt,
      workspaceId: "ws-fresh", agentId: "agent-fresh",
    });
    const busy = makeFakeSession({
      status: "busy", provider: "claude", lastActivityAt: staleAt,
      workspaceId: "ws-busy", agentId: "agent-busy",
    });

    m.sessions.set("s-distill", shouldDistill);
    m.sessions.set("s-no-ctx", noContext);
    m.sessions.set("s-fresh", fresh);
    m.sessions.set("s-busy", busy);

    m.cleanupIdleSessions();

    expect(hookSpy).toHaveBeenCalledOnce();
    expect(hookSpy).toHaveBeenCalledWith("s-distill", "ws-ok", "agent-ok");
    // stop() 只被 shouldDistill 和 noContext 呼叫（idle+逾時）
    expect(shouldDistill.stop).toHaveBeenCalledOnce();
    expect(noContext.stop).toHaveBeenCalledOnce();
    expect(fresh.stop).not.toHaveBeenCalled();
    expect(busy.stop).not.toHaveBeenCalled();
  });
});
