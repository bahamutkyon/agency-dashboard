/**
 * dispatchRunner.late.test.ts — 交辦回報斷鏈的三層修復。
 *
 * 真實事故（2026-07-13 台帳 6/6 全滅）：consult 子代理在 240s 上限前還在跑工具，
 * 逾時那刻 `collected` 只剩「最後一則過程旁白」（覆寫語意），PM 收到的是
 * 「我先確認 lpaudio 資料夾位置」這類碎念、不是結論；而真正的結論在逾時後
 * 61~495 秒才產出，卻沒有任何路徑收回來，就爛在 DB 裡。
 *
 * 這裡鎖住兩件事：
 *  1. 逾時輸出＝完整過程訊息 + 明確「這不是結論」標示（PM 不會誤當數據整合）
 *  2. 逾時項會掛「遲到補報」監聽，結論到了就回流 PM
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildTimeoutOutput, attachLateConsults, runOneConsult, makeLateConsultDeps,
  TIMEOUT_OUTPUT_HEADER, type ConsultResult,
} from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";
import { EventEmitter } from "node:events";
import { __resetBackgroundLimiterForTest } from "./backgroundLimiter.js";

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

describe("buildTimeoutOutput（逾時救援內容）", () => {
  it("保留所有過程訊息，不只最後一則（舊 bug：覆寫只剩碎念）", () => {
    const out = buildTimeoutOutput(
      ["我先確認 lpaudio 資料夾位置", "露天證據很硬（銷售 0）", "接著掃蝦皮和淘寶"],
      "",
    );
    expect(out).toContain("我先確認 lpaudio 資料夾位置");
    expect(out).toContain("露天證據很硬（銷售 0）");
    expect(out).toContain("接著掃蝦皮和淘寶");
  });

  it("明確標示「未完成、不可當結論」——PM 才不會把過程碎念整合成答案", () => {
    const out = buildTimeoutOutput(["中間過程"], "");
    expect(out).toContain(TIMEOUT_OUTPUT_HEADER);
    expect(out).toMatch(/不是結論|不可當成結論/);
  });

  it("沒有 message 事件時退回串流內容", () => {
    const out = buildTimeoutOutput([], "串流到一半的字");
    expect(out).toContain("串流到一半的字");
  });

  it("完全沒內容 → 明說沒取得，不回空字串", () => {
    const out = buildTimeoutOutput([], "");
    expect(out).not.toBe("");
    expect(out).toMatch(/沒有|未取得/);
  });
});

describe("runOneConsult 逾時 → 帶回完整過程訊息", () => {
  it("多則 assistant 訊息全部保留（不是只有最後一則）", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("late-1");
    const deps = {
      start: () => session,
      send: () => {
        // agentic 迴圈：一個回合內吐多則過程訊息，逾時前都還沒給結論
        setTimeout(() => session.emit("event", { type: "message", turnId: 1, payload: { content: "第一步：查資料" } }), 5);
        setTimeout(() => session.emit("event", { type: "message", turnId: 1, payload: { content: "第二步：改用別的來源" } }), 10);
        return { turnId: 1 };
      },
      reclaim: vi.fn(),
      kill: vi.fn(),
    };
    const item: DispatchItem = { agentId: "a1", mode: "consult", task: "查行情" };
    const res = await runOneConsult(item, "ws1", 40, deps);

    expect(res.status).toBe("timeout");
    expect(res.output).toContain("第一步：查資料");       // 舊版會被覆寫掉 → 這行是回歸測試
    expect(res.output).toContain("第二步：改用別的來源");
    expect(res.output).toContain(TIMEOUT_OUTPUT_HEADER);
  });

  it("正常拿到 result → 輸出是最終答案本身，不加逾時標示", async () => {
    __resetBackgroundLimiterForTest();
    const session = makeSession("ok-1");
    const deps = {
      start: () => session,
      send: () => {
        setTimeout(() => {
          session.emit("event", { type: "message", turnId: 1, payload: { content: "過程" } });
          session.emit("event", { type: "message", turnId: 1, payload: { content: "## 結論：進 2 台" } });
          session.emit("event", { type: "result", turnId: 1 });
        }, 5);
        return { turnId: 1 };
      },
      reclaim: vi.fn(),
      kill: vi.fn(),
    };
    const res = await runOneConsult({ agentId: "a1", mode: "consult", task: "t" }, "ws1", 5000, deps);

    expect(res.status).toBe("ok");
    expect(res.output).toBe("## 結論：進 2 台");          // 最終訊息＝答案，不該混入過程
    expect(res.output).not.toContain(TIMEOUT_OUTPUT_HEADER);
  });
});

describe("attachLateConsults（逾時後的遲到補報）", () => {
  const results: ConsultResult[] = [
    { agentId: "a", task: "問A", output: "答A", status: "ok", subSessionId: "sub-a" },
    { agentId: "b", task: "問B", output: "碎念", status: "timeout", subSessionId: "sub-b" },
    { agentId: "c", task: "問C", output: "", status: "error", subSessionId: "" },
  ];

  it("只對 timeout 且有 subSessionId 的項掛監聽（ok/error 不掛）", () => {
    const attached: string[] = [];
    attachLateConsults(results, () => {}, { attach: (id) => { attached.push(id); } });
    expect(attached).toEqual(["sub-b"]);
  });

  it("結論補回來 → onLate 帶正確 index/agentId/output（index 供呼叫端對回台帳）", async () => {
    const late: any[] = [];
    attachLateConsults(results, (r) => late.push(r), {
      attach: (_id, cb) => { setTimeout(() => cb("## 結論：進 2 台", true), 5); },
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      index: 1, agentId: "b", subSessionId: "sub-b",
      output: "## 結論：進 2 台", ok: true,
    });
  });

  it("子代理最後仍沒補出內容 → 不回報（不拿空手訊息去吵 PM）", async () => {
    const late: any[] = [];
    attachLateConsults(results, (r) => late.push(r), { attach: () => { /* 永不回呼 */ } });
    await new Promise((r) => setTimeout(r, 20));
    expect(late).toHaveLength(0);
  });
});

