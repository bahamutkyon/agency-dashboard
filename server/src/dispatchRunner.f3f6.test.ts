import { describe, it, expect, vi } from "vitest";
import { runOneExecuteAsConsult, runOneConsult } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";
import { EventEmitter } from "node:events";
import { __resetBackgroundLimiterForTest } from "./backgroundLimiter.js";

const item: DispatchItem = { agentId: "a1", mode: "execute", task: "任務" };

function makeSession(id = "sess-1") {
  const emitter = new EventEmitter();
  return {
    id,
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    stop: vi.fn(),
  };
}

describe("F3: runOneExecuteAsConsult timeout → kill() called", () => {
  it("timeout calls deps.kill with session id", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("kill-sess");
    const killed: string[] = [];
    const deps = {
      start: () => session,
      send: () => ({ turnId: 1 }),
      reclaim: vi.fn(),
      kill: (sid: string) => { killed.push(sid); },
    };
    // Very short timeout
    const promise = runOneExecuteAsConsult(item, "ws1", 50, deps);
    const result = await promise;
    expect(result.status).toBe("timeout");
    expect(killed).toContain("kill-sess");
  });

  it("runOneConsult timeout does NOT call kill (only execute does)", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("consult-sess");
    const killed: string[] = [];
    const consultItem: DispatchItem = { agentId: "a1", mode: "consult", task: "諮詢" };
    const deps = {
      start: () => session,
      send: () => ({ turnId: 1 }),
      reclaim: vi.fn(),
      kill: (sid: string) => { killed.push(sid); },
    };
    const result = await runOneConsult(consultItem, "ws1", 50, deps);
    expect(result.status).toBe("timeout");
    expect(killed).toHaveLength(0);
  });
});

describe("F6: status:error/closed event → finish('error') immediately", () => {
  it("status:error event → result is error", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("f6-err");
    const deps = {
      start: () => session,
      send: () => {
        // emit status:error after send
        setTimeout(() => session.emit("event", { type: "status", payload: "error" }), 10);
        return { turnId: 1 };
      },
      reclaim: vi.fn(),
      kill: vi.fn(),
    };
    const result = await runOneExecuteAsConsult(item, "ws1", 5000, deps);
    expect(result.status).toBe("error");
  });

  it("status:closed event → result is error", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("f6-closed");
    const deps = {
      start: () => session,
      send: () => {
        setTimeout(() => session.emit("event", { type: "status", payload: "closed" }), 10);
        return { turnId: 1 };
      },
      reclaim: vi.fn(),
      kill: vi.fn(),
    };
    const result = await runOneConsult({ agentId: "a1", mode: "consult", task: "t" }, "ws1", 5000, deps);
    expect(result.status).toBe("error");
  });
});
