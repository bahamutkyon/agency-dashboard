import { describe, it, expect } from "vitest";
import { parseDispatchMarker, validateDispatchPlan, serializeDispatchItem, MAX_ACCEPT_ITEMS } from "./dispatchParser.js";
import type { DispatchItem } from "./dispatchParser.js";

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

describe("新功能：多行 task", () => {
  it("多行 task 正確合併（換行保留、前後空白去除）", () => {
    const txt = [
      "=== DISPATCH ===",
      "- agentId: coding-agent",
      "  task: 這是第一行",
      "    這是第二行",
      "    這是第三行",
      "=== END DISPATCH ===",
    ].join("\n");
    const p = parseDispatchMarker(txt)!;
    expect(p.items[0].task).toBe("這是第一行\n這是第二行\n這是第三行");
  });
});

describe("新功能：context/deliverable/accept 全欄位解析", () => {
  it("全欄位解析出正確值", () => {
    const txt = [
      "=== DISPATCH ===",
      "- agentId: legal-agent",
      "  mode: consult",
      "  task: 分析這份合約",
      "  context: 合約是 SaaS 訂閱制",
      "  deliverable: 風險清單",
      "  accept:",
      "    - 必須列出高風險條款",
      "    - 必須說明建議修改方向",
      "=== END DISPATCH ===",
    ].join("\n");
    const p = parseDispatchMarker(txt)!;
    const item = p.items[0];
    expect(item.task).toBe("分析這份合約");
    expect(item.context).toBe("合約是 SaaS 訂閱制");
    expect(item.deliverable).toBe("風險清單");
    expect(item.accept).toEqual(["必須列出高風險條款", "必須說明建議修改方向"]);
  });

  it("accept 最多取 MAX_ACCEPT_ITEMS 條，多餘截斷（舊上限 3 會讓第 4 條起無聲消失）", () => {
    const n = MAX_ACCEPT_ITEMS + 2;
    const txt = [
      "=== DISPATCH ===",
      "- agentId: agent-x",
      "  task: 做事",
      "  accept:",
      ...Array.from({ length: n }, (_, i) => `    - 條件${i + 1}`),
      "=== END DISPATCH ===",
    ].join("\n");
    const p = parseDispatchMarker(txt)!;
    expect(MAX_ACCEPT_ITEMS).toBeGreaterThanOrEqual(5);
    expect(p.items[0].accept).toHaveLength(MAX_ACCEPT_ITEMS);
    expect(p.items[0].accept![0]).toBe("條件1");
    expect(p.items[0].accept![MAX_ACCEPT_ITEMS - 1]).toBe(`條件${MAX_ACCEPT_ITEMS}`);
  });

  it("無選填欄位時，parsed item 不含 context/deliverable/accept 鍵（向後相容）", () => {
    const txt = "=== DISPATCH ===\n- agentId: a\n  task: simple\n=== END DISPATCH ===";
    const item = parseDispatchMarker(txt)!.items[0];
    expect(item).not.toHaveProperty("context");
    expect(item).not.toHaveProperty("deliverable");
    expect(item).not.toHaveProperty("accept");
  });
});

describe("新功能：round-trip serializeDispatchItem → parseDispatchMarker", () => {
  it("全欄位 round-trip 還原", () => {
    const original: DispatchItem = {
      agentId: "legal-agent",
      mode: "consult",
      task: "分析合約\n注意高風險條款",
      context: "SaaS 訂閱制合約",
      deliverable: "風險清單",
      accept: ["列出高風險條款", "說明建議修改方向"],
    };
    const serialized = serializeDispatchItem(original);
    const block = `=== DISPATCH ===\n${serialized}\n=== END DISPATCH ===`;
    const parsed = parseDispatchMarker(block)!;
    const item = parsed.items[0];
    expect(item.agentId).toBe(original.agentId);
    expect(item.mode).toBe(original.mode);
    expect(item.task).toBe(original.task);
    expect(item.context).toBe(original.context);
    expect(item.deliverable).toBe(original.deliverable);
    expect(item.accept).toEqual(original.accept);
  });

  it("無選填欄位的 round-trip（execute mode）", () => {
    const original: DispatchItem = { agentId: "ec-ops", mode: "execute", task: "上架露天" };
    const serialized = serializeDispatchItem(original);
    const block = `=== DISPATCH ===\n${serialized}\n=== END DISPATCH ===`;
    const item = parseDispatchMarker(block)!.items[0];
    expect(item.agentId).toBe("ec-ops");
    expect(item.mode).toBe("execute");
    expect(item.task).toBe("上架露天");
    expect(item).not.toHaveProperty("context");
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
