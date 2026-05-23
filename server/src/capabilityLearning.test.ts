import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
  executeLearningRun, createLearningRun, getLearningRun, resumeUnfinishedRuns,
  type LearningRun, type LearnTarget,
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

// ============ run 持久化與恢復測試 ============

const TEST_RUN_PREFIX = "lrun_test_";

afterAll(() => {
  db.prepare("DELETE FROM learning_runs WHERE id LIKE ?").run(TEST_RUN_PREFIX + "%");
});

describe("createLearningRun 寫入 DB", () => {
  it("createLearningRun 在 DB 中建立對應紀錄", () => {
    const targets: LearnTarget[] = [
      { type: "category", id: "test-persist-cat" },
      { type: "agent", id: "test-persist-agent" },
    ];
    const run = createLearningRun(targets);
    // 將 id 改成可預測的測試 id 以便 cleanup（直接更新 DB）
    const testId = TEST_RUN_PREFIX + "create";
    db.prepare("UPDATE learning_runs SET id = ? WHERE id = ?").run(testId, run.id);
    (run as any).id = testId;

    const row = db.prepare("SELECT * FROM learning_runs WHERE id = ?").get(testId) as any;
    expect(row).toBeDefined();
    expect(row.status).toBe("running");
    expect(row.total).toBe(2);
    expect(row.done).toBe(0);
    expect(JSON.parse(row.targets)).toEqual(targets);
    expect(JSON.parse(row.failed)).toEqual([]);
  });
});

describe("executeLearningRun 進度持續寫回 DB", () => {
  it("每完成一個 target，DB 的 done 欄位遞增", async () => {
    const targets: LearnTarget[] = [
      { type: "category", id: "db-prog-a" },
      { type: "category", id: "db-prog-b" },
      { type: "category", id: "db-prog-c" },
    ];
    const run = createLearningRun(targets);
    const testId = TEST_RUN_PREFIX + "progress";
    db.prepare("UPDATE learning_runs SET id = ? WHERE id = ?").run(testId, run.id);
    (run as any).id = testId;

    const snapshots: number[] = [];
    await executeLearningRun(run, async () => ({ created: 1 }), (_r) => {
      // 在 onProgress 時讀 DB 確認已寫入
      const row = db.prepare("SELECT done FROM learning_runs WHERE id = ?").get(testId) as any;
      snapshots.push(row?.done ?? -1);
    });

    // DB 在每個 onProgress 後都應已更新
    expect(snapshots).toEqual([1, 2, 3]);
    // 最終 status=done 寫入 DB
    const final = db.prepare("SELECT status, done FROM learning_runs WHERE id = ?").get(testId) as any;
    expect(final.status).toBe("done");
    expect(final.done).toBe(3);
  });
});

describe("getLearningRun 從 DB 重建（斷點續跑入口）", () => {
  it("run 不在 in-memory 時，getLearningRun 從 DB 重建物件", () => {
    const testId = TEST_RUN_PREFIX + "rebuild";
    const targets: LearnTarget[] = [
      { type: "agent", id: "ag1" },
      { type: "agent", id: "ag2" },
      { type: "agent", id: "ag3" },
    ];
    // 直接插一筆 done=2/total=3 的中斷紀錄，模擬 server 重啟前的進度
    db.prepare(`
      INSERT OR REPLACE INTO learning_runs
      (id, targets, status, total, done, current, failed, created_proposals, schedule_id, created_at, updated_at)
      VALUES (?, ?, 'running', 3, 2, 'agent:ag2', '[]', 5, NULL, ?, ?)
    `).run(testId, JSON.stringify(targets), Date.now(), Date.now());

    const rebuilt = getLearningRun(testId);
    expect(rebuilt).toBeDefined();
    expect(rebuilt!.done).toBe(2);
    expect(rebuilt!.total).toBe(3);
    expect(rebuilt!.status).toBe("running");
    expect(rebuilt!.targets).toEqual(targets);
    expect(rebuilt!.createdProposals).toBe(5);
  });

  it("從 done=2 續跑時，executeLearningRun 只處理剩餘的 1 個 target", async () => {
    const testId = TEST_RUN_PREFIX + "resume";
    const targets: LearnTarget[] = [
      { type: "agent", id: "r1" },
      { type: "agent", id: "r2" },
      { type: "agent", id: "r3" },
    ];
    // 插一筆 done=2 的中斷紀錄
    db.prepare(`
      INSERT OR REPLACE INTO learning_runs
      (id, targets, status, total, done, current, failed, created_proposals, schedule_id, created_at, updated_at)
      VALUES (?, ?, 'running', 3, 2, NULL, '[]', 10, NULL, ?, ?)
    `).run(testId, JSON.stringify(targets), Date.now(), Date.now());

    const run = getLearningRun(testId)!;
    expect(run.done).toBe(2);

    const processed: string[] = [];
    await executeLearningRun(
      run,
      async (t) => { processed.push(t.id); return { created: 0 }; },
      () => {},
    );

    // 只有第 3 個（index=2，r3）應被處理
    expect(processed).toEqual(["r3"]);
    expect(run.done).toBe(3);
    expect(run.status).toBe("done");
    // DB 也應是 done
    const row = db.prepare("SELECT status, done FROM learning_runs WHERE id = ?").get(testId) as any;
    expect(row.status).toBe("done");
    expect(row.done).toBe(3);
  });
});
