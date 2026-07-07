/**
 * dispatchRunner — 派工子 session 拿到 result 後立即回收 claude 子程序
 *
 * 驗證（注入 fake session/EventEmitter + reclaim spy）：
 * - consult 同步路徑：result(ok) 後 reclaim 被呼叫；result(error/空內容) 後仍呼叫；timeout 後不呼叫
 * - execute-sync 路徑：result 後 reclaim 被呼叫
 * - execute 非同步路徑（makeExecuteDeps）：result 後 reclaim 被呼叫，且 attachDone 的 cb 先拿到完整 output（順序不被破壞）；無 result 時不誤呼叫
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  runOneConsult,
  runOneExecuteAsConsult,
  makeExecuteDeps,
  startExecute,
  type DispatchSessionDeps,
} from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";
import { __resetBackgroundLimiterForTest } from "./backgroundLimiter.js";

/** 讓事件迴圈跑一輪，把已就緒的 microtask/timer 抽乾。 */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 假 session：EventEmitter + id，支援 on/removeListener/emit。 */
function makeFakeSession(id: string): any {
  const ee: any = new EventEmitter();
  ee.id = id;
  return ee;
}

beforeEach(() => {
  __resetBackgroundLimiterForTest();
});

describe("runOneConsult — result 後回收子程序", () => {
  const item: DispatchItem = { agentId: "agent-a", mode: "consult", task: "問一個問題" };

  it("result(ok) 後 reclaim 以 session.id 被呼叫一次", async () => {
    const session = makeFakeSession("sub-consult-ok");
    const deps: DispatchSessionDeps = {
      start: vi.fn(() => session),
      send: vi.fn(() => ({ turnId: 1 })),
      reclaim: vi.fn(),
    };

    const p = runOneConsult(item, "ws1", 10_000, deps);
    await tick(); // 進入背景槽、start/send 已呼叫、監聽器已掛上

    session.emit("event", { type: "message", turnId: 1, payload: { content: "答案內容" } });
    session.emit("event", { type: "result", turnId: 1, payload: {} });

    const res = await p;
    expect(res.status).toBe("ok");
    expect(res.output).toBe("答案內容");
    expect(res.subSessionId).toBe("sub-consult-ok");

    await tick(); // 讓 queueMicrotask 的 reclaim 執行
    expect(deps.reclaim).toHaveBeenCalledOnce();
    expect(deps.reclaim).toHaveBeenCalledWith("sub-consult-ok");
  });

  it("result(error / 空內容) 後仍回收（status !== timeout）", async () => {
    const session = makeFakeSession("sub-consult-err");
    const deps: DispatchSessionDeps = {
      start: vi.fn(() => session),
      send: vi.fn(() => ({ turnId: 1 })),
      reclaim: vi.fn(),
    };

    const p = runOneConsult(item, "ws1", 10_000, deps);
    await tick();

    // 無 message/delta，直接 result → 空內容 → status "error"
    session.emit("event", { type: "result", turnId: 1, payload: {} });

    const res = await p;
    expect(res.status).toBe("error");

    await tick();
    expect(deps.reclaim).toHaveBeenCalledOnce();
    expect(deps.reclaim).toHaveBeenCalledWith("sub-consult-err");
  });

  it("timeout 後不回收（子 agent 還在跑，交給 TTL 收）", async () => {
    const session = makeFakeSession("sub-consult-timeout");
    const deps: DispatchSessionDeps = {
      start: vi.fn(() => session),
      send: vi.fn(() => ({ turnId: 1 })),
      reclaim: vi.fn(),
    };

    const p = runOneConsult(item, "ws1", 20, deps); // 20ms 逾時
    await tick();
    // 不 emit result，等逾時觸發
    const res = await p;
    expect(res.status).toBe("timeout");

    await tick();
    expect(deps.reclaim).not.toHaveBeenCalled();
  });
});

