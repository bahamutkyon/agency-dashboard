import { describe, it, expect } from "vitest";
import { deriveScope, parseLearnMarkers, similarity, isDuplicate } from "./learningCapture.js";

describe("deriveScope", () => {
  it("fact/calibration → workspace", () => {
    expect(deriveScope("fact")).toBe("workspace");
    expect(deriveScope("calibration")).toBe("workspace");
  });
  it("craft/domain → agent-global", () => {
    expect(deriveScope("craft")).toBe("agent-global");
    expect(deriveScope("domain")).toBe("agent-global");
  });
});

describe("parseLearnMarkers", () => {
  it("解析單一 LEARN 標記並推導 scope", () => {
    const text = "回答內容\n\n=== LEARN kind=craft ===\n標題前 8 字放數字\n=== END LEARN ===";
    const out = parseLearnMarkers(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "craft", scope: "agent-global", content: "標題前 8 字放數字" });
  });

  it("REMEMBER 標記視為 kind=fact、scope=workspace", () => {
    const text = "=== REMEMBER ===\n使用者偏好親切口語\n=== END REMEMBER ===";
    const out = parseLearnMarkers(text);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("fact");
    expect(out[0].scope).toBe("workspace");
    expect(out[0].content).toBe("使用者偏好親切口語");
  });

  it("未知 kind 退回 fact", () => {
    const text = "=== LEARN kind=banana ===\n內容\n=== END LEARN ===";
    expect(parseLearnMarkers(text)[0].kind).toBe("fact");
  });

  it("略過空內容與超過 200 字的內容", () => {
    const long = "x".repeat(201);
    const text = `=== LEARN kind=fact ===\n${long}\n=== END LEARN ===`;
    expect(parseLearnMarkers(text)).toHaveLength(0);
  });

  it("最多回傳 5 條", () => {
    const block = (i: number) => `=== LEARN kind=fact ===\n條目${i}\n=== END LEARN ===`;
    const text = [0, 1, 2, 3, 4, 5, 6].map(block).join("\n");
    expect(parseLearnMarkers(text)).toHaveLength(5);
  });

  it("無標記時回傳空陣列", () => {
    expect(parseLearnMarkers("普通回答，沒有標記")).toEqual([]);
  });

  it("正確解析 CRLF 行尾的標記", () => {
    const text = "=== LEARN kind=craft ===\r\n手藝條目\r\n=== END LEARN ===";
    const out = parseLearnMarkers(text);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("手藝條目");
  });

  it("跳過 content 以 === 開頭的擷取（巢狀標記防禦）", () => {
    const text = "=== LEARN kind=fact ===\n=== LEARN kind=craft ===\n真內容\n=== END LEARN ===\n=== END LEARN ===";
    const out = parseLearnMarkers(text);
    expect(out.every((d) => !d.content.startsWith("==="))).toBe(true);
    expect(out.some((d) => d.content === "真內容")).toBe(true);
  });
});

describe("similarity / isDuplicate", () => {
  it("完全相同 → 1", () => {
    expect(similarity("使用者偏好口語", "使用者偏好口語")).toBe(1);
  });
  it("完全不同 → 接近 0", () => {
    expect(similarity("抖音演算法", "報稅流程說明")).toBeLessThan(0.3);
  });
  it("isDuplicate：近似內容視為重複", () => {
    expect(isDuplicate("使用者偏好親切口語", ["使用者偏好親切的口語"])).toBe(true);
  });
  it("isDuplicate：不相關內容不算重複", () => {
    expect(isDuplicate("抖音新演算法上線", ["使用者是仲介業者"])).toBe(false);
  });

  it("isDuplicate：existing 為空陣列時回傳 false", () => {
    expect(isDuplicate("任意內容", [])).toBe(false);
  });
});
