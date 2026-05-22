import { describe, it, expect } from "vitest";
import { buildCapabilityBlock } from "./learningInjector.js";

describe("buildCapabilityBlock", () => {
  it("兩段皆空 → 回傳空字串", () => {
    expect(buildCapabilityBlock("", "")).toBe("");
    expect(buildCapabilityBlock("   ", "  ")).toBe("");
  });

  it("只有類記憶 → 只含類共通能力段，不含個人手藝段", () => {
    const b = buildCapabilityBlock("- [2026-05-21] 類能力", "");
    expect(b).toContain("類共通能力");
    expect(b).toContain("類能力");
    expect(b).not.toContain("個人手藝");
  });

  it("只有個人手藝 → 只含個人手藝段", () => {
    const b = buildCapabilityBlock("", "- [2026-05-21] 個人手藝條目");
    expect(b).toContain("個人手藝");
    expect(b).toContain("個人手藝條目");
    expect(b).not.toContain("類共通能力");
  });

  it("兩段都有 → 兩段都在", () => {
    const b = buildCapabilityBlock("類能力 X", "個人手藝 Y");
    expect(b).toContain("類能力 X");
    expect(b).toContain("個人手藝 Y");
  });
});
