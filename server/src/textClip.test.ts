import { describe, it, expect } from "vitest";
import { clipMiddle, clipKeepTail } from "./textClip.js";

describe("clipMiddle", () => {
  it("未超過上限原樣回", () => {
    expect(clipMiddle("abc", 3)).toBe("abc");
    expect(clipMiddle("", 10)).toBe("");
  });

  it("保留開頭 30% 與結尾 70%，並標示省略字數", () => {
    const text = "A".repeat(50) + "M".repeat(100) + "Z".repeat(50);
    const out = clipMiddle(text, 100);
    expect(out.startsWith("A".repeat(30))).toBe(true);
    expect(out.endsWith("Z".repeat(50))).toBe(true);
    expect(out).toContain("中間省略 100 字");
    // 結尾 70 字 = 20 個 M + 50 個 Z
    expect(out).toContain("M".repeat(20) + "Z".repeat(50));
  });

  it("headRatio 可調（0.5 = 頭尾各半）", () => {
    const out = clipMiddle("x".repeat(10) + "y".repeat(10), 10, 0.5);
    expect(out.startsWith("xxxxx")).toBe(true);
    expect(out.endsWith("yyyyy")).toBe(true);
  });

  it("以 code point 計算，不把 emoji 切成 lone surrogate", () => {
    const text = "😀".repeat(20);
    const out = clipMiddle(text, 10);
    // 不得出現孤立的 surrogate
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    expect([...out.replace(/\n\n…（[^）]*）…\n\n/, "")].length).toBe(10);
  });
});

describe("clipKeepTail", () => {
  it("未超過上限原樣回", () => {
    expect(clipKeepTail("hello", 5)).toBe("hello");
  });

  it("只保留最新的部分，並標示省略字數", () => {
    const out = clipKeepTail("old-old-old|NEW", 4);
    expect(out.endsWith("|NEW")).toBe(true);
    expect(out).toContain("較早的 11 字已省略");
    expect(out).not.toContain("old-old");
  });

  it("中文以字計", () => {
    const out = clipKeepTail("一二三四五六", 2);
    expect(out.endsWith("五六")).toBe(true);
    expect(out).toContain("較早的 4 字已省略");
  });
});
