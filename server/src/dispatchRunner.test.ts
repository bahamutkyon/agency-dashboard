import { describe, it, expect } from "vitest";
import { mapWithConcurrency, runConsult, startExecute, buildExecutePrompt, buildDispatchBrief, runDispatchByMode } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";

describe("buildDispatchBrief（結構化交辦簡報）", () => {
  it("無選填欄位 → 等同純 task（向後相容）", () => {
    const item: DispatchItem = { agentId: "a", mode: "consult", task: "做某件事" };
    expect(buildDispatchBrief(item)).toBe("做某件事");
  });

  it("含 context/deliverable/accept → 組成完整簡報，各段落都在", () => {
    const item: DispatchItem = {
      agentId: "legal",
      mode: "consult",
      task: "分析合約",
      context: "SaaS 訂閱制",
      deliverable: "風險清單",
      accept: ["列出高風險條款", "說明建議方向"],
    };
    const brief = buildDispatchBrief(item);
    expect(brief).toContain("分析合約");
    expect(brief).toContain("【背景】SaaS 訂閱制");
    expect(brief).toContain("【交付物】風險清單");
    expect(brief).toContain("【驗收標準】");
    expect(brief).toContain("- 列出高風險條款");
    expect(brief).toContain("- 說明建議方向");
  });

  it("只有 context 沒有 deliverable/accept → 只加背景段落", () => {
    const item: DispatchItem = {
      agentId: "a",
      mode: "consult",
      task: "任務A",
      context: "背景資訊",
    };
    const brief = buildDispatchBrief(item);
    expect(brief).toContain("【背景】背景資訊");
    expect(brief).not.toContain("【交付物】");
    expect(brief).not.toContain("【驗收標準】");
  });

  it("execute prompt 包裹 brief 後仍含【完成自驗】且保留 task 文字", () => {
    const item: DispatchItem = {
      agentId: "ec",
      mode: "execute",
      task: "上架露天",
      context: "SKU 在 data.xlsx",
      deliverable: "10 件上架截圖",
      accept: ["截圖含商品名稱", "價格正確"],
    };
    const prompt = buildExecutePrompt(buildDispatchBrief(item));
    expect(prompt).toContain("【完成自驗】");
    expect(prompt).toContain("上架露天");
    expect(prompt).toContain("【背景】");
    expect(prompt).toContain("截圖含商品名稱");
  });
});

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

describe("runDispatchByMode（mode 分流）", () => {
  const consultItem: DispatchItem = { agentId: "agent-a", mode: "consult", task: "諮詢任務" };
  const executeItem: DispatchItem = { agentId: "agent-b", mode: "execute", task: "執行任務" };

  const makeResult = (item: DispatchItem, suffix: string) => ({
    agentId: item.agentId, task: item.task, output: `${item.agentId}-${suffix}`,
    status: "ok" as const, subSessionId: `sub-${item.agentId}`,
  });

  it("consult 項走 runOneConsultFn、不走 execute", async () => {
    const consultCalls: { item: DispatchItem; timeoutMs: number }[] = [];
    const executeCalls: any[] = [];

    const result = await runDispatchByMode(
      [consultItem], "ws1",
      { concurrency: 3, consultTimeoutMs: 300_000, executeTimeoutMs: 600_000 },
      async (item, _ws, timeoutMs) => { consultCalls.push({ item, timeoutMs }); return makeResult(item, "c"); },
      async (item, _ws, timeoutMs) => { executeCalls.push({ item, timeoutMs }); return makeResult(item, "e"); },
    );

    expect(consultCalls).toHaveLength(1);
    expect(executeCalls).toHaveLength(0);
    expect(result).toContain("agent-a（ok）");
    expect(result).toContain("agent-a-c");
  });

  it("execute 項走 runOneExecuteFn、不走 consult", async () => {
    const consultCalls: any[] = [];
    const executeCalls: { item: DispatchItem; timeoutMs: number }[] = [];

    const result = await runDispatchByMode(
      [executeItem], "ws1",
      { concurrency: 3, consultTimeoutMs: 300_000, executeTimeoutMs: 600_000 },
      async (item, _ws, timeoutMs) => { consultCalls.push({ item, timeoutMs }); return makeResult(item, "c"); },
      async (item, _ws, timeoutMs) => { executeCalls.push({ item, timeoutMs }); return makeResult(item, "e"); },
    );

    expect(consultCalls).toHaveLength(0);
    expect(executeCalls).toHaveLength(1);
    expect(result).toContain("agent-b（ok）");
    expect(result).toContain("agent-b-e");
  });

  it("execute 項使用 executeTimeoutMs（比 consultTimeoutMs 長）", async () => {
    const executeCalls: { timeoutMs: number }[] = [];

    await runDispatchByMode(
      [executeItem], "ws1",
      { concurrency: 3, consultTimeoutMs: 5 * 60 * 1000, executeTimeoutMs: 10 * 60 * 1000 },
      async (item) => makeResult(item, "c"),
      async (item, _ws, timeoutMs) => { executeCalls.push({ timeoutMs }); return makeResult(item, "e"); },
    );

    expect(executeCalls[0].timeoutMs).toBe(10 * 60 * 1000);
  });

  it("mixed mode（consult+execute+consult）：結果保序合併", async () => {
    const result = await runDispatchByMode(
      [consultItem, executeItem, consultItem], "ws1",
      { concurrency: 3, consultTimeoutMs: 300_000, executeTimeoutMs: 600_000 },
      async (item) => makeResult(item, "c"),
      async (item) => makeResult(item, "e"),
    );

    const sections = result.split("\n\n");
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain("agent-a（ok）");
    expect(sections[1]).toContain("agent-b（ok）");
    expect(sections[2]).toContain("agent-a（ok）");
    expect(sections[0]).toContain("agent-a-c");
    expect(sections[1]).toContain("agent-b-e");
    expect(sections[2]).toContain("agent-a-c");
  });

  it("純 execute 批次：全部使用 executeTimeoutMs", async () => {
    const calls: { timeoutMs: number }[] = [];
    const items: DispatchItem[] = [
      { agentId: "e1", mode: "execute", task: "任務1" },
      { agentId: "e2", mode: "execute", task: "任務2" },
    ];

    await runDispatchByMode(
      items, "ws1",
      { concurrency: 2, consultTimeoutMs: 5 * 60 * 1000, executeTimeoutMs: 10 * 60 * 1000 },
      async (item) => makeResult(item, "c"),
      async (item, _ws, timeoutMs) => { calls.push({ timeoutMs }); return makeResult(item, "e"); },
    );

    expect(calls).toHaveLength(2);
    expect(calls.every(c => c.timeoutMs === 10 * 60 * 1000)).toBe(true);
  });
});
