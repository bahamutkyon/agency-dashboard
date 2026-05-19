import { describe, it, expect } from "vitest";
import { buildCraftMemoryBlock } from "./learningInjector.js";

describe("buildCraftMemoryBlock", () => {
  it("有內容時產生含標題與內容的注入塊", () => {
    const block = buildCraftMemoryBlock("- [2026-05-19] 標題前 8 字放數字");
    expect(block).toContain("你累積的手藝與領域知識");
    expect(block).toContain("標題前 8 字放數字");
  });

  it("空內容回傳空字串", () => {
    expect(buildCraftMemoryBlock("")).toBe("");
    expect(buildCraftMemoryBlock("   ")).toBe("");
  });
});
