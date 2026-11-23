import { describe, it, expect } from "vitest";
import { isHandoffIntent, handoffHint } from "./handoffIntent.js";

describe("isHandoffIntent", () => {
  it("認得各種交接說法（含 11/20 實際說法「接續到下個專案經理」）", () => {
    for (const t of ["請整理交接，換到新對話繼續", "幫我接續到下個專案經理", "換到新對話吧", "開新對話繼續", "我們換一個新的對話"]) {
      expect(isHandoffIntent(t), t).toBe(true);
    }
  });
  it("一般訊息不算", () => {
    for (const t of ["售價定 1200", "這個對話好長喔", "幫我寫 IG 文案", "新增對話框元件"]) {
      expect(isHandoffIntent(t), t).toBe(false);
    }
  });
});

describe("handoffHint", () => {
  it("提醒要輸出 HANDOFF 區塊、不要叫使用者自己開新對話", () => {
    const h = handoffHint(false);
    expect(h).toContain("=== HANDOFF ===");
    expect(h).toContain("=== END HANDOFF ===");
    expect(h).toMatch(/不要.*自己開新對話/);
    expect(h).toContain("如果不是要交接");
  });
  it("按鈕版：明確說使用者按了交接鈕、沒有「不是交接就忽略」的退路", () => {
    const h = handoffHint(true);
    expect(h).toContain("交接鈕");
    expect(h).toContain("=== HANDOFF ===");
    expect(h).not.toContain("如果不是要交接");
  });
});
