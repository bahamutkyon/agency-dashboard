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

// 誤觸發防護：PM 手冊本身含交接單範本；使用者問「交接單長什麼樣」時 PM 照抄範本示範，
// 不能被當成真交接（會自動開新對話、把這場標 done）。
describe("parseHandoff — 範本示範不算交接", () => {
  const TEMPLATE = [
    "🎯 目標：這場要達成什麼",
    "✅ 已決定：談定、不要再重問的事（含數字與理由）",
    "🔄 進行中：交辦了一半的工作、等誰回報",
    "⏭️ 下一步：接手後第一件要做的事",
    "❓ 等你拍板：需要使用者決定的事",
    "📎 重要資料：數字、連結、檔案路徑",
  ].join("\n");
  it("照抄手冊範本（佔位說明）→ null", () => {
    expect(parseHandoff("交接單長這樣：\n" + wrap(TEMPLATE))).toBeNull();
  });
  it("包在 code block 裡照抄範本 → null", () => {
    expect(parseHandoff("格式如下：\n```\n" + wrap(TEMPLATE) + "\n```")).toBeNull();
  });
  it("只有欄位標題、內容全空的骨架 → null", () => {
    expect(parseHandoff(wrap("🎯 目標：\n✅ 已決定：\n🔄 進行中：\n⏭️ 下一步：\n❓ 等你拍板：\n📎 重要資料："))).toBeNull();
  });
  it("真交接單（即使某些欄位寫「無」）→ 照常取出", () => {
    const real = "🎯 目標：定價策略\n✅ 已決定：不走 FBA\n🔄 進行中：無\n⏭️ 下一步：拍商品照\n❓ 等你拍板：無\n📎 重要資料：無";
    expect(parseHandoff(wrap(real))).toBe(real);
  });
  it("先示範範本、後面才是真交接 → 取真交接", () => {
    const real = "🎯 目標：定價\n⏭️ 下一步：拍照";
    expect(parseHandoff(wrap(TEMPLATE) + "\n" + wrap(real))).toBe(real);
  });
});
