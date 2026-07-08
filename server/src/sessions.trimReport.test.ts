/**
 * trimReportKeepSelfCheck 測試（R4）
 *
 * 驗證 EXEC_REPORT 截斷但保留【完成自驗】：
 * 1. 短文（≤ limit）原樣回。
 * 2. 長文含【完成自驗】段 → 頭部截斷 + 中略 + 從最後一個自驗段起最多 2000 字。
 * 3. 長文無自驗段 → 退回頭部截斷 + 導流提示。
 */
import { describe, it, expect } from "vitest";
import { trimReportKeepSelfCheck } from "./routes/sessions.js";

describe("trimReportKeepSelfCheck", () => {
  it("短文（≤ limit）原樣回，不加任何提示", () => {
    const text = "短短的回報內容\n【完成自驗】做了什麼";
    expect(trimReportKeepSelfCheck(text, 6000)).toBe(text);
  });

  it("長文含【完成自驗】段 → 保留頭部與尾端自驗段", () => {
    const head = "H".repeat(8000);
    const selfCheck = "【完成自驗】做了 A；驗證 B；證據 C；結論：已驗證完成。";
    const text = head + "\n" + selfCheck;
    const out = trimReportKeepSelfCheck(text, 6000);
    // 比原文短（有截斷）
    expect(out.length).toBeLessThan(text.length);
    // 頭部保留（limit-2200 = 3800 字）
    expect(out.startsWith("H".repeat(3800))).toBe(true);
    // 中略提示
    expect(out).toContain("（中略，完整見子對話）");
    // 自驗段完整保留
    expect(out).toContain(selfCheck);
  });

  it("多個【完成自驗】→ 保留最後一個", () => {
    const text =
      "【完成自驗】舊的自驗（草稿）" + "X".repeat(8000) +
      "\n【完成自驗】最後這個才是真的，結論：已驗證完成。";
    const out = trimReportKeepSelfCheck(text, 6000);
    expect(out).toContain("最後這個才是真的");
  });

  it("自驗段超過 2000 字 → 截到 2000 字", () => {
    const head = "H".repeat(8000);
    const selfCheck = "【完成自驗】" + "S".repeat(5000);
    const out = trimReportKeepSelfCheck(head + "\n" + selfCheck, 6000);
    // 自驗段被截到 2000 字（含 marker 本身）
    const tail = out.slice(out.indexOf("【完成自驗】"));
    expect(tail.length).toBe(2000);
  });

  it("長文無【完成自驗】段 → 退回頭部截斷 + 導流提示", () => {
    const text = "N".repeat(9000);
    const out = trimReportKeepSelfCheck(text, 6000);
    expect(out.startsWith("N".repeat(3800))).toBe(true);
    expect(out).toContain("完整回覆見該同事的子對話");
    expect(out).not.toContain("中略");
  });
});