/**
 * makeLateConsultDeps 是「正式環境真的會跑」的那一份（上面的測試都注入假 deps）。
 * 它直接對 agentManager 的活 session 補掛監聽，錯了就是線上壞掉——故用 fake agentManager 實測。
 */
describe("makeLateConsultDeps（正式路徑：真的掛上 agentManager 的活 session）", () => {
  function makeFakeAm(session: any) {
    return {
      start: vi.fn(),
      send: vi.fn(),
      get: (id: string) => (session && session.id === id ? session : undefined),
      reclaimSubprocess: vi.fn(() => true),
    };
  }

  it("結論到達 → 回呼帶結論，並回收 shadow 子程序（釋放記憶體/解除 shadow 計數）", async () => {
    const session = makeSession("live-1");
    const am = makeFakeAm(session);
    const got: { out: string; ok: boolean }[] = [];

    makeLateConsultDeps(am as any).attach("live-1", (out, ok) => got.push({ out, ok }));
    // 補掛之後子代理才把結論做完（正是事故中「逾時後 +82 秒」的情境）
    session.emit("event", { type: "message", payload: { content: "## 結論：進 2 台" } });
    session.emit("event", { type: "result" });
    await new Promise((r) => setTimeout(r, 5)); // 等 queueMicrotask 的 reclaim

    expect(got).toEqual([{ out: "## 結論：進 2 台", ok: true }]);
    expect(am.reclaimSubprocess).toHaveBeenCalledWith("live-1");
  });

  it("子 session 已被回收（get 回 undefined）→ 靜默略過，不炸也不回報", () => {
    const am = makeFakeAm(null);
    const got: any[] = [];
    expect(() => makeLateConsultDeps(am as any).attach("gone", (o, k) => got.push({ o, k }))).not.toThrow();
    expect(got).toHaveLength(0);
  });

  it("result 到了但整回合空手 → 不回報（避免補一則沒內容的訊息）", async () => {
    const session = makeSession("live-2");
    const am = makeFakeAm(session);
    const got: any[] = [];

    makeLateConsultDeps(am as any).attach("live-2", (o, k) => got.push({ o, k }));
    session.emit("event", { type: "result" });
    await new Promise((r) => setTimeout(r, 5));

    expect(got).toHaveLength(0);
  });

  it("只吐 delta 串流（無 message 事件）也能補回內容", async () => {
    const session = makeSession("live-3");
    const am = makeFakeAm(session);
    const got: { out: string }[] = [];

    makeLateConsultDeps(am as any).attach("live-3", (out) => got.push({ out }));
    session.emit("event", { type: "delta", payload: "結論：" });
    session.emit("event", { type: "delta", payload: "守 59k" });
    session.emit("event", { type: "result" });
    await new Promise((r) => setTimeout(r, 5));

    expect(got[0].out).toBe("結論：守 59k");
  });
});
