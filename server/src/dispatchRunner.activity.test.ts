/**
 * dispatchRunner.activity.test.ts — 外包執行「看活動」的逾時（2026-10）。
 *
 * 真實事故（2026-08-11）：8 筆外包有 3 筆在固定 30 分鐘被判失敗，最後一則訊息都是
 * 「資料齊了。開始寫報告。」這類收尾中的旁白——不是卡住，是被固定牆鐘砍掉。另有兩筆的
 * 「結果」其實是「You've hit your session limit」，卻被記成完成。
 *
 * 這裡鎖住：
 *  1. 持續有活動 → 超過 idle 很多倍也不逾時，最後正常交付
 *  2. 連續沒活動 → 判定卡住：回報未完成（帶完整過程）＋中止子代理
 *  3. 一直有活動但超過絕對上限 → 中止
 *  4. 子程序在交出結果前就結束 → 立刻回報，不乾等
 *  5. 額度用盡 / is_error 的結果 → 失敗，不是完成
 *  6. 還在排背景槽時就被放棄 → 搶到槽後不再送出
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  makeExecuteDeps, startExecute, runOneExecuteAsConsult, isUsageLimitText, executeResultOk,
  executeLimits, TIMEOUT_OUTPUT_HEADER, type ExecuteDone,
} from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";
import { __resetBackgroundLimiterForTest, withBackgroundSlot } from "./backgroundLimiter.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(0);

/** 假 session：stop() 跟真的一樣會同步發出 status closed。 */
function makeSession(id: string): any {
  const ee: any = new EventEmitter();
  ee.id = id;
  ee.stop = vi.fn(() => ee.emit("event", { type: "status", payload: "closed" }));
  return ee;
}
function makeAm(session: any) {
  return {
    start: vi.fn(() => session),
    send: vi.fn(),
    get: vi.fn((id: string) => (id === session.id ? session : undefined)),
    reclaimSubprocess: vi.fn(() => true),
  };
}
const item: DispatchItem = { agentId: "agent-x", mode: "execute", task: "寫一份報告" };

/** 啟動一個外包並回傳收到的 onDone 結果陣列。 */
function launch(session: any, limits: { idleMs: number; hardMs: number }) {
  const am = makeAm(session);
  const deps = makeExecuteDeps(am as any, () => limits);
  const done: ExecuteDone[] = [];
  startExecute([item], "ws1", "pm1", (d) => done.push(d), deps);
  return { am, done };
}

beforeEach(() => { __resetBackgroundLimiterForTest(); });

