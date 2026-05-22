import { describe, it, expect, afterAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
  executeLearningRun, type LearningRun, type LearnTarget,
} from "./capabilityLearning.js";
import { db } from "./db.js";
import {
  getCategoryMemory, getProposal, setProposalStatus, appendCraftMemory, appendCategoryMemory,
  listPendingProposals,
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

describe("executeLearningRun", () => {
  function makeRun(targets: LearnTarget[]): LearningRun {
    return {
      id: "run_test", targets, status: "running",
      total: targets.length, done: 0, current: null,
      failed: [], createdProposals: 0,
    };
  }

  it("全部成功 → status done、done 計數正確、累計提案數", async () => {
    const run = makeRun([
      { type: "category", id: "a" },
      { type: "category", id: "b" },
    ]);
    const progress: number[] = [];
    await executeLearningRun(run, async () => ({ created: 3 }), (r) => progress.push(r.done));
    expect(run.status).toBe("done");
    expect(run.done).toBe(2);
    expect(run.createdProposals).toBe(6);
    expect(progress).toEqual([1, 2]);
  });

  it("單一 target 失敗 → 記入 failed、繼續跑完、status done", async () => {
    const run = makeRun([
      { type: "category", id: "ok" },
      { type: "category", id: "bad" },
    ]);
    await executeLearningRun(
      run,
      async (t) => {
        if (t.id === "bad") throw new Error("壞掉了");
        return { created: 1 };
      },
      () => {},
    );
    expect(run.status).toBe("done");
    expect(run.done).toBe(2);
    expect(run.failed).toHaveLength(1);
    expect(run.failed[0].error).toContain("壞掉了");
  });
});

describe("listPendingProposals 跨工作區可見性", () => {
  const CAT3 = "test-xws-cat";
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + CAT3);
  });

  it("類層提案（scope=category）在非預設工作區也看得到", () => {
    ingestLearningOutput(
      "=== LEARN kind=domain ===\n跨工作區可見性測試\n=== END LEARN ===",
      { type: "category", id: CAT3 },
    );
    // 類層提案存在 default 工作區，但從別的工作區查詢也應該看得到
    const rows = listPendingProposals("ws_some_other_workspace");
    expect(rows.some((p) => p.agentId === CATEGORY_PREFIX + CAT3)).toBe(true);
  });
});
