import { describe, it, expect } from "vitest";
import { parseDispatchMarker, validateDispatchPlan } from "./dispatchParser.js";

describe("parseDispatchMarker", () => {
  it("無 DISPATCH 區塊 → null", () => {
    expect(parseDispatchMarker("一般回覆，沒有標記")).toBeNull();
  });

  it("單項、缺 mode → 預設 consult", () => {
    const txt = `好的\n\n=== DISPATCH ===\n- agentId: legal-contract-reviewer\n  task: 這份合約有哪些風險條款？\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toEqual({ agentId: "legal-contract-reviewer", mode: "consult", task: "這份合約有哪些風險條款？" });
  });

  it("多項、混合 mode", () => {
    const txt = `=== DISPATCH ===\n- agentId: legal-contract-reviewer\n  mode: consult\n  task: 風險條款？\n- agentId: ecommerce-ops\n  mode: execute\n  task: 上架露天\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items.map((i) => i.mode)).toEqual(["consult", "execute"]);
    expect(p.items[1].agentId).toBe("ecommerce-ops");
  });

  it("項目缺 task → 該項被丟棄", () => {
    const txt = `=== DISPATCH ===\n- agentId: a\n  mode: consult\n- agentId: b\n  task: 有問題\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0].agentId).toBe("b");
  });

  it("非法 mode → 退回 consult", () => {
    const txt = `=== DISPATCH ===\n- agentId: a\n  mode: 亂寫\n  task: x\n=== END DISPATCH ===`;
    expect(parseDispatchMarker(txt)!.items[0].mode).toBe("consult");
  });
});

describe("validateDispatchPlan", () => {
  it("依已知 agentId 分流 valid / dropped", () => {
    const plan = { items: [
      { agentId: "known-1", mode: "consult" as const, task: "x" },
      { agentId: "ghost", mode: "consult" as const, task: "y" },
    ]};
    const { valid, dropped } = validateDispatchPlan(plan, new Set(["known-1"]));
    expect(valid.map((i) => i.agentId)).toEqual(["known-1"]);
    expect(dropped.map((i) => i.agentId)).toEqual(["ghost"]);
  });
});
