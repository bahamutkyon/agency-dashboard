/**
 * agentManager — idle Claude 子程序 TTL 回收
 *
 * 驗證：
 * 1. idle 且逾時 → stop() 被呼叫、sessionClosedAt 被記錄、session 留在 Map 中（可 resume）
 * 2. busy 狀態（執行中）→ 絕不被回收
 * 3. idle 但未逾時 → 不回收
 * 4. idle 且 provider !== 'claude' → 不回收（無常駐子程序）
 * 5. closed/error 狀態的舊行為不受影響
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分鐘

/** 建立可注入 sessions Map 的假 session，追蹤 stop() 呼叫次數。 */
function makeFakeSession(opts: {
  status: "idle" | "busy" | "closed" | "error" | "starting";
  provider?: "claude" | "codex" | "gemini";
  lastActivityAt?: number;
}) {
  const stopFn = vi.fn(() => {
    // 模擬 AgentSession.stop()：殺子程序 + 設 status 為 "closed"
    fake.status = "closed";
  });
  const fake = {
    status: opts.status as string,
    provider: opts.provider ?? "claude",
    lastActivityAt: opts.lastActivityAt ?? Date.now(),
    stop: stopFn,
    removeAllListeners: vi.fn(),
  };
  return fake;
}

describe("AgentManager.cleanupIdleSessions — idle TTL 回收", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("idle + 逾時 → stop() 被呼叫，session 留在 Map（可 resume），sessionClosedAt 已設", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({ status: "idle", provider: "claude", lastActivityAt: staleAt });
    const sessId = "idle-stale-session";
    m.sessions.set(sessId, sess);

    m.cleanupIdleSessions();

    // stop() 應被呼叫一次（殺子程序）
    expect(sess.stop).toHaveBeenCalledOnce();
    // session 必須留在 Map 中，讓 reattach / send 走 --resume 路徑
    expect(m.sessions.has(sessId)).toBe(true);
    // sessionClosedAt 設定後，既有的記憶體清除路徑可接手
    expect(m.sessionClosedAt.has(sessId)).toBe(true);
  });

  it("busy 狀態不論多久 → 絕不回收", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({ status: "busy", provider: "claude", lastActivityAt: staleAt });
    m.sessions.set("busy-session", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).not.toHaveBeenCalled();
    expect(m.sessions.has("busy-session")).toBe(true);
  });

  it("idle 但未逾時 → 不回收", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const freshAt = Date.now() - 60_000; // 只閒置 1 分鐘
    const sess = makeFakeSession({ status: "idle", provider: "claude", lastActivityAt: freshAt });
    m.sessions.set("idle-fresh-session", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).not.toHaveBeenCalled();
  });

  it("idle + codex provider → 不回收（無常駐子程序）", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({ status: "idle", provider: "codex", lastActivityAt: staleAt });
    m.sessions.set("idle-codex-session", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).not.toHaveBeenCalled();
  });

  it("idle + gemini provider → 不回收", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;
    const sess = makeFakeSession({ status: "idle", provider: "gemini", lastActivityAt: staleAt });
    m.sessions.set("idle-gemini-session", sess);

    m.cleanupIdleSessions();

    expect(sess.stop).not.toHaveBeenCalled();
  });

  it("closed 狀態 + sessionClosedAt 超過 SESSION_TTL → 從 Map 移除（既有行為不受影響）", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const closedTtlMs = 30 * 60 * 1000;
    const sess = makeFakeSession({ status: "closed", provider: "claude" });
    const sessId = "old-closed-session";
    m.sessions.set(sessId, sess);
    m.sessionClosedAt.set(sessId, Date.now() - closedTtlMs - 5000);

    m.cleanupIdleSessions();

    // 從 Map 移除（節省記憶體）
    expect(m.sessions.has(sessId)).toBe(false);
    // removeAllListeners 被呼叫
    expect(sess.removeAllListeners).toHaveBeenCalledOnce();
  });

  it("同一次 cleanup 可同時處理多個不同狀態的 session", () => {
    const mgr = new AgentManager();
    const m = mgr as any;

    const staleAt = Date.now() - DEFAULT_TTL_MS - 5000;

    const idleStale = makeFakeSession({ status: "idle", provider: "claude", lastActivityAt: staleAt });
    const idleFresh = makeFakeSession({ status: "idle", provider: "claude", lastActivityAt: Date.now() - 1000 });
    const busyStale = makeFakeSession({ status: "busy", provider: "claude", lastActivityAt: staleAt });

    m.sessions.set("idle-stale", idleStale);
    m.sessions.set("idle-fresh", idleFresh);
    m.sessions.set("busy-stale", busyStale);

    m.cleanupIdleSessions();

    expect(idleStale.stop).toHaveBeenCalledOnce();  // 只有這個被殺
    expect(idleFresh.stop).not.toHaveBeenCalled();
    expect(busyStale.stop).not.toHaveBeenCalled();
  });
});
