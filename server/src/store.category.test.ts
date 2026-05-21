import { describe, it, expect, afterAll } from "vitest";
import { getCategoryMemory, appendCategoryMemory } from "./learningStore.js";
import { db } from "./db.js";

const CAT = "test-cap-cat";

describe("category capability memory", () => {
  afterAll(() => {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT);
  });

  it("未寫入時回傳空字串", () => {
    expect(getCategoryMemory("nonexistent-cat-xyz")).toBe("");
  });

  it("appendCategoryMemory 寫入並可讀回，帶日期前綴", () => {
    appendCategoryMemory(CAT, "頂尖專家要懂得量化決策");
    const m = getCategoryMemory(CAT);
    expect(m).toContain("頂尖專家要懂得量化決策");
    expect(m).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] /);
  });

  it("再次 append 累加成多行（UPSERT 不覆蓋）", () => {
    appendCategoryMemory(CAT, "第二條能力");
    const m = getCategoryMemory(CAT);
    expect(m).toContain("頂尖專家要懂得量化決策");
    expect(m).toContain("第二條能力");
    expect(m.split("\n").length).toBe(2);
  });
});
