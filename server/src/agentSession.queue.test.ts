/**
 * AgentSession — busy 時送信佇列（修「busy 靜默丟棄訊息」）
 *
 * 舊行為：status==="busy" 時 send() 只 emit 一個 error 事件然後丟棄訊息，
 * 造成「DB 有這句、模型沒收到」的永久分岔（派工回報 EXEC_REPORT 在 PM 忙碌時消失）。
 *
 * 新行為：
 *  - busy 時 send → 進佇列（回 "queued"），不丟棄、不 emit busy error
 *  - 回合結束回到 idle → 自動抽出佇列下一則送出（觸發下一回合）
 *  - busy 期間多則 send → 依序送出
 *  - 佇列上限保護（>50 → "rejected" + emit error）
 *  - 派工回報情境：PM 忙碌時收到回報 → 排隊 → 回 idle 後送達（不再靜默消失）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// 攔截 claude 子程序的 stdin 寫入 & spawn 次數，避免真的 spawn CLI。
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

import { AgentSession } from "./agentSession.js";

/** 模擬 claude 一回合結束（result 事件）→ setStatus("idle") → drainQueue()。 */
function completeTurn(s: AgentSession) {
  (s as any).routeClaudeEvent({ type: "result", payload: { type: "result" } });
}

/** 該則文字是否已寫入子程序 stdin（即已送達模型）。 */
function wasSent(text: string): boolean {
  return writes.some((w) => w.includes(text));
}

beforeEach(() => {
  writes.length = 0;
  spawnCount = 0;
});

