import { describe, it, expect } from "vitest";
import { mapWithConcurrency, runConsult } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";

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
    const fake = async (it: DispatchItem) => ({ agentId: it.agentId, task: it.task, output: it.agentId + "答", status: "ok" as const });
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res).toEqual([
      { agentId: "a", task: "問A", output: "a答", status: "ok" },
      { agentId: "b", task: "問B", output: "b答", status: "ok" },
    ]);
  });
  it("逾時/錯誤項標記 status 但不拖垮整批", async () => {
    const fake = async (it: DispatchItem) =>
      it.agentId === "a"
        ? { agentId: "a", task: "問A", output: "", status: "timeout" as const }
        : { agentId: "b", task: "問B", output: "b答", status: "ok" as const };
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res.map((r) => r.status)).toEqual(["timeout", "ok"]);
  });
});
