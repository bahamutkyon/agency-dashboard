/**
 * AgentSession — turnId 關聯（修「同一 session 多寫入者回覆張冠李戴」）
 *
 * 問題：所有等待端都用「session.on(event) + 收到時間上下一個 result 就 settle」的模式，
 * 沒有 correlation id。同一 session 若有第二個寫入者（例：自走迴圈進行中，外包
 * EXEC_REPORT 經 busy 佇列排入），listener 收到的下一個 result 未必是自己那一回合的
 * → 回覆張冠李戴。
 *
 * 核心不變量：每個 send 對應一個唯一 turnId；該回合結束 emit 的 result 帶這個 turnId；
 * 等待端只在 evt.turnId === 我的 turnId 時才 settle。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// 攔截 claude 子程序，避免真的 spawn CLI（同 queue 測試手法）。
const writes: string[] = [];
let spawnCount = 0;

vi.mock("./claudeProcess.js", () => ({
  spawnClaude: () => {
    spawnCount++;
    const child: any = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdin = { write: (s: string) => { writes.push(s); } };
    child.kill = () => {};
    return child;
  },
}));

import { AgentSession, turnMatches } from "./agentSession.js";

/** 模擬 claude 一回合結束（result 事件）→ 帶 currentTurnId → setStatus("idle") → drainQueue()。 */
function completeTurn(s: AgentSession) {
  (s as any).routeClaudeEvent({ type: "result", payload: { type: "result" } });
}

beforeEach(() => {
  writes.length = 0;
  spawnCount = 0;
});

describe("turnMatches — 等待端 turn 比對", () => {
  it("雙方 turnId 相同 → 收（true）", () => {
    expect(turnMatches(1, 1)).toBe(true);
  });
  it("雙方 turnId 都有但不同 → 不收（false）＝修 bug 的核心閘門", () => {
    expect(turnMatches(1, 2)).toBe(false);
  });
  it("我方無 turnId（相容舊呼叫）→ 全收", () => {
    expect(turnMatches(undefined, 2)).toBe(true);
  });
  it("事件無 turnId（相容舊事件）→ 全收", () => {
    expect(turnMatches(1, undefined)).toBe(true);
  });
  it("雙方都無 turnId → 全收（完全舊行為）", () => {
    expect(turnMatches(undefined, undefined)).toBe(true);
  });
});

describe("AgentSession turnId 貫穿 send→result", () => {
  it("send 立即送 → 配一個 turnId（lastTurnId）；result 帶同一 turnId", () => {
    const s = new AgentSession("a");
    const events: any[] = [];
    s.on("event", (e) => events.push(e));

    expect(s.send("m1")).toBe("sent");
    const t1 = s.lastTurnId;
    expect(typeof t1).toBe("number");

    completeTurn(s);
    const result = events.find((e) => e.type === "result");
    expect(result).toBeTruthy();
    expect(result.turnId).toBe(t1);
  });

  it("兩則連續 send（第二則進 queue）→ 各自不同 turnId；drain 後各自 result 帶各自 turnId、順序正確", () => {
    const s = new AgentSession("a");
    const resultTurns: number[] = [];
    s.on("event", (e) => { if (e.type === "result") resultTurns.push(e.turnId); });

    s.send("m1"); const t1 = s.lastTurnId!;
    s.send("m2"); const t2 = s.lastTurnId!;   // queued
    expect(t2).not.toBe(t1);
    expect(t2).toBeGreaterThan(t1);

    completeTurn(s); // result(t1) → idle → drain m2 (currentTurnId=t2) → busy
    completeTurn(s); // result(t2)

    expect(resultTurns).toEqual([t1, t2]);
  });

  it("rejected（佇列爆滿）→ lastTurnId 為 undefined（無對應回合）", () => {
    const s = new AgentSession("a");
    s.send("start"); // busy
    for (let i = 0; i < 50; i++) s.send(`q${i}`);
    expect(s.send("overflow")).toBe("rejected");
    expect(s.lastTurnId).toBeUndefined();
  });

  it("delta / message 事件也帶當前回合 turnId", () => {
    const s = new AgentSession("a");
    const events: any[] = [];
    s.on("event", (e) => events.push(e));
    s.send("m1"); const t1 = s.lastTurnId;

    // 模擬串流 delta + 完整 message
    (s as any).routeClaudeEvent({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } });
    (s as any).routeClaudeEvent({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });

    const delta = events.find((e) => e.type === "delta");
    const msg = events.find((e) => e.type === "message");
    expect(delta.turnId).toBe(t1);
    expect(msg.turnId).toBe(t1);
  });
});

describe("等待端只認自己 turnId（核心：別的 result 先到不會誤觸發）", () => {
  it("兩個 waiter 掛同一 session：turn1 的 result 到來時，等 turn2 的 waiter 不被誤觸發", () => {
    const s = new AgentSession("a");

    // waiter A 送 turn1（立即送出）
    s.send("A"); const tA = s.lastTurnId!;
    // waiter B 送 turn2（session busy → 進佇列）
    s.send("B"); const tB = s.lastTurnId!;
    expect(tA).not.toBe(tB);

    let aSettled: number | undefined;
    let bSettled: number | undefined;
    // 生產等待端的過濾邏輯：只在 turnMatches(我的, evt.turnId) 時 settle
    const mkWaiter = (myTurnId: number, sink: (id: number) => void) => (evt: any) => {
      if (evt.type === "result" && turnMatches(myTurnId, evt.turnId)) sink(evt.turnId);
    };
    s.on("event", mkWaiter(tA, (id) => { aSettled = id; }));
    s.on("event", mkWaiter(tB, (id) => { bSettled = id; }));

    completeTurn(s); // emit result(tA) → A settle；B 看到 tA≠tB 忽略；drain B(currentTurnId=tB)
    expect(aSettled).toBe(tA);
    expect(bSettled).toBeUndefined(); // ← 核心：B 沒被 turn A 的 result 誤觸發

    completeTurn(s); // emit result(tB) → B settle
    expect(bSettled).toBe(tB);
  });

  it("向後相容：result 若不帶 turnId（舊事件），帶 turnId 的 waiter 仍會 settle", () => {
    const s = new AgentSession("a");
    s.send("m1");
    const myTurnId = s.lastTurnId!;
    let settled = false;
    s.on("event", (evt: any) => {
      if (evt.type === "result" && turnMatches(myTurnId, evt.turnId)) settled = true;
    });
    // 手動 emit 一個「沒有 turnId」的 result（模擬舊路徑/未接 turnId 的事件）
    s.emit("event", { type: "result", payload: {} });
    expect(settled).toBe(true);
  });
});
