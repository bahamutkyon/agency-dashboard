import { describe, it, expect } from "vitest";
import { modelLabel } from "./modelLabel";

describe("modelLabel", () => {
  it("新舊命名都轉成好讀的名稱", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("claude-opus-4-7")).toBe("Opus 4.7");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("claude-opus-5")).toBe("Opus 5");
  });

  it("[1m] 後綴標成 (1M)", () => {
    expect(modelLabel("claude-opus-4-6[1m]")).toBe("Opus 4.6 (1M)");
  });

  it("認不得的 id 原樣回傳；空值回空字串", () => {
    expect(modelLabel("gpt-5")).toBe("gpt-5");
    expect(modelLabel("my-gateway/claude-opus-5-5")).toBe("my-gateway/claude-opus-5-5");
    expect(modelLabel(undefined)).toBe("");
    expect(modelLabel(null)).toBe("");
  });
});
