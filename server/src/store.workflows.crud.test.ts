/**
 * TDD: workflows/workflow_runs CRUD on a fresh :memory: DB.
 *
 * 驗證 BASE_SCHEMA 與 store/workflows.ts 實際讀寫的欄位完全一致。
 * 全新安裝（:memory: DB 只從 BASE_SCHEMA 建表，migration 全 no-op）下
 * 應能完成完整 CRUD 而不噴 "no such column" 錯誤。
 */
import { describe, it, expect } from "vitest";
import {
  listWorkflows,
  getWorkflow,
  upsertWorkflow,
  deleteWorkflow,
  createRun,
  getRun,
  listRuns,
  updateRun,
} from "./store/workflows.js";
import type { Workflow } from "./store/types.js";

const WS_ID = "test-ws-workflow-crud";

function makeWorkflow(id: string): Workflow {
  return {
    id,
    workspaceId: WS_ID,
    name: `Workflow ${id}`,
    description: "test workflow",
    steps: [
      { id: "step_0", agentId: "agent-alpha", prompt: "Do A" },
      { id: "step_1", agentId: "agent-beta", prompt: "Do B after {{step_0.out}}", dependsOn: ["step_0"] },
    ],
    maxConcurrency: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("workflows CRUD on fresh :memory: DB", () => {
  it("upsertWorkflow (INSERT) → getWorkflow round-trip with steps", () => {
    const w = makeWorkflow("wf-test-001");
    upsertWorkflow(w);

    const got = getWorkflow("wf-test-001");
    expect(got).toBeDefined();
    expect(got!.id).toBe("wf-test-001");
    expect(got!.name).toBe("Workflow wf-test-001");
    expect(got!.steps).toHaveLength(2);
    expect(got!.steps[0].agentId).toBe("agent-alpha");
    expect(got!.steps[1].dependsOn).toEqual(["step_0"]);
    expect(got!.maxConcurrency).toBe(2);
  });

  it("listWorkflows 能列出剛插入的 workflow", () => {
    const w = makeWorkflow("wf-test-002");
    upsertWorkflow(w);

    const list = listWorkflows(WS_ID);
    const found = list.find((x) => x.id === "wf-test-002");
    expect(found).toBeDefined();
    expect(found!.steps).toHaveLength(2);
  });

  it("upsertWorkflow (UPDATE) 能更新 steps 與 maxConcurrency", () => {
    const w = makeWorkflow("wf-test-003");
    upsertWorkflow(w);

    const updated: Workflow = {
      ...w,
      steps: [{ id: "step_0", agentId: "agent-gamma", prompt: "Do C" }],
      maxConcurrency: 1,
      updatedAt: Date.now() + 1000,
    };
    upsertWorkflow(updated);

    const got = getWorkflow("wf-test-003");
    expect(got!.steps).toHaveLength(1);
    expect(got!.steps[0].agentId).toBe("agent-gamma");
    expect(got!.maxConcurrency).toBe(1);
  });

  it("createRun → getRun 讀回 current_step / session_ids / step_outputs", () => {
    // 先建 workflow
    const w = makeWorkflow("wf-test-004");
    upsertWorkflow(w);

    const run = createRun("wf-test-004", WS_ID);
    expect(run).toBeDefined();
    expect(run.id).toBeTruthy();
    expect(run.workflowId).toBe("wf-test-004");
    expect(run.status).toBe("running");
    expect(run.currentStep).toBe(0);
    expect(run.sessionIds).toEqual([]);
    expect(run.stepOutputs).toEqual({});
    expect(run.endedAt).toBeUndefined();

    // getRun round-trip
    const fetched = getRun(run.id);
    expect(fetched).toBeDefined();
    expect(fetched!.currentStep).toBe(0);
    expect(fetched!.sessionIds).toEqual([]);
    expect(fetched!.stepOutputs).toEqual({});
  });

  it("updateRun 能更新 current_step / session_ids / step_outputs / ended_at / status", () => {
    const w = makeWorkflow("wf-test-005");
    upsertWorkflow(w);
    const run = createRun("wf-test-005", WS_ID);

    updateRun(run.id, {
      status: "done",
      currentStep: 2,
      sessionIds: ["sess-abc", "sess-def"],
      stepOutputs: { step_0: "output of A", step_1: "output of B" },
      endedAt: Date.now() + 5000,
    });

    const updated = getRun(run.id)!;
    expect(updated.status).toBe("done");
    expect(updated.currentStep).toBe(2);
    expect(updated.sessionIds).toEqual(["sess-abc", "sess-def"]);
    expect(updated.stepOutputs).toMatchObject({ step_0: "output of A", step_1: "output of B" });
    expect(updated.endedAt).toBeGreaterThan(0);
  });

  it("listRuns 能列出 workflow 下所有 run", () => {
    const w = makeWorkflow("wf-test-006");
    upsertWorkflow(w);
    createRun("wf-test-006", WS_ID);
    createRun("wf-test-006", WS_ID);

    const runs = listRuns("wf-test-006");
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it("deleteWorkflow 同時刪除關聯的 runs", () => {
    const w = makeWorkflow("wf-test-007");
    upsertWorkflow(w);
    createRun("wf-test-007", WS_ID);

    deleteWorkflow("wf-test-007");
    expect(getWorkflow("wf-test-007")).toBeUndefined();
    expect(listRuns("wf-test-007")).toHaveLength(0);
  });
});
