import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock socket.io-client at module level (hoisted by vitest).
 * mockEmit, mockOn, mockIo are declared outside the factory so we can reset
 * them in beforeEach while still having the factory reference the same objects.
 */
const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockIo = vi.fn(() => ({ on: mockOn, emit: mockEmit, off: vi.fn() }));

vi.mock("socket.io-client", () => ({
  io: mockIo,
}));

describe("socket session management", () => {
  beforeEach(() => {
    // Reset module registry so each test gets a fresh socket singleton
    // (socket = null, joined = new Set()) from socket.ts.
    vi.resetModules();
    mockEmit.mockReset();
    mockOn.mockReset();
    mockIo.mockReset();
    mockIo.mockReturnValue({ on: mockOn, emit: mockEmit, off: vi.fn() });
    // Clear any leftover agency_token cookie between tests
    document.cookie = "agency_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  afterEach(() => {
    document.cookie = "agency_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("joinSession emits session:join and rejoins all sessions after reconnect", async () => {
    // Dynamic import after resetModules gives us fresh module-level state.
    const { joinSession, getSocket } = await import("./socket");
    getSocket(); // initialise socket (registers connect handler)

    joinSession("sess-a");
    joinSession("sess-b");

    // Verify the initial join emits happened.
    expect(mockEmit).toHaveBeenCalledWith("session:join", "sess-a");
    expect(mockEmit).toHaveBeenCalledWith("session:join", "sess-b");

    // Find the "connect" handler that getSocket registered via socket.on.
    const connectCall = mockOn.mock.calls.find(([event]) => event === "connect");
    expect(connectCall).toBeDefined();
    const connectHandler = connectCall![1] as () => void;

    // Simulate reconnect (socket.io fires "connect" again).
    mockEmit.mockClear();
    connectHandler();

    // Both sessions must be re-emitted.
    expect(mockEmit).toHaveBeenCalledWith("session:join", "sess-a");
    expect(mockEmit).toHaveBeenCalledWith("session:join", "sess-b");
  });

  it("leaveSession removes session from the rejoin set", async () => {
    const { joinSession, leaveSession, getSocket } = await import("./socket");
    getSocket();

    joinSession("sess-x");
    leaveSession("sess-x");

    const connectCall = mockOn.mock.calls.find(([event]) => event === "connect");
    const connectHandler = connectCall![1] as () => void;

    mockEmit.mockClear();
    connectHandler();

    const sessionJoinCalls = mockEmit.mock.calls.filter(([ev]) => ev === "session:join");
    expect(sessionJoinCalls).toHaveLength(0);
  });

  it("only remaining sessions are rejoined after partial leave", async () => {
    const { joinSession, leaveSession, getSocket } = await import("./socket");
    getSocket();

    joinSession("sess-keep");
    joinSession("sess-drop");
    leaveSession("sess-drop");

    const connectCall = mockOn.mock.calls.find(([event]) => event === "connect");
    const connectHandler = connectCall![1] as () => void;

    mockEmit.mockClear();
    connectHandler();

    const joinCalls = mockEmit.mock.calls.filter(([ev]) => ev === "session:join");
    const joinedIds = joinCalls.map(([, id]) => id);
    expect(joinedIds).toContain("sess-keep");
    expect(joinedIds).not.toContain("sess-drop");
  });

  // ===== Fix #1：遠端模式 WS token =====

  it("有 agency_token cookie 時，io() 帶 auth.token（遠端有 token 能連）", async () => {
    document.cookie = "agency_token=my-remote-token; path=/";

    const { getSocket } = await import("./socket");
    getSocket();

    expect(mockIo).toHaveBeenCalledOnce();
    const opts = (mockIo.mock.calls[0] as any[])[0];
    expect(opts?.auth?.token).toBe("my-remote-token");
  });

  it("無 agency_token cookie 時，io() 不帶 auth（本機 / Tailscale 無 token 不受影響）", async () => {
    // Cookie already cleared in beforeEach
    const { getSocket } = await import("./socket");
    getSocket();

    expect(mockIo).toHaveBeenCalledOnce();
    const opts = (mockIo.mock.calls[0] as any[])[0];
    // auth 應為 undefined 或不含 token（本機模式不應多帶空欄位）
    expect(opts?.auth).toBeUndefined();
  });

  it("cookie 帶 URL 編碼的 token 時正確 decode", async () => {
    document.cookie = "agency_token=hello%3Aworld; path=/";

    const { getSocket } = await import("./socket");
    getSocket();

    const opts = (mockIo.mock.calls[0] as any[])[0];
    expect(opts?.auth?.token).toBe("hello:world");
  });
});
