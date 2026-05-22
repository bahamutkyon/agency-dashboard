import { describe, it, expect, afterAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
} from "./capabilityLearning.js";
import { db } from "./db.js";

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
});
