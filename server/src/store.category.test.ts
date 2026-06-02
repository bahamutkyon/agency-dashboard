import { describe, it, expect, afterAll } from "vitest";
import { getCategoryMemoryFor, appendCategoryMemory } from "./learningStore.js";
import { db } from "./db.js";

const CAT = "test-cap-cat";

describe("category capability memory (v2: scope-aware)", () => {
  afterAll(() => {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT);
  });

  it("未寫入時回傳空 bundle", () => {
    const b = getCategoryMemoryFor("nonexistent-cat-xyz", "any-ws");
    expect(b.global).toBe("");
    expect(b.workspace).toBe("");
    expect(b.legacyGlobal).toBe("");
  });

  it("appendCategoryMemory scope='global' 寫入並可讀回，帶日期前綴", () => {
    appendCategoryMemory(CAT, "頂尖專家要懂得量化決策", "global");
    const b = getCategoryMemoryFor(CAT, "any-ws");
    expect(b.global).toContain("頂尖專家要懂得量化決策");
    expect(b.global).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] /);
  });

  it("再次 append 累加成多行（UPSERT 不覆蓋）", () => {
    appendCategoryMemory(CAT, "第二條能力", "global");
    const b = getCategoryMemoryFor(CAT, "any-ws");
    expect(b.global).toContain("頂尖專家要懂得量化決策");
    expect(b.global).toContain("第二條能力");
    expect(b.global.split("\n").length).toBe(2);
  });
});
