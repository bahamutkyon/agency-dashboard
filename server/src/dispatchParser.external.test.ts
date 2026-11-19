import { describe, it, expect } from "vitest";
import { parseDispatchMarker, serializeDispatchItem } from "./dispatchParser.js";

describe("DISPATCH external 欄位", () => {
  it("解析 external: true，序列化可來回", () => {
    const plan = parseDispatchMarker("=== DISPATCH ===\n- agentId: a\n  mode: execute\n  external: true\n  task: 回覆客人\n=== END DISPATCH ===");
    expect(plan!.items[0].external).toBe(true);
    const again = parseDispatchMarker(`=== DISPATCH ===\n${serializeDispatchItem(plan!.items[0])}\n=== END DISPATCH ===`);
    expect(again!.items[0]).toEqual(plan!.items[0]);
  });
  it("沒寫或寫 false 就不帶這個欄位（舊格式不變）", () => {
    const plan = parseDispatchMarker("=== DISPATCH ===\n- agentId: a\n  external: false\n  task: x\n=== END DISPATCH ===");
    expect(plan!.items[0]).toEqual({ agentId: "a", mode: "consult", task: "x" });
  });
});
