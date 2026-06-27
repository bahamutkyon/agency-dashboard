import { describe, it, expect } from "vitest";
import { mapWithConcurrency, runConsult, startExecute, buildExecutePrompt } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";

describe("buildExecutePrompt（外包自驗+證據）", () => {
  it("保留原任務、追加【完成自驗】證據區塊與必填欄位", () => {
    const p = buildExecutePrompt("把這 10 件電容同步到 FB");
    expect(p).toContain("把這 10 件電容同步到 FB"); // 原任務不可被吃掉
    expect(p).toContain("【完成自驗】");
    expect(p).toContain("證據");
    expect(p).toContain("結論：已驗證完成");
    // 禁止無驗證措辭的規則要在
    expect(p).toMatch(/應該沒問題|未驗證/);
  });
});

describe("mapWithConcurrency", () => {
  it("保序回傳、全部完成", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("同時在跑的數量不超過 limit", async () => {
    let running = 0, peak = 0;
    const work = async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--; return 0;
    };
    await mapWithConcurrency([0, 0, 0, 0, 0], 2, work);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("單項拋錯不影響其他項（由 fn 自行 try/catch 時）", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 3, async (n) => (n === 2 ? "ERR" : "ok"));
    expect(out).toEqual(["ok", "ERR", "ok"]);
  });
});

describe("runConsult（注入假 runOne）", () => {
  const items: DispatchItem[] = [
    { agentId: "a", mode: "consult", task: "問A" },
    { agentId: "b", mode: "consult", task: "問B" },
  ];
  it("收集每項輸出與狀態", async () => {
    const fake = async (it: DispatchItem) => ({ agentId: it.agentId, task: it.task, output: it.agentId + "答", status: "ok" as const, subSessionId: "sub-" + it.agentId });
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res).toEqual([
      { agentId: "a", task: "問A", output: "a答", status: "ok", subSessionId: "sub-a" },
      { agentId: "b", task: "問B", output: "b答", status: "ok", subSessionId: "sub-b" },
    ]);
  });
  it("逾時/錯誤項標記 status 但不拖垮整批", async () => {
    const fake = async (it: DispatchItem) =>
      it.agentId === "a"
        ? { agentId: "a", task: "問A", output: "", status: "timeout" as const, subSessionId: "sub-a" }
        : { agentId: "b", task: "問B", output: "b答", status: "ok" as const, subSessionId: "sub-b" };
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res.map((r) => r.status)).toEqual(["timeout", "ok"]);
  });
});

describe("startExecute（注入假 deps）", () => {
  it("為每項回 subSessionId 並在完成時呼叫 onDone", async () => {
    const done: any[] = [];
    const deps = {
      start: (it: DispatchItem) => "sub-" + it.agentId,
      attachDone: (_subId: string, cb: (output: string, ok: boolean) => void) => {
        setTimeout(() => cb("做完了", true), 5);
      },
    };
    const handles = startExecute(
      [{ agentId: "ec", mode: "execute", task: "上架" }], "ws1", "pm1",
      (d) => done.push(d), deps,
    );
    expect(handles[0]).toEqual({ subSessionId: "sub-ec", agentId: "ec" });
    await new Promise((r) => setTimeout(r, 20));
    expect(done[0]).toMatchObject({ agentId: "ec", subSessionId: "sub-ec", output: "做完了", status: "ok", pmSessionId: "pm1" });
  });
});