describe("非同步外包（makeExecuteDeps）", () => {
  it("持續有活動 → 超過 idle 多倍仍不逾時，最後正常交付", async () => {
    const s = makeSession("act-1");
    const { done } = launch(s, { idleMs: 60, hardMs: 5_000 });
    await tick(); // 進槽、送出
    for (let i = 0; i < 8; i++) { // 8 × 30ms = 240ms ≈ 4 倍 idle
      await sleep(30);
      s.emit("event", { type: "tool_call", payload: { name: "WebSearch" } });
    }
    expect(done).toHaveLength(0);
    s.emit("event", { type: "message", payload: { content: "## 報告完成\n【完成自驗】結論：已驗證完成" } });
    s.emit("event", { type: "result", payload: { is_error: false } });
    await tick();
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ status: "ok", output: "## 報告完成\n【完成自驗】結論：已驗證完成" });
  });

  it("連續沒有活動 → 判定卡住：回報未完成（帶完整過程）並中止子代理", async () => {
    const s = makeSession("idle-1");
    const { done } = launch(s, { idleMs: 50, hardMs: 5_000 });
    await tick();
    s.emit("event", { type: "message", payload: { content: "資料齊了。開始寫報告。" } });
    await sleep(120);
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe("error");
    expect(done[0].output).toContain(TIMEOUT_OUTPUT_HEADER);
    expect(done[0].output).toContain("資料齊了。開始寫報告。");
    expect(done[0].output).toContain("【已中止，未完成】");
    expect(done[0].output).toContain("沒有任何活動");
    // stop 同步發出的 status closed 不可蓋掉逾時說明
    expect(done[0].output).not.toContain("交出結果前就");
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it("一直有活動但超過絕對上限 → 中止並說明是上限", async () => {
    const s = makeSession("hard-1");
    const { done } = launch(s, { idleMs: 40, hardMs: 120 });
    await tick();
    const iv = setInterval(() => s.emit("event", { type: "delta", payload: "…" }), 15);
    try {
      await sleep(200);
    } finally {
      clearInterval(iv);
    }
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe("error");
    expect(done[0].output).toContain("絕對上限");
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it("子程序在交出結果前就結束 → 立刻回報失敗，不乾等逾時", async () => {
    const s = makeSession("crash-1");
    const { done } = launch(s, { idleMs: 10_000, hardMs: 20_000 });
    await tick();
    s.emit("event", { type: "message", payload: { content: "做到一半" } });
    s.emit("event", { type: "status", payload: "error" });
    await tick();
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe("error");
    expect(done[0].output).toContain("異常結束");
    expect(done[0].output).toContain("做到一半");
  });

  it("結果其實是額度用盡通知 → 失敗（舊版記成完成）", async () => {
    const s = makeSession("limit-1");
    const { done } = launch(s, { idleMs: 10_000, hardMs: 20_000 });
    await tick();
    s.emit("event", { type: "message", payload: { content: "You've hit your session limit · resets 9pm (Asia/Taipei)" } });
    s.emit("event", { type: "result", payload: { is_error: false } });
    await tick();
    expect(done[0].status).toBe("error");
  });

  it("CLI 標 is_error 的結果 → 失敗", async () => {
    const s = makeSession("iserr-1");
    const { done } = launch(s, { idleMs: 10_000, hardMs: 20_000 });
    await tick();
    s.emit("event", { type: "message", payload: { content: "做了一部分就出錯" } });
    s.emit("event", { type: "result", payload: { is_error: true, subtype: "error_during_execution" } });
    await tick();
    expect(done[0]).toMatchObject({ status: "error", output: "做了一部分就出錯" });
  });

  it("還在排背景槽時就被放棄 → 搶到槽後不再送出（不會「回報失敗後才開工」）", async () => {
    // 佔滿 3 個背景槽
    const releases: (() => void)[] = [];
    const blockers = Array.from({ length: 3 }, () =>
      withBackgroundSlot(() => new Promise<void>((r) => releases.push(r))));
    await tick();
    const s = makeSession("queued-1");
    const { am, done } = launch(s, { idleMs: 30, hardMs: 60 });
    await sleep(100); // 排隊期間不算卡住，但 hard 上限到了
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe("error");
    releases.forEach((r) => r());
    await Promise.all(blockers);
    await sleep(10);
    expect(am.send).not.toHaveBeenCalled();
  });

  it("排隊期間（尚未送出）不會因為「沒活動」被判卡住", async () => {
    const releases: (() => void)[] = [];
    const blockers = Array.from({ length: 3 }, () =>
      withBackgroundSlot(() => new Promise<void>((r) => releases.push(r))));
    await tick();
    const s = makeSession("queued-2");
    const { am, done } = launch(s, { idleMs: 30, hardMs: 5_000 });
    await sleep(100); // 遠超 idle，但還沒開始
    expect(done).toHaveLength(0);
    releases.forEach((r) => r());
    await Promise.all(blockers);
    await sleep(10);
    expect(am.send).toHaveBeenCalledOnce();
    s.emit("event", { type: "message", payload: { content: "完成\n【完成自驗】結論：已驗證完成" } });
    s.emit("event", { type: "result", payload: {} });
    await tick();
    expect(done[0]).toMatchObject({ status: "ok", output: "完成\n【完成自驗】結論：已驗證完成" });
  });
});

describe("同步外包（runOneExecuteAsConsult，自主迴圈用）", () => {
  it("perItemTimeoutMs 是「連續沒動靜」的上限：一直有進展就繼續等", async () => {
    const s = makeSession("sync-act");
    const deps = { start: () => s, send: () => ({ turnId: 1 }), reclaim: vi.fn(), kill: vi.fn() };
    const p = runOneExecuteAsConsult(item, "ws1", 50, deps);
    await tick();
    for (let i = 0; i < 6; i++) {
      await sleep(25);
      s.emit("event", { type: "tool_result", turnId: 1, payload: { status: "ok" } });
    }
    s.emit("event", { type: "message", turnId: 1, payload: { content: "已完成\n【完成自驗】結論：已驗證完成" } });
    s.emit("event", { type: "result", turnId: 1, payload: {} });
    const res = await p;
    expect(res.status).toBe("ok");
    expect(res.output).toBe("已完成\n【完成自驗】結論：已驗證完成");
    expect(deps.kill).not.toHaveBeenCalled();
  });

  it("額度用盡的結果 → error", async () => {
    const s = makeSession("sync-limit");
    const deps = { start: () => s, send: () => ({ turnId: 1 }), reclaim: vi.fn(), kill: vi.fn() };
    const p = runOneExecuteAsConsult(item, "ws1", 5_000, deps);
    await tick();
    s.emit("event", { type: "message", turnId: 1, payload: { content: "You've hit your weekly limit" } });
    s.emit("event", { type: "result", turnId: 1, payload: {} });
    expect((await p).status).toBe("error");
  });
});

describe("helpers", () => {
  it("isUsageLimitText：只認短的額度通知，不誤判報告內文", () => {
    expect(isUsageLimitText("You've hit your session limit · resets 9pm (Asia/Taipei)")).toBe(true);
    expect(isUsageLimitText("Claude AI usage limit reached|1760000000")).toBe(true);
    expect(isUsageLimitText("報告：" + "x".repeat(500) + " hit your session limit")).toBe(false);
    expect(isUsageLimitText("")).toBe(false);
  });

  it("executeResultOk：空內容 / is_error / 額度通知 → false", () => {
    expect(executeResultOk({}, "完成")).toBe(true);
    expect(executeResultOk({}, "  ")).toBe(false);
    expect(executeResultOk({ is_error: true }, "部分")).toBe(false);
    expect(executeResultOk(undefined, "You've hit your session limit")).toBe(false);
  });

  it("executeLimits：預設 idle 15 分鐘 / 上限 120 分鐘，可用環境變數調整，上限不小於 idle", () => {
    expect(executeLimits({})).toEqual({ idleMs: 15 * 60_000, hardMs: 120 * 60_000 });
    expect(executeLimits({ DISPATCH_EXECUTE_IDLE_MS: "60000", DISPATCH_EXECUTE_MAX_MS: "600000" }))
      .toEqual({ idleMs: 60_000, hardMs: 600_000 });
    expect(executeLimits({ DISPATCH_EXECUTE_IDLE_MS: "900000", DISPATCH_EXECUTE_MAX_MS: "1000" }))
      .toEqual({ idleMs: 900_000, hardMs: 900_000 });
  });
});
