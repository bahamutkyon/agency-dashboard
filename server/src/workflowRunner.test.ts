/**
 * 單元測試：workflowRunner.ts 核心純函式 + 韌性行為
 *
 * 覆蓋範圍：
 *   - validateGraph  — cycle 偵測、missing dep、duplicate id、happy paths
 *   - normalizeSteps — id 自動補齊、dependsOn 自動填補
 *   - ancestorsOf    — 線性、菱形、單節點、不存在 id
 *   - descendantsOf  — 線性、菱形、單節點、葉節點
 *   - depsReady      — all / any mode、空 deps
 *   - isRetryableError     — 逾時/cancelled 不重試
 *   - WorkflowStep.timeoutMs — per-step 逾時覆寫
 *   - reconcileWorkflowRunsOnBoot — paused → 保持 paused（不被誤標 error）
 *   - fail-fast abort — step 失敗時 abort 在途兄弟步驟
 *   - per-step timeoutMs — step.timeoutMs 生效
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Workflow, WorkflowStep } from "./store.js";
import {
  validateGraph,
  normalizeSteps,
  ancestorsOf,
  descendantsOf,
  depsReady,
  workflowRunner,
  reconcileWorkflowRunsOnBoot,
  isRetryableError,
} from "./workflowRunner.js";
import {
  upsertWorkflow,
  createRun,
  getRun,
  updateRun,
} from "./store/workflows.js";

// ---------------------------------------------------------------------------
// 輔助工廠：建立最小化的 WorkflowStep（不依賴 DB / agentManager）
// ---------------------------------------------------------------------------
function step(
  id: string,
  dependsOn: string[] = [],
  extra: Partial<WorkflowStep> = {},
): WorkflowStep {
  return {
    id,
    agentId: "agent-stub",
    prompt: "test prompt",
    dependsOn,
    ...extra,
  };
}

// ===========================================================================
// validateGraph
// ===========================================================================
describe("validateGraph", () => {
  it("空陣列 → valid (回傳 null)", () => {
    expect(validateGraph([])).toBeNull();
  });

  it("單一節點、無 dep → valid", () => {
    expect(validateGraph([step("a", [])])).toBeNull();
  });

  it("線性 a→b→c → valid", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(validateGraph(steps)).toBeNull();
  });

  it("菱形 a→{b,c}→d → valid", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    expect(validateGraph(steps)).toBeNull();
  });

  it("樹（fan-out）a→b, a→c, b→d → valid", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b"]),
    ];
    expect(validateGraph(steps)).toBeNull();
  });

  it("自我依賴 a→a → 偵測到 cycle", () => {
    const err = validateGraph([step("a", ["a"])]);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("簡單雙節點 cycle a→b, b→a → 偵測到", () => {
    const steps = [step("a", ["b"]), step("b", ["a"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("三節點 cycle a→b→c→a → 偵測到", () => {
    const steps = [step("a", ["c"]), step("b", ["a"]), step("c", ["b"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    expect(err).toMatch(/cycle|循環/i);
  });

  it("不存在的 dep → 回傳錯誤訊息", () => {
    const steps = [step("a", []), step("b", ["x"])];
    const err = validateGraph(steps);
    expect(err).not.toBeNull();
    // 訊息應提示找不到 "x"
    expect(err).toContain("x");
  });

  it("dep 指向自身且是唯一節點 → 偵測到（missing dep 或 cycle 均可）", () => {
    // 此時 "a" depends on "z" which doesn't exist
    const err = validateGraph([step("a", ["z"])]);
    expect(err).not.toBeNull();
  });

  it("兩個步驟都依賴不存在的 dep → 回傳錯誤", () => {
    const steps = [step("a", ["ghost"]), step("b", [])];
    expect(validateGraph(steps)).not.toBeNull();
  });
});

// ===========================================================================
// normalizeSteps
// ===========================================================================
describe("normalizeSteps", () => {
  it("空陣列 → 回傳空陣列", () => {
    expect(normalizeSteps([])).toEqual([]);
  });

  it("有 id 的步驟保留原 id", () => {
    const result = normalizeSteps([step("myId", [])]);
    expect(result[0].id).toBe("myId");
  });

  it("無 id 步驟補齊 step_N（1-based）", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1" },
      { agentId: "a", prompt: "p2" },
      { agentId: "a", prompt: "p3" },
    ];
    const result = normalizeSteps(raw);
    expect(result[0].id).toBe("step_1");
    expect(result[1].id).toBe("step_2");
    expect(result[2].id).toBe("step_3");
  });

  it("第一個步驟（無 dependsOn）→ dependsOn 設為 []", () => {
    const raw: WorkflowStep[] = [{ agentId: "a", prompt: "p" }];
    const result = normalizeSteps(raw);
    expect(result[0].dependsOn).toEqual([]);
  });

  it("中間步驟（無 dependsOn）→ 自動依賴前一步", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1" },
      { agentId: "a", prompt: "p2" },
    ];
    const result = normalizeSteps(raw);
    // step_2 應自動依賴 step_1
    expect(result[1].dependsOn).toEqual(["step_1"]);
  });

  it("明確 dependsOn 保留不覆蓋", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1", id: "x" },
      { agentId: "a", prompt: "p2", dependsOn: [] },
    ];
    const result = normalizeSteps(raw);
    expect(result[1].dependsOn).toEqual([]);
  });

  it("混合：有 id 和無 id 的步驟同時出現", () => {
    const raw: WorkflowStep[] = [
      { agentId: "a", prompt: "p1", id: "named" },
      { agentId: "a", prompt: "p2" },
    ];
    const result = normalizeSteps(raw);
    expect(result[0].id).toBe("named");
    expect(result[1].id).toBe("step_2");
    // step_2 無 dependsOn → 自動依賴前一步 "named"
    expect(result[1].dependsOn).toEqual(["named"]);
  });

  it("不改變原陣列（immutable）", () => {
    const raw: WorkflowStep[] = [{ agentId: "a", prompt: "p" }];
    normalizeSteps(raw);
    expect(raw[0].id).toBeUndefined();
  });
});

// ===========================================================================
// ancestorsOf
// ===========================================================================
describe("ancestorsOf", () => {
  it("單節點、無 deps → ancestors 為空 Set", () => {
    const steps = [step("a", [])];
    expect(ancestorsOf("a", steps).size).toBe(0);
  });

  it("線性 a→b→c, ancestorsOf(c) = {a, b}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    const anc = ancestorsOf("c", steps);
    expect(anc).toEqual(new Set(["a", "b"]));
  });

  it("線性 a→b→c, ancestorsOf(b) = {a}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(ancestorsOf("b", steps)).toEqual(new Set(["a"]));
  });

  it("菱形 a→{b,c}→d, ancestorsOf(d) = {a, b, c}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    const anc = ancestorsOf("d", steps);
    expect(anc).toEqual(new Set(["a", "b", "c"]));
  });

  it("根節點 a (無 dep), ancestorsOf(a) = {}", () => {
    const steps = [step("a", []), step("b", ["a"])];
    expect(ancestorsOf("a", steps).size).toBe(0);
  });

  it("不存在的 id → 回傳空 Set（不 throw）", () => {
    const steps = [step("a", [])];
    expect(ancestorsOf("ghost", steps).size).toBe(0);
  });

  it("多層深度：a→b→c→d, ancestorsOf(d) = {a,b,c}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["b"]),
      step("d", ["c"]),
    ];
    expect(ancestorsOf("d", steps)).toEqual(new Set(["a", "b", "c"]));
  });
});

// ===========================================================================
// descendantsOf
// ===========================================================================
describe("descendantsOf", () => {
  it("葉節點（無子節點）→ descendants 為空 Set", () => {
    const steps = [step("a", []), step("b", ["a"])];
    expect(descendantsOf("b", steps).size).toBe(0);
  });

  it("線性 a→b→c, descendantsOf(a) = {b, c}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c"]));
  });

  it("線性 a→b→c, descendantsOf(b) = {c}", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["b"])];
    expect(descendantsOf("b", steps)).toEqual(new Set(["c"]));
  });

  it("菱形 a→{b,c}→d, descendantsOf(a) = {b, c, d}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["b", "c"]),
    ];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c", "d"]));
  });

  it("單節點，descendantsOf(a) = {}", () => {
    const steps = [step("a", [])];
    expect(descendantsOf("a", steps).size).toBe(0);
  });

  it("不存在的 id → 回傳空 Set（不 throw）", () => {
    const steps = [step("a", [])];
    expect(descendantsOf("ghost", steps).size).toBe(0);
  });

  it("fan-out：a→{b,c,d}, descendantsOf(a) = {b,c,d}", () => {
    const steps = [
      step("a", []),
      step("b", ["a"]),
      step("c", ["a"]),
      step("d", ["a"]),
    ];
    expect(descendantsOf("a", steps)).toEqual(new Set(["b", "c", "d"]));
  });
});

// ===========================================================================
// depsReady
// ===========================================================================
describe("depsReady", () => {
  it("無 deps → 永遠 ready", () => {
    const s = step("a", []);
    expect(depsReady(s, new Set())).toBe(true);
  });

  it("mode=all, 所有 deps 完成 → ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set(["a", "b"]))).toBe(true);
  });

  it("mode=all, 只完成部分 deps → not ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set(["a"]))).toBe(false);
  });

  it("mode=all, 沒有 dep 完成 → not ready", () => {
    const s = step("c", ["a", "b"]);
    expect(depsReady(s, new Set())).toBe(false);
  });

  it("mode=any, 任意一個 dep 完成 → ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set(["a"]))).toBe(true);
  });

  it("mode=any, 所有 deps 都未完成 → not ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set())).toBe(false);
  });

  it("mode=any, 所有 deps 都完成 → ready", () => {
    const s: WorkflowStep = { ...step("c", ["a", "b"]), dependsOnMode: "any" };
    expect(depsReady(s, new Set(["a", "b"]))).toBe(true);
  });

  it("dependsOn undefined（沒有 key）→ 視為無 deps，ready", () => {
    const s: WorkflowStep = { id: "a", agentId: "x", prompt: "p" };
    expect(depsReady(s, new Set())).toBe(true);
  });
});

// ===========================================================================
// isRetryableError — 問題 2：逾時不重試
// ===========================================================================
describe("isRetryableError", () => {
  it("step timeout → 不可重試（返回 false）", () => {
    expect(isRetryableError(new Error("step timeout"))).toBe(false);
  });

  it("cancelled → 不可重試（返回 false）", () => {
    expect(isRetryableError(new Error("cancelled"))).toBe(false);
  });

  it("spawn 類錯誤 → 可重試（返回 true）", () => {
    expect(isRetryableError(new Error("spawn error: ENOENT"))).toBe(true);
  });

  it("網路/一般錯誤 → 可重試（返回 true）", () => {
    expect(isRetryableError(new Error("connection refused"))).toBe(true);
  });
});

// ===========================================================================
// WorkflowStep.timeoutMs — 問題 2：per-step 逾時覆寫型別存在
// ===========================================================================
describe("WorkflowStep.timeoutMs 型別", () => {
  it("WorkflowStep 包含選填 timeoutMs 欄位", () => {
    const s: WorkflowStep = {
      id: "test",
      agentId: "agent",
      prompt: "test",
      timeoutMs: 60_000,
    };
    expect(s.timeoutMs).toBe(60_000);
  });

  it("不設 timeoutMs → undefined（不影響既有步驟）", () => {
    const s: WorkflowStep = { id: "test", agentId: "agent", prompt: "test" };
    expect(s.timeoutMs).toBeUndefined();
  });
});

// ===========================================================================
// reconcileWorkflowRunsOnBoot — 問題 3：paused 不被誤標 error
// ===========================================================================

function makeTestWorkflow(id: string): Workflow {
  return {
    id,
    workspaceId: "ws-reconcile-test",
    name: `Test ${id}`,
    description: "",
    steps: [{ id: "s1", agentId: "agent", prompt: "test", dependsOn: [] }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("reconcileWorkflowRunsOnBoot", () => {
  it("running 狀態 → 被標為 error 並帶有 restart 訊息", () => {
    const wf = makeTestWorkflow(`wf-r-run-${Date.now()}`);
    upsertWorkflow(wf);
    const run = createRun(wf.id, "ws-reconcile-test");
    // createRun 預設 status='running'

    reconcileWorkflowRunsOnBoot();

    const after = getRun(run.id)!;
    expect(after.status).toBe("error");
    expect(after.error).toMatch(/restart/i);
    expect(after.endedAt).toBeGreaterThan(0);
  });

  it("paused 狀態 → 保持 paused（不被改成 error）", () => {
    const wf = makeTestWorkflow(`wf-r-paused-${Date.now()}`);
    upsertWorkflow(wf);
    const run = createRun(wf.id, "ws-reconcile-test");
    updateRun(run.id, { status: "paused" });

    reconcileWorkflowRunsOnBoot();

    const after = getRun(run.id)!;
    expect(after.status).toBe("paused");
  });

  it("paused run 的 stepOutputs 在 reconcile 後仍完整保留", () => {
    const wf = makeTestWorkflow(`wf-r-outputs-${Date.now()}`);
    upsertWorkflow(wf);
    const run = createRun(wf.id, "ws-reconcile-test");
    updateRun(run.id, { status: "paused", stepOutputs: { s1: "重要中間結果" } });

    reconcileWorkflowRunsOnBoot();

    const after = getRun(run.id)!;
    expect(after.stepOutputs).toMatchObject({ s1: "重要中間結果" });
  });

  it("回傳值只計算 running→error 的數量，不含 paused", () => {
    const wf = makeTestWorkflow(`wf-r-count-${Date.now()}`);
    upsertWorkflow(wf);

    // 先測量現有 running 數
    const before = reconcileWorkflowRunsOnBoot(); // drain prior state

    const r1 = createRun(wf.id, "ws-reconcile-test"); // running
    const r2 = createRun(wf.id, "ws-reconcile-test"); // running
    const p1 = createRun(wf.id, "ws-reconcile-test");
    updateRun(p1.id, { status: "paused" });

    const count = reconcileWorkflowRunsOnBoot();

    // p1 應保持 paused
    expect(getRun(p1.id)!.status).toBe("paused");
    // r1, r2 應被標為 error
    expect(getRun(r1.id)!.status).toBe("error");
    expect(getRun(r2.id)!.status).toBe("error");
    // count 只計 running 的（至少 2）
    expect(count).toBeGreaterThanOrEqual(2);
    // 不計 paused — count 比 3 少（少了 paused 那個）
    // 若環境乾淨，count 剛好 = 2
  });
});

// ===========================================================================
// 整合測試：fail-fast abort（問題 1）+ per-step timeoutMs（問題 2）
// 使用 _testStepRunner 注入假執行邏輯，繞過 agentManager 依賴。
// ===========================================================================

async function waitForRunStatus(
  runId: string,
  expectedStatus: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = getRun(runId);
    if (r?.status === expectedStatus) return;
    await new Promise((res) => setTimeout(res, 30));
  }
  const r = getRun(runId);
  throw new Error(
    `Run ${runId} 超過 ${timeoutMs}ms 仍未達到 '${expectedStatus}'（目前：${r?.status}）`,
  );
}

describe("fail-fast abort：step 失敗時 abort 在途兄弟步驟（問題 1）", () => {
  afterEach(() => {
    (workflowRunner as any)._testStepRunner = undefined;
  });

  it("step_a 拋錯 → step_b 的 AbortSignal 變成 aborted", async () => {
    const wf: Workflow = {
      id: `wf-ff-${Date.now()}`,
      workspaceId: "ws-ff-test",
      name: "fail-fast test",
      description: "",
      steps: [
        { id: "step_a", agentId: "agent", prompt: "A", dependsOn: [] },
        { id: "step_b", agentId: "agent", prompt: "B", dependsOn: [] },
      ],
      maxConcurrency: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertWorkflow(wf);

    let stepBSignal: AbortSignal | undefined;

    (workflowRunner as any)._testStepRunner = async (
      s: WorkflowStep,
      _prompt: string,
      sig: AbortSignal,
    ): Promise<string> => {
      if (s.id === "step_a") {
        throw new Error("step A intentionally failed");
      }
      // step_b: 捕捉 signal 並等待 abort
      stepBSignal = sig;
      return new Promise<string>((resolve) => {
        sig.addEventListener("abort", () => resolve("step_b_aborted"));
      });
    };

    const run = await workflowRunner.run({ workflowId: wf.id });
    await waitForRunStatus(run.id, "error");

    expect(stepBSignal?.aborted).toBe(true);
  }, 8000);

  it("step 失敗後 run.status = error，error 欄位包含失敗訊息", async () => {
    const wf: Workflow = {
      id: `wf-ff2-${Date.now()}`,
      workspaceId: "ws-ff-test",
      name: "fail-fast single",
      description: "",
      steps: [{ id: "step_a", agentId: "agent", prompt: "A", dependsOn: [] }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertWorkflow(wf);

    (workflowRunner as any)._testStepRunner = async (): Promise<string> => {
      throw new Error("simulated runtime failure");
    };

    const run = await workflowRunner.run({ workflowId: wf.id });
    await waitForRunStatus(run.id, "error");

    const final = getRun(run.id)!;
    expect(final.status).toBe("error");
    expect(final.error).toContain("simulated runtime failure");
  }, 5000);
});

// ===========================================================================
// approve() DB-resume：重啟後孤兒 paused run 可被救回（必修回歸）
// ===========================================================================
describe("approve() DB-resume：this.paused 無該 run → 走 DB resume（模擬重啟）", () => {
  afterEach(() => {
    (workflowRunner as any)._testStepRunner = undefined;
  });

  it("this.paused 沒有該 run → approve 走 DB resume，回傳 newRunId（不再 no-op）", async () => {
    const wf: Workflow = {
      id: `wf-db-resume-${Date.now()}`,
      workspaceId: "ws-db-resume-test",
      name: "db-resume test",
      description: "",
      steps: [
        { id: "step_1", agentId: "agent", prompt: "step 1", dependsOn: [] },
        { id: "step_2", agentId: "agent", prompt: "step 2", dependsOn: ["step_1"], pauseBefore: true },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertWorkflow(wf);

    // 手動在 DB 建立 paused run（模擬重啟後孤兒狀態：step_1 已完成，step_2 paused）
    const orphanRun = createRun(wf.id, "ws-db-resume-test");
    updateRun(orphanRun.id, {
      status: "paused",
      currentStep: 1,
      stepOutputs: { step_1: "step1-output" },
      sessionIds: ["", ""],
    });

    // 確認 this.paused 中沒有這個 run（模擬重啟後 Map 已清空）
    expect((workflowRunner as any).paused.has(orphanRun.id)).toBe(false);

    // 注入假執行器（不依賴 agentManager）
    (workflowRunner as any)._testStepRunner = async (): Promise<string> => "ok";

    // 呼叫 approve → 應走 DB-resume 路徑
    const result = await workflowRunner.approve(orphanRun.id);

    // 必須回傳 newRunId（非 no-op）
    expect(result.newRunId).toBeDefined();
    expect(typeof result.newRunId).toBe("string");

    // 新 run 應存在於 DB
    const newRunInDb = getRun(result.newRunId!);
    expect(newRunInDb).not.toBeNull();
    expect(newRunInDb?.workflowId).toBe(wf.id);

    // 原本的孤兒 run 仍保持 paused（DB-resume 不修改它）
    const orphanAfter = getRun(orphanRun.id)!;
    expect(orphanAfter.status).toBe("paused");
  }, 5000);

  it("this.paused 沒有該 run，但 DB 狀態不是 paused → 回傳空物件（不啟 resume）", async () => {
    const wf: Workflow = {
      id: `wf-db-noop-${Date.now()}`,
      workspaceId: "ws-db-resume-test",
      name: "db-noop test",
      description: "",
      steps: [{ id: "step_1", agentId: "agent", prompt: "step 1", dependsOn: [] }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertWorkflow(wf);
    const doneRun = createRun(wf.id, "ws-db-resume-test");
    updateRun(doneRun.id, { status: "done", endedAt: Date.now() });

    const result = await workflowRunner.approve(doneRun.id);
    expect(result.newRunId).toBeUndefined();
  }, 3000);
});

describe("per-step timeoutMs：step.timeoutMs 生效（問題 2）", () => {
  afterEach(() => {
    (workflowRunner as any)._testStepRunner = undefined;
  });

  it("step.timeoutMs=100 → 永不回應的 step 在 100ms 後逾時，run → error", async () => {
    const wf: Workflow = {
      id: `wf-tm-${Date.now()}`,
      workspaceId: "ws-tm-test",
      name: "timeout test",
      description: "",
      steps: [
        {
          id: "step_slow",
          agentId: "agent",
          prompt: "slow",
          dependsOn: [],
          timeoutMs: 100,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertWorkflow(wf);

    (workflowRunner as any)._testStepRunner = (_s: WorkflowStep, _p: string, sig: AbortSignal): Promise<string> => {
      // 永不回應；等 abort 才 resolve（避免 promise leak）
      return new Promise<string>((resolve) => {
        sig.addEventListener("abort", () => resolve("abort_cleanup"));
      });
    };

    const run = await workflowRunner.run({ workflowId: wf.id });
    await waitForRunStatus(run.id, "error", 5000);

    const final = getRun(run.id)!;
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/timeout/i);
  }, 10000);
});
