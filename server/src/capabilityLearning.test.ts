import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
  executeLearningRun, createLearningRun, getLearningRun, resumeUnfinishedRuns,
  type LearningRun, type LearnTarget,
} from "./capabilityLearning.js";
import { db } from "./db.js";
import {
  getCategoryMemory, getCraftMemory, getProposal, setProposalStatus,
  appendCraftMemory, appendCategoryMemory,
  setCategoryMemory, setCraftMemory,
  listPendingProposals,
  createProposal,
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

// ============ setCategoryMemory / setCraftMemory 直接覆蓋測試 ============

describe("setCategoryMemory 直接覆蓋", () => {
  const CAT_SET = "test-set-category";
  afterAll(() => {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT_SET);
  });

  it("新增：寫入後 getCategoryMemory 回傳相同內容", () => {
    setCategoryMemory(CAT_SET, "初始內容");
    expect(getCategoryMemory(CAT_SET)).toBe("初始內容");
  });

  it("覆蓋：再次呼叫會完全取代舊內容", () => {
    setCategoryMemory(CAT_SET, "初始內容");
    setCategoryMemory(CAT_SET, "更新後的內容");
    expect(getCategoryMemory(CAT_SET)).toBe("更新後的內容");
  });

  it("清除：傳入空字串後 getCategoryMemory 回傳空字串", () => {
    setCategoryMemory(CAT_SET, "有內容");
    setCategoryMemory(CAT_SET, "");
    expect(getCategoryMemory(CAT_SET)).toBe("");
  });

  it("不影響其他類別的記憶", () => {
    const OTHER = "test-set-other-cat";
    try {
      appendCategoryMemory(OTHER, "別的類別條目");
      setCategoryMemory(CAT_SET, "A 改了");
      expect(getCategoryMemory(OTHER)).toContain("別的類別條目");
    } finally {
      db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(OTHER);
    }
  });
});

describe("setCraftMemory 直接覆蓋", () => {
  const AGENT_SET = "test-set-craft-agent";
  afterAll(() => {
    db.prepare("DELETE FROM agent_craft_memory WHERE agent_id = ?").run(AGENT_SET);
  });

  it("新增：寫入後 getCraftMemory 回傳相同內容", () => {
    setCraftMemory(AGENT_SET, "手藝初始");
    expect(getCraftMemory(AGENT_SET)).toBe("手藝初始");
  });

  it("覆蓋：再次呼叫會完全取代舊內容（不是追加）", () => {
    setCraftMemory(AGENT_SET, "手藝初始");
    setCraftMemory(AGENT_SET, "手藝更新");
    const content = getCraftMemory(AGENT_SET);
    expect(content).toBe("手藝更新");
    expect(content).not.toContain("手藝初始");
  });

  it("清除：傳入空字串後 getCraftMemory 回傳空字串", () => {
    setCraftMemory(AGENT_SET, "有手藝");
    setCraftMemory(AGENT_SET, "");
    expect(getCraftMemory(AGENT_SET)).toBe("");
  });
});

// ============ bulk-approve / bulk-reject 邏輯測試 ============

describe("bulk-approve 邏輯（直接呼叫 store 函式模擬）", () => {
  const BULK_CAT = "test-bulk-cat";
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + BULK_CAT);
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(BULK_CAT);
  });

  it("批次批准成功：多個 pending 提案都被 approve、記憶寫入", () => {
    // 分兩次 ingest，確保去重不擋第二次（內容不同）
    ingestLearningOutput(
      "=== LEARN kind=domain ===\n批次測試條目 Alpha（獨特內容 X1）\n=== END LEARN ===",
      { type: "category", id: BULK_CAT },
    );
    ingestLearningOutput(
      "=== LEARN kind=domain ===\n批次測試條目 Beta（獨特內容 X2）\n=== END LEARN ===",
      { type: "category", id: BULK_CAT },
    );
    const rows = db.prepare(
      "SELECT id FROM learning_proposals WHERE agent_id = ? AND status = 'pending'",
    ).all(CATEGORY_PREFIX + BULK_CAT) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    let ok = 0, fail = 0;
    for (const { id } of rows) {
      const p = getProposal(id)!;
      if (!p || p.status !== "pending") { fail++; continue; }
      const catId = parseCategoryAgentId(p.agentId);
      if (!catId) { fail++; continue; }
      if (!setProposalStatus(p.id, "approved")) { fail++; continue; }
      appendCategoryMemory(catId, p.content);
      ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(2);
    expect(fail).toBe(0);
    const mem = getCategoryMemory(BULK_CAT);
    expect(mem).toContain("Alpha");
    expect(mem).toContain("Beta");
  });

  it("已 approved 的提案再次 setProposalStatus → 回傳 false（CAS 保護）", () => {
    ingestLearningOutput(
      "=== LEARN kind=domain ===\nCAS 保護測試\n=== END LEARN ===",
      { type: "category", id: BULK_CAT },
    );
    const row = db.prepare(
      "SELECT id FROM learning_proposals WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    ).get(CATEGORY_PREFIX + BULK_CAT) as any;
    expect(setProposalStatus(row.id, "approved")).toBe(true);  // 第一次成功
    expect(setProposalStatus(row.id, "approved")).toBe(false); // 第二次失敗
    expect(setProposalStatus(row.id, "rejected")).toBe(false); // 改 rejected 也失敗
  });
});

describe("bulk-reject 邏輯", () => {
  const BULK_REJ_AGENT = "test-bulk-reject-agent";
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(BULK_REJ_AGENT);
  });

  it("批次拒絕：pending 提案被 reject，非 pending 的計入 fail", () => {
    // 建立 2 個 pending 提案
    const p1 = createProposal({ agentId: BULK_REJ_AGENT, workspaceId: "ws_default", kind: "craft", scope: "agent-global", content: "拒絕測試 1", source: "test" });
    const p2 = createProposal({ agentId: BULK_REJ_AGENT, workspaceId: "ws_default", kind: "craft", scope: "agent-global", content: "拒絕測試 2", source: "test" });
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();

    // 先 approve p1 讓它離開 pending
    setProposalStatus(p1!.id, "approved");

    let ok = 0, fail = 0;
    for (const id of [p1!.id, p2!.id]) {
      const p = getProposal(id);
      if (p && p.status === "pending" && setProposalStatus(p.id, "rejected")) ok++;
      else fail++;
    }
    expect(ok).toBe(1);  // 只有 p2 是 pending
    expect(fail).toBe(1); // p1 已 approved
  });
});
