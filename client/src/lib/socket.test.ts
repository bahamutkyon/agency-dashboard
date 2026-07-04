import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock socket.io-client at module level (hoisted by vitest).
 * mockEmit and mockOn are declared outside the factory so we can reset them
 * in beforeEach while still having the factory reference the same objects.
 */
const mockEmit = vi.fn();
const mockOn = vi.fn();

vi.mock("socket.io-client", () => ({
  io: () => ({ on: mockOn, emit: mockEmit, off: vi.fn() }),
}));

describe("socket session management", () => {
  beforeEach(() => {
    // Reset module registry so each test gets a fresh socket singleton
    // (socket = null, joined = new Set()) from socket.ts.
    vi.resetModules();
    mockEmit.mockReset();
    mockOn.mockReset();
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
});
