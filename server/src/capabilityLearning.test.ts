import { describe, it, expect, afterAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
} from "./capabilityLearning.js";
import { db } from "./db.js";
import {
  getCategoryMemory, getProposal, setProposalStatus, appendCraftMemory, appendCategoryMemory,
} from "./learningStore.js";

const CAT = "test-ingest-cat";

describe("parseCategoryAgentId", () => {
  it("解析帶前綴的 agentId", () => {
    expect(parseCategoryAgentId(CATEGORY_PREFIX + "marketing")).toBe("marketing");
  });
  it("無前綴回傳 null", () => {
    expect(parseCategoryAgentId("marketing-content-creator")).toBeNull();
  });
});

describe("ingestLearningOutput", () => {
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + CAT);
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + "test-dedup-cat");
  });

  it("解析類層輸出，建立 scope=category 的提案", () => {
    const text = [
      "=== LEARN kind=domain ===",
      "頂尖專家要會量化決策",
      "=== END LEARN ===",
      "=== LEARN kind=domain ===",
      "頂尖專家要持續追蹤產業動態",
      "=== END LEARN ===",
    ].join("\n");
    const created = ingestLearningOutput(text, { type: "category", id: CAT });
    expect(created).toBe(2);
    const rows = db.prepare(
      "SELECT scope, kind FROM learning_proposals WHERE agent_id = ?",
    ).all(CATEGORY_PREFIX + CAT) as any[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scope === "category" && r.kind === "domain")).toBe(true);
  });

  it("沒有標記時回傳 0", () => {
    expect(ingestLearningOutput("普通文字沒有標記", { type: "category", id: CAT })).toBe(0);
  });

  it("同一類別重跑相同內容，第二次因去重回傳 0", () => {
    const text = [
      "=== LEARN kind=domain ===",
      "類層去重測試條目",
      "=== END LEARN ===",
    ].join("\n");
    const target = { type: "category" as const, id: "test-dedup-cat" };
    const first = ingestLearningOutput(text, target);
    const second = ingestLearningOutput(text, target);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

describe("approve 類層提案 → 寫進類記憶", () => {
  const CAT2 = "test-approve-cat";
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + CAT2);
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT2);
  });

  it("scope=category 的提案，依 agent_id 前綴寫進 category memory", () => {
    ingestLearningOutput(
      "=== LEARN kind=domain ===\n批准測試能力\n=== END LEARN ===",
      { type: "category", id: CAT2 },
    );
    const row = db.prepare(
      "SELECT id FROM learning_proposals WHERE agent_id = ? LIMIT 1",
    ).get(CATEGORY_PREFIX + CAT2) as any;
    const p = getProposal(row.id)!;
    // 模擬 approve 路由的副作用分支
    const categoryId = parseCategoryAgentId(p.agentId);
    expect(categoryId).toBe(CAT2);
    appendCategoryMemory(categoryId!, p.content);
    expect(getCategoryMemory(CAT2)).toContain("批准測試能力");
  });
});