describe("AgentSession 送信佇列", () => {
  it("空閒時 send → 立即送出，回 'sent'，status 轉 busy", () => {
    const s = new AgentSession("a"); // 預設 claude
    expect(s.send("m1")).toBe("sent");
    expect(s.status).toBe("busy");
    expect(wasSent("m1")).toBe(true);
  });

  it("busy 時 send → 進佇列（回 'queued'），不丟棄、不 emit busy error，尚未送達", () => {
    const s = new AgentSession("a");
    const errs: any[] = [];
    s.on("event", (e) => { if (e.type === "error") errs.push(e); });

    expect(s.send("m1")).toBe("sent");
    expect(s.status).toBe("busy");

    expect(s.send("m2")).toBe("queued");     // 不再回 error / 丟棄
    expect(errs.length).toBe(0);              // 舊的 "Session is busy" error 不再出現
    expect(wasSent("m2")).toBe(false);        // 還沒送達模型（在佇列裡）
  });

  it("回到 idle → 自動抽出佇列下一則送出（同一持久子程序，不重 spawn）", () => {
    const s = new AgentSession("a");
    s.send("m1");                 // sent, busy
    s.send("m2");                 // queued
    expect(wasSent("m2")).toBe(false);

    completeTurn(s);              // result → idle → drain m2

    expect(wasSent("m2")).toBe(true);
    expect(s.status).toBe("busy"); // m2 送出後又進行中
    expect(spawnCount).toBe(1);    // claude 子程序持久重用，未重 spawn
  });

  it("busy 期間多則 send → 依序送出（FIFO）", () => {
    const s = new AgentSession("a");
    s.send("m1");   // sent
    s.send("m2");   // queued
    s.send("m3");   // queued

    completeTurn(s); // → 送 m2
    completeTurn(s); // → 送 m3
    completeTurn(s); // → 佇列空，回 idle 留著

    const order = writes.map((w, i) => (w.includes("m1") ? "m1" : w.includes("m2") ? "m2" : w.includes("m3") ? "m3" : `?${i}`));
    expect(order).toEqual(["m1", "m2", "m3"]);
    expect(s.status).toBe("idle"); // 抽乾後停在 idle
  });

  it("佇列抽乾後停在 idle（無死佇列、無殘留）", () => {
    const s = new AgentSession("a");
    s.send("m1");
    s.send("m2");
    completeTurn(s); // drain m2 → busy
    completeTurn(s); // 佇列空 → idle
    expect(s.status).toBe("idle");
    expect((s as any).queue.length).toBe(0);
  });

  it("佇列上限保護：超過 MAX_QUEUE → 回 'rejected' 並 emit error，不無限堆積", () => {
    const s = new AgentSession("a");
    const errs: any[] = [];
    s.on("event", (e) => { if (e.type === "error") errs.push(e); });

    expect(s.send("start")).toBe("sent"); // 進入 busy
    // 灌滿 50 則（MAX_QUEUE）
    for (let i = 0; i < 50; i++) {
      expect(s.send(`q${i}`)).toBe("queued");
    }
    // 第 51 則被拒
    expect(s.send("overflow")).toBe("rejected");
    expect(errs.length).toBe(1);
    expect((s as any).queue.length).toBe(50); // 未超過上限
  });

  it("派工回報情境：PM 忙碌時收到 EXEC_REPORT → 排隊、不消失 → 回 idle 後送達模型", () => {
    // 模擬 PM session 正在忙（回應使用者）
    const pm = new AgentSession("agents-orchestrator");
    pm.send("使用者的問題");            // sent, busy
    expect(pm.status).toBe("busy");

    // 此刻外包完成 callback 透過 agentManager.send → pm.send 回報
    const report = "[[EXEC_REPORT]] 同事回報外包完成…";
    expect(pm.send(report)).toBe("queued");  // 舊行為會在此丟棄 → EXEC_REPORT 永久消失
    expect(wasSent(report)).toBe(false);

    // PM 本回合結束
    completeTurn(pm);

    // 回報被抽出送達模型 → PM 才可能轉達給使用者
    expect(wasSent(report)).toBe(true);
    expect(pm.status).toBe("busy"); // 正在處理回報
  });

  it("stop() 清空未送佇列（不留死佇列在記憶體）", () => {
    const s = new AgentSession("a");
    s.send("m1");
    s.send("m2"); // queued
    expect((s as any).queue.length).toBe(1);
    s.stop();
    expect((s as any).queue.length).toBe(0);
    expect(s.status).toBe("closed");
  });

  // ===== Fix #2：MCP 重生前搶救佇列 =====

  it("queuedMessages getter 回傳未送訊息（不含已 dispatch 的第一則）", () => {
    const s = new AgentSession("a");
    s.send("m1"); // sent → busy
    s.send("m2"); // queued
    s.send("m3"); // queued
    expect([...s.queuedMessages]).toEqual(["m2", "m3"]);
  });

  it("queuedMessages 在 idle 時為空", () => {
    const s = new AgentSession("a");
    expect([...s.queuedMessages]).toEqual([]);
  });

  it("stop() 前取 queuedMessages 快照 + 重新 send 可恢復佇列（MCP 重生不丟訊息）", () => {
    const s = new AgentSession("a");
    s.send("m1"); // sent → busy
    s.send("m2"); // queued
    s.send("m3"); // queued

    // MCP 重生流程：先救出佇列，再 stop，再重新注入
    const saved = [...s.queuedMessages];
    expect(saved).toEqual(["m2", "m3"]);

    s.stop(); // 清空佇列，status = "closed"
    expect((s as any).queue.length).toBe(0);

    // 重新注入（如 agentManager MCP restart 流程）
    for (const msg of saved) s.send(msg);

    // m2 被立即 dispatch（重生 child），m3 進佇列
    expect(wasSent("m2")).toBe(true);
    expect([...s.queuedMessages]).toEqual(["m3"]);

    // 完成 m2 回合 → 送 m3
    completeTurn(s);
    expect(wasSent("m3")).toBe(true);
  });

  it("stop() 後重新 send 接著排入當前訊息 → 順序 m2, m3, current", () => {
    const s = new AgentSession("a");
    s.send("m1");  // sent
    s.send("m2");  // queued
    s.send("m3");  // queued

    const saved = [...s.queuedMessages];
    s.stop();
    for (const msg of saved) s.send(msg); // re-inject: m2 dispatched, m3 queued
    s.send("current"); // queued after m3

    expect([...s.queuedMessages]).toEqual(["m3", "current"]);

    completeTurn(s); // drain m3
    completeTurn(s); // drain current

    const order = writes.map((w) =>
      w.includes("m1") ? "m1" : w.includes("m2") ? "m2" : w.includes("m3") ? "m3" : w.includes("current") ? "current" : "?"
    );
    expect(order).toEqual(["m1", "m2", "m3", "current"]);
  });
});