describe("runOneExecuteAsConsult — result 後回收子程序", () => {
  const item: DispatchItem = { agentId: "agent-b", mode: "execute", task: "執行一個任務" };

  it("result 後 reclaim 被呼叫", async () => {
    const session = makeFakeSession("sub-exec-sync");
    const deps: DispatchSessionDeps = {
      start: vi.fn(() => session),
      send: vi.fn(() => ({ turnId: 1 })),
      reclaim: vi.fn(),
    };

    const p = runOneExecuteAsConsult(item, "ws1", 10_000, deps);
    await tick();

    session.emit("event", { type: "message", turnId: 1, payload: { content: "已完成並自驗" } });
    session.emit("event", { type: "result", turnId: 1, payload: {} });

    const res = await p;
    expect(res.status).toBe("ok");
    expect(res.output).toBe("已完成並自驗");

    await tick();
    expect(deps.reclaim).toHaveBeenCalledWith("sub-exec-sync");
  });

  it("timeout 後不回收", async () => {
    const session = makeFakeSession("sub-exec-sync-timeout");
    const deps: DispatchSessionDeps = {
      start: vi.fn(() => session),
      send: vi.fn(() => ({ turnId: 1 })),
      reclaim: vi.fn(),
    };

    const p = runOneExecuteAsConsult(item, "ws1", 20, deps);
    await tick();
    const res = await p;
    expect(res.status).toBe("timeout");

    await tick();
    expect(deps.reclaim).not.toHaveBeenCalled();
  });
});

describe("execute 非同步路徑（makeExecuteDeps）— result 後回收，且 attachDone 先拿到完整 output", () => {
  const item: DispatchItem = { agentId: "agent-c", mode: "execute", task: "背景外包執行" };

  it("result 後 reclaim 被呼叫；attachDone.cb 拿到完整 output（順序不被破壞）", async () => {
    const session = makeFakeSession("sub-async");
    const order: string[] = [];
    const reclaimSpy = vi.fn(() => { order.push("reclaim"); });
    const fakeAm: any = {
      start: vi.fn(() => session),
      send: vi.fn(),
      get: vi.fn(() => session),
      reclaimSubprocess: reclaimSpy,
    };
    const deps = makeExecuteDeps(fakeAm);

    const outputs: any[] = [];
    const handles = startExecute([item], "ws1", "pm1", (d) => {
      order.push("cb");
      outputs.push(d);
    }, deps);

    expect(handles[0]).toEqual({ subSessionId: "sub-async", agentId: "agent-c" });

    await tick(); // 進入背景槽、send 已呼叫、槽監聽器掛上；attachDone 監聽器同步已掛

    session.emit("event", { type: "message", payload: { content: "外包執行完成報告" } });
    session.emit("event", { type: "result", payload: {} });

    await tick(); // 讓 queueMicrotask 的 reclaim 執行

    // attachDone 拿到完整 output、狀態 ok
    expect(outputs[0]).toMatchObject({
      subSessionId: "sub-async",
      agentId: "agent-c",
      output: "外包執行完成報告",
      status: "ok",
      pmSessionId: "pm1",
    });
    // reclaim 被呼叫
    expect(reclaimSpy).toHaveBeenCalledWith("sub-async");
    // 順序：attachDone 的 cb 先於 reclaim（reclaim 延到 microtask 後）
    expect(order.indexOf("cb")).toBeLessThan(order.indexOf("reclaim"));
  });

  it("尚未收到 result 時不誤呼叫 reclaim", async () => {
    const session = makeFakeSession("sub-async-noresult");
    const reclaimSpy = vi.fn();
    const fakeAm: any = {
      start: vi.fn(() => session),
      send: vi.fn(),
      get: vi.fn(() => session),
      reclaimSubprocess: reclaimSpy,
    };
    const deps = makeExecuteDeps(fakeAm);

    startExecute([item], "ws1", "pm1", () => {}, deps);
    await tick();
    // 只 emit 中間事件、不 emit result
    session.emit("event", { type: "delta", payload: "部分" });
    await tick();
    expect(reclaimSpy).not.toHaveBeenCalled();
  });
});
