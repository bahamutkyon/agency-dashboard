/**
 * PM catalog 描述截短測試
 *
 * 驗證：
 * 1. description ≤ CATALOG_DESC_MAX 字時不截斷、不加「…」
 * 2. description > CATALOG_DESC_MAX 字時截到上限並附「…」
 * 3. catalog 格式（id/name/category 保留，行格式不變）
 * 以常數表達（2026-10 從 60 放寬到 100），測試守的是規則而不是某個數字。
 */
import { describe, it, expect } from "vitest";
import { truncateForCatalog, CATALOG_DESC_MAX } from "./routes/sessions.js";

const N = CATALOG_DESC_MAX;

describe("catalog description 截短", () => {
  it("上限至少 100 字（60 字只剩第一句，PM 分不出相近的專家）", () => {
    expect(N).toBeGreaterThanOrEqual(100);
  });

  it("短 description（≤ 上限）不截斷", () => {
    const desc = "這是一段短描述";
    expect(truncateForCatalog(desc)).toBe(desc);
  });

  it("長 description（> 上限）截到上限並加「…」", () => {
    const desc = "A".repeat(N + 40);
    const result = truncateForCatalog(desc);
    expect(result).toBe("A".repeat(N) + "…");
    expect(result.length).toBe(N + 1);
  });

  it("恰好等於上限不截斷", () => {
    const desc = "A".repeat(N);
    expect(truncateForCatalog(desc)).toBe(desc);
    expect(truncateForCatalog(desc)).not.toContain("…");
  });

  it("可傳入自訂上限（向後相容）", () => {
    expect(truncateForCatalog("A".repeat(80), 60)).toBe("A".repeat(60) + "…");
  });

  it("emoji（astral 字元）落在截斷邊界不產生 lone surrogate", () => {
    // N-1 個 A + 一個 🚀（佔 2 個 UTF-16 code unit）+ 補長：String.slice 會切壞 🚀，code point 截斷不會。
    const desc = "A".repeat(N - 1) + "🚀" + "B".repeat(50);
    const result = truncateForCatalog(desc);
    expect(result.includes("�")).toBe(false);
    expect(Buffer.from(result, "utf8").toString("utf8")).toBe(result);
    expect(result.endsWith("…")).toBe(true);
    expect(result).toContain("🚀");
    expect(result).not.toContain("B");
  });

  it("catalog 行格式 [category] `id` — name: desc 結構不變", () => {
    const agent = {
      id: "legal-contract-reviewer",
      category: "legal",
      name: "法律合約審查",
      description: "全面的法律文書審查專家，涵蓋合約、訴訟文件和不動產協議——提供文檔摘要、風險條款標記、合約版本比對和合規檢查，適用於各類律所和業務領域",
    };
    const truncated = truncateForCatalog(agent.description);
    const line = `- [${agent.category}] \`${agent.id}\` — ${agent.name}: ${truncated}`;
    expect(line).toMatch(/^- \[legal\] `legal-contract-reviewer` — 法律合約審查: /);
    // 這段描述在新上限內 → 完整保留（舊 60 字上限會砍掉「適用於各類律所和業務領域」）
    expect(line).toContain("業務領域");
  });
});
