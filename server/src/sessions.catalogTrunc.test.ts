/**
 * PM catalog 描述截短測試
 *
 * 驗證：
 * 1. description ≤ 60 字時不截斷、不加「…」
 * 2. description > 60 字時截到第 60 字並附「…」
 * 3. catalog 格式（id/name/category 保留，行格式不變）
 */
import { describe, it, expect } from "vitest";
import { truncateForCatalog } from "./routes/sessions.js";

describe("catalog description 截短", () => {
  it("短 description（≤ 60 字）不截斷", () => {
    const desc = "這是一段短描述，剛好 60 字以內";
    expect(truncateForCatalog(desc)).toBe(desc);
  });

  it("長 description（> 60 字）截到 60 並加「…」", () => {
    const desc = "A".repeat(100);
    const result = truncateForCatalog(desc);
    expect(result).toBe("A".repeat(60) + "…");
    expect(result.length).toBe(61); // 60 + 1 ellipsis char
  });

  it("恰好 60 字不截斷", () => {
    const desc = "A".repeat(60);
    expect(truncateForCatalog(desc)).toBe(desc);
    expect(truncateForCatalog(desc)).not.toContain("…");
  });

  it("emoji（astral 字元）落在截斷邊界不產生 lone surrogate", () => {
    // 59 個 A + 一個 🚀（emoji 佔 2 個 UTF-16 code unit）+ 補長：
    // 用 String.slice(0, 60) 會把 🚀 切一半變 lone surrogate；code point 截斷不會。
    const desc = "A".repeat(59) + "🚀" + "B".repeat(50);
    const result = truncateForCatalog(desc);
    // well-formed 檢查：可安全 round-trip 成 UTF-8（lone surrogate 會被換成 U+FFFD）
    expect(result.includes("�")).toBe(false);
    expect(Buffer.from(result, "utf8").toString("utf8")).toBe(result);
    // 截斷仍生效且第 60 個 code point（🚀）完整保留
    expect(result.endsWith("…")).toBe(true);
    expect(result).toContain("🚀");
    expect(result).not.toContain("B");
  });

  it("catalog 行格式 [category] `id` — name: desc 結構不變", () => {
    // 模擬 catalog 行的產生；description 必須超過 60 字才會觸發截斷
    const agent = {
      id: "legal-contract-reviewer",
      category: "legal",
      name: "法律合約審查",
      // 確保超過 60 字：前面加足夠長的前綴
      description: "全面的法律文書審查專家，涵蓋合約、訴訟文件和不動產協議——提供文檔摘要、風險條款標記、合約版本比對和合規檢查，適用於各類律所和業務領域",
    };
    // Verify the description is indeed > 60 chars
    expect(agent.description.length).toBeGreaterThan(60);
    const truncated = truncateForCatalog(agent.description);
    const line = `- [${agent.category}] \`${agent.id}\` — ${agent.name}: ${truncated}`;
    expect(line).toMatch(/^- \[legal\] `legal-contract-reviewer` — 法律合約審查: /);
    expect(line).toContain("…");
    // 不包含超過 60 字之後的完整文字（「業務領域」在 60 字後面，第 61 字起為「律所和業務領域」）
    expect(line).not.toContain("業務領域");
  });
});
