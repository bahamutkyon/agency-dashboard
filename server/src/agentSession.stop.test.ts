/**
 * AgentSession.stop() — 主動停止不誤報 error
 *
 * 修 #3：idle TTL 回收呼叫 stop() 後，close 事件帶非零碼（SIGTERM）觸發
 * close handler 並 emit status:"error"，覆蓋 stop() 已送出的 "closed"，
 * 使 tab 無故變紅。
 *
 * 修法：stop() 記錄 stoppingChild 引用，close handler 見到同一 child 時
 * 判定為刻意停止並跳過 emit "error"。
 *
 * 本測試使用 kill() → setImmediate close 模擬真實非同步行為。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

let lastChild: any = null;
const writes: string[] = [];
let spawnCount = 0;

vi.mock("./claudeProcess.js", () => ({
  spawnClaude: () => {
    spawnCount++;
    const child: any = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdin = {
      write: (s: string) => { writes.push(s); },
      end: () => {},
      on: () => {},
    };
    // Simulate realistic kill(): async close with null code (SIGTERM)
    child.kill = () => {
      setImmediate(() => child.emit("close", null));
    };
    lastChild = child;
    return child;
  },
}));

vi.mock("./childEnv.js", () => ({
  sanitizedChildEnv: () => ({ ...process.env }),
}));

import { AgentSession } from "./agentSession.js";

beforeEach(() => {
  writes.length = 0;
  spawnCount = 0;
  lastChild = null;
});

describe("AgentSession.stop() — 主動停止不誤報 error", () => {
  it("stop() 後 close 事件（code=null）不 emit status:error — 只有 closed", async () => {
    const s = new AgentSession("a");
    const statusEvents: string[] = [];
    s.on("event", (e) => {
      if (e.type === "status") statusEvents.push(e.payload as string);
    });

    s.send("m1"); // spawn child → starting → busy
    expect(lastChild).toBeTruthy();

    s.stop(); // stoppingChild 設定 + setStatus("closed")

    // 等待 kill() 觸發的 async close 事件
    await new Promise<void>((r) => setImmediate(r));

    // 不應出現 "error"；應有 "closed"
    expect(statusEvents).not.toContain("error");
    expect(statusEvents).toContain("closed");
  });

  it("子程序自然 crash（非主動 stop）仍 emit status:error", () => {
    const s = new AgentSession("a");
    const statusEvents: string[] = [];
    s.on("event", (e) => {
      if (e.type === "status") statusEvents.push(e.payload as string);
    });

    s.send("m1"); // spawn child
    // Simulate crash without stop() — emit close with non-zero code directly
    lastChild!.emit("close", 1);

    expect(statusEvents).toContain("error");
    expect(statusEvents).not.toContain("closed");
  });

  it("子程序正常結束（code=0）emit status:closed", () => {
    const s = new AgentSession("a");
    const statusEvents: string[] = [];
    s.on("event", (e) => {
      if (e.type === "status") statusEvents.push(e.payload as string);
    });

    s.send("m1");
    lastChild!.emit("close", 0);

    expect(statusEvents).toContain("closed");
    expect(statusEvents).not.toContain("error");
  });

  it("stop() 後再次 send（重生）→ 新 child crash 仍正確 emit error", async () => {
    const s = new AgentSession("a");
    const statusEvents: string[] = [];
    s.on("event", (e) => {
      if (e.type === "status") statusEvents.push(e.payload as string);
    });

    s.send("m1");
    const firstChild = lastChild;
    s.stop();

    // Wait for first child's async close
    await new Promise<void>((r) => setImmediate(r));

    // Now spawn a new child and crash it
    s.send("m2"); // spawns second child (status closed → dispatch)
    const secondChild = lastChild;
    expect(secondChild).not.toBe(firstChild);

    statusEvents.length = 0; // clear to focus on second child events
    secondChild.emit("close", 1); // genuine crash of second child

    expect(statusEvents).toContain("error");
  });
});
