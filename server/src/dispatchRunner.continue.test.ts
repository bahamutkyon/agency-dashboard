/**
 * dispatchRunner.continue.test.ts — 外包的自動續跑（2026-10）。
 *
 * Anthropic 對 Opus 5.5 的說明：無人值守時，模型的進度回報可能以文字結束回合；把它當成任務完成
 * 就會停在半途。外包的完成條件明確（回報最後附【完成自驗】），沒有就送續跑訊息，最多 2 次。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  makeExecuteDeps, startExecute, runOneExecuteAsConsult, shouldContinueExecute,
  EXECUTE_CONTINUE_PROMPT, EXECUTE_MAX_CONTINUATIONS, SELF_CHECK_MARKER, type ExecuteDone,
} from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";
import { __resetBackgroundLimiterForTest, backgroundLimiterStats } from "./backgroundLimiter.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const item: DispatchItem = { agentId: "agent-x", mode: "execute", task: "整理報告" };
const DONE = `報告內容\n${SELF_CHECK_MARKER}結論：已驗證完成`;

function makeSession(id: string): any {
  const ee: any = new EventEmitter();
  ee.id = id;
  ee.stop = vi.fn(() => ee.emit("event", { type: "status", payload: "closed" }));
  return ee;
}
function launch(session: any) {
  const am = {
    start: vi.fn(() => session),
    send: vi.fn(),
    get: vi.fn((id: string) => (id === session.id ? session : undefined)),
    reclaimSubprocess: vi.fn(() => true),
  };
  const deps = makeExecuteDeps(am as any, () => ({ idleMs: 10_000, hardMs: 20_000 }));
  const done: ExecuteDone[] = [];
  startExecute([item], "ws1", "pm1", (d) => done.push(d), deps);
  return { am, done };
}
const turn = (s: any, text: string, payload: any = {}) => {
  s.emit("event", { type: "message", payload: { content: text } });
  s.emit("event", { type: "result", payload });
};

beforeEach(() => { __resetBackgroundLimiterForTest(); });

describe("shouldContinueExecute", () => {
  it("沒附自驗、結果正常、次數未滿 → 續跑", () => {
    expect(shouldContinueExecute({}, "資料齊了。開始寫報告。", 0)).toBe(true);
  });
  it("已附自驗 → 不續跑", () => {
    expect(shouldContinueExecute({}, DONE, 0)).toBe(false);
  });
  it("次數用完 → 不續跑", () => {
    expect(shouldContinueExecute({}, "還在做", EXECUTE_MAX_CONTINUATIONS)).toBe(false);
  });
  it("失敗的回合（空內容 / is_error / 額度用盡）→ 不續跑，照實回報", () => {
    expect(shouldContinueExecute({}, "", 0)).toBe(false);
    expect(shouldContinueExecute({ is_error: true }, "做到一半出錯", 0)).toBe(false);
    expect(shouldContinueExecute({}, "You've hit your session limit · resets 9pm", 0)).toBe(false);
  });
});

describe("非同步外包", () => {
  it("回合結束但沒附自驗 → 送續跑訊息、槽與子程序都保留；下一回合附了自驗 → 交付", async () => {
    const s = makeSession("cont-1");
    const { am, done } = launch(s);
    await tick();
    expect(backgroundLimiterStats().running).toBe(1);

    turn(s, "資料齊了。開始寫報告。");
    await tick();
    expect(done).toHaveLength(0);
    expect(am.send).toHaveBeenLastCalledWith("cont-1", EXECUTE_CONTINUE_PROMPT);
    expect(am.reclaimSubprocess).not.toHaveBeenCalled();
    expect(backgroundLimiterStats().running).toBe(1); // 槽仍持有

    turn(s, DONE);
    await tick();
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "ok", output: DONE });
    expect(am.reclaimSubprocess).toHaveBeenCalledWith("cont-1");
    expect(backgroundLimiterStats().running).toBe(0);
  });

  it("續跑 2 次仍沒附自驗 → 交付但附系統備註（請視為未驗證）", async () => {
    const s = makeSession("cont-2");
    const { am, done } = launch(s);
    await tick();
    for (let i = 0; i < EXECUTE_MAX_CONTINUATIONS + 1; i++) {
      turn(s, `第 ${i + 1} 次回報：還在整理`);
      await tick();
    }
    expect(am.send).toHaveBeenCalledTimes(1 + EXECUTE_MAX_CONTINUATIONS); // 1 次初始派送 + 2 次續跑
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe("ok");
    expect(done[0].output).toContain(`第 ${EXECUTE_MAX_CONTINUATIONS + 1} 次回報`);
    expect(done[0].output).toContain(`自動續跑 ${EXECUTE_MAX_CONTINUATIONS} 次後仍未附【完成自驗】`);
  });

  it("is_error 的回合 → 不續跑，直接回報失敗", async () => {
    const s = makeSession("cont-3");
    const { am, done } = launch(s);
    await tick();
    turn(s, "做到一半出錯", { is_error: true });
    await tick();
    expect(am.send).toHaveBeenCalledTimes(1); // 只有初始派送
    expect(done[0].status).toBe("error");
  });
});

describe("同步外包（自主迴圈）", () => {
  it("沒附自驗 → 在同一個子 session 送續跑；附了自驗 → ok", async () => {
    const s = makeSession("sync-cont");
    let nextTurn = 1;
    const sent: string[] = [];
    const deps = {
      start: () => s,
      send: (_id: string, text: string) => { sent.push(text); return { turnId: nextTurn++ }; },
      reclaim: vi.fn(),
      kill: vi.fn(),
    };
    const p = runOneExecuteAsConsult(item, "ws1", 10_000, deps);
    await tick();
    s.emit("event", { type: "message", turnId: 1, payload: { content: "第一階段做完，接下來寫報告" } });
    s.emit("event", { type: "result", turnId: 1, payload: {} });
    await tick();
    expect(sent[sent.length - 1]).toBe(EXECUTE_CONTINUE_PROMPT);
    // 舊回合的 result 不該再被當成本回合
    s.emit("event", { type: "message", turnId: 2, payload: { content: DONE } });
    s.emit("event", { type: "result", turnId: 2, payload: {} });
    const res = await p;
    expect(res.status).toBe("ok");
    expect(res.output).toBe(DONE);
    expect(sent).toHaveLength(2);
  });
});
