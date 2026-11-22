import { describe, it, expect } from "vitest";
import { parseHandoff, HANDOFF_MAX } from "./handoffParser.js";

const wrap = (body: string) => `前言\n=== HANDOFF ===\n${body}\n=== END HANDOFF ===\n結尾`;

describe("parseHandoff", () => {
  it("取出區塊內文並 trim", () => {
    expect(parseHandoff(wrap("  🎯 目標：定價\n✅ 已決定：不走 FBA  "))).toBe("🎯 目標：定價\n✅ 已決定：不走 FBA");
  });
  it("沒有區塊 → null", () => {
    expect(parseHandoff("普通回覆")).toBeNull();
  });
  it("空區塊 → null", () => {
    expect(parseHandoff(wrap("   \n  "))).toBeNull();
  });
  it("多個區塊取最後一個", () => {
    expect(parseHandoff(wrap("舊版") + "\n" + wrap("新版"))).toBe("新版");
  });
  it("超過上限以字元截斷並標註", () => {
    const out = parseHandoff(wrap("字".repeat(HANDOFF_MAX + 50)))!;
    expect([...out].length).toBe(HANDOFF_MAX + "…（已截斷）".length);
    expect(out.endsWith("…（已截斷）")).toBe(true);
  });
  it("emoji 不會被切成半個字元", () => {
    const out = parseHandoff(wrap("😀".repeat(HANDOFF_MAX + 1)))!;
    expect(out.startsWith("😀".repeat(HANDOFF_MAX))).toBe(true);
  });
});
