import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import { app } from "./index.js";
import { deleteWorkspace, deleteSession, upsertSession, getSession, DEFAULT_WORKSPACE_ID, createRun, getRun, updateRun, deleteWorkflow } from "./store.js";
import { createPendingAction, getPendingAction } from "./store/autonomy.js";
import { reconcileWorkflowRunsOnBoot } from "./workflowRunner.js";
import { GUARD_TOKEN, setShellwardClient } from "./guard.js";

// HTTP 端點 smoke 測試：用 ephemeral 埠（listen(0)）起一個臨時 server 打真實路由，
// 不撞正在跑的 dev server、不需新依賴。會寫 DB 的測試（建工作區/session）在 afterAll
// 清掉，沿用既有 store 測試慣例。

let server: Server;
let base: string;
const createdWorkspaceIds: string[] = [];
const createdSessionIds: string[] = [];
const createdWorkflowIds: string[] = [];

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const id of createdWorkspaceIds) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
  for (const id of createdSessionIds) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  for (const id of createdWorkflowIds) {
    try { deleteWorkflow(id); } catch { /* ignore */ }
  }
  server?.close();
});

describe("HTTP 端點 smoke", () => {
  it("GET /api/health → 200 {ok:true}", async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("GET /api/agents → 200 且 agents 非空", async () => {
    const r = await fetch(`${base}/api/agents`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { agents: unknown[] };
    expect(Array.isArray(j.agents)).toBe(true);
    expect(j.agents.length).toBeGreaterThan(0);
  });

  it("POST /api/orchestrator/:id/dispatch 不存在的 session → 404", async () => {
    const r = await fetch(`${base}/api/orchestrator/__nonexistent__/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ agentId: "x", mode: "consult", task: "t" }] }),
    });
    expect(r.status).toBe(404);
  });

  it("POST /api/orchestrator/:id/dispatch items 空 → 400", async () => {
    // 直接用 store 建一個 PM session（不 spawn claude、不依賴正式資料），再用空 items 打驗證早退。
    const sid = `test_pm_${Date.now()}`;
    upsertSession({
      id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator",
      title: "test PM", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [],
    });
    createdSessionIds.push(sid);
    const r = await fetch(`${base}/api/orchestrator/${sid}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(r.status).toBe(400);
  });

  it("workspaces CRUD：POST 建立 → GET 列表含它 → DELETE 成功", async () => {
    const created = (await (await fetch(`${base}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "__test_ws_endpoint__" }),
    })).json()) as { id: string };
    expect(created.id).toBeTruthy();
    createdWorkspaceIds.push(created.id);

    const list = (await (await fetch(`${base}/api/workspaces`)).json()) as { id: string }[];
    expect(list.some((w) => w.id === created.id)).toBe(true);

    const del = await fetch(`${base}/api/workspaces/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("GET /api/learning/study/tiers 回 hot/cold/dormant", async () => {
    const r = await fetch(`${base}/api/learning/study/tiers`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toHaveProperty("hot"); expect(j).toHaveProperty("cold"); expect(j).toHaveProperty("dormant");
    expect(j).toHaveProperty("excluded");
  });

  it("POST /api/learning/study/override 設定 hot 回 ok", async () => {
    const r = await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "marketing-content-creator", override: "hot" }),
    });
    expect(r.status).toBe(200);
    // 清除避免污染後續測試的分層
    await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "marketing-content-creator", override: null }),
    });
  });

  it("POST /api/learning/study/override 非法 override 回 400", async () => {
    const r = await fetch(`${base}/api/learning/study/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "x", override: "bogus" }),
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/learning/study/schedules 回 hot/cold 兩列", async () => {
    const j = (await (await fetch(`${base}/api/learning/study/schedules`)).json()) as any[];
    expect(j.map((s: any) => s.tier).sort()).toEqual(["cold", "hot"]);
  });

  it("PATCH /api/workspaces/:id workingDir 設成 dashboard 自身 → 400", async () => {
    const ws = (await (await fetch(`${base}/api/workspaces`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "wd guard" }),
    })).json()) as { id: string };
    createdWorkspaceIds.push(ws.id);
    const r = await fetch(`${base}/api/workspaces/${ws.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workingDir: process.cwd() }),
    });
    expect(r.status).toBe(400);
  });

  it("PATCH /api/workspaces/:id workingDir 設成外部合法路徑 → 200", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const ws = (await (await fetch(`${base}/api/workspaces`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "wd ok" }),
    })).json()) as { id: string };
    createdWorkspaceIds.push(ws.id);
    const r = await fetch(`${base}/api/workspaces/${ws.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workingDir: path.join(os.tmpdir(), "wd_ok_proj") }),
    });
    expect(r.status).toBe(200);
  });

  it("POST /api/autonomy/runs 非 claude session → 400", async () => {
    const sid = `test_codex_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "x", title: "t", provider: "codex", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    createdSessionIds.push(sid);
    const r = await fetch(`${base}/api/autonomy/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, goal: "做事" }),
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/autonomy/sessions/:sid/run 無 run → null", async () => {
    const r = await fetch(`${base}/api/autonomy/sessions/__none__/run`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ run: null });
  });

  it("POST /api/autonomy/runs 不存在 session → 404", async () => {
    const r = await fetch(`${base}/api/autonomy/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "__missing__", goal: "g" }),
    });
    expect(r.status).toBe(404);
  });

  it("POST /api/autonomy/runs goal 空 → 400", async () => {
    const sid = `test_claude_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    createdSessionIds.push(sid);
    const r = await fetch(`${base}/api/autonomy/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, goal: "  " }),
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/activity 回 items 陣列", async () => {
    const r = await fetch(`${base}/api/activity`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { items: unknown[] };
    expect(Array.isArray(j.items)).toBe(true);
  });

  it("GET /api/activity?sessionId= 篩選（不存在 → 空）", async () => {
    const r = await fetch(`${base}/api/activity?sessionId=__none__`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("POST /api/autonomy/runs 接受 policy=balanced", async () => {
    const sid = `test_policy_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    createdSessionIds.push(sid);
    const r = await fetch(`${base}/api/autonomy/runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sid, goal: "測試目標", policy: "balanced", maxSteps: 3, maxWallMs: 5000 }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { runId: string };
    expect(typeof j.runId).toBe("string");
  });

  it("POST /api/autonomy/runs/:id/inject：非執行中 run 回 409、不存在回 404", async () => {
    const sid = `test_inject_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    createdSessionIds.push(sid);
    const { runId } = await (await fetch(`${base}/api/autonomy/runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sid, goal: "g", policy: "manual", maxSteps: 3, maxWallMs: 5000 }),
    })).json() as { runId: string };
    // manual run 停在 awaiting_plan_approval（非 running/paused_for_action）→ 不可插話，應 409 而非靜默 200
    const r = await fetch(`${base}/api/autonomy/runs/${runId}/inject`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "改方向" }),
    });
    expect(r.status).toBe(409);
    // 不存在的 run → 404
    const r2 = await fetch(`${base}/api/autonomy/runs/nope_${Date.now()}/inject`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    expect(r2.status).toBe(404);
  });

  it("projects CRUD + 指派 session", async () => {
    const c = await fetch(`${base}/api/projects?workspace=${DEFAULT_WORKSPACE_ID}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "E2E 專案" }),
    });
    expect(c.status).toBe(200);
    const { project } = await c.json() as { project: { id: string } };
    expect(project.id).toBeTruthy();
    const u = await fetch(`${base}/api/projects/${project.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ memory: "本專案重點" }),
    });
    expect(u.status).toBe(200);
    const sid = `t_proj_${Date.now()}`;
    upsertSession({ id: sid, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "x", title: "t", provider: "claude", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    createdSessionIds.push(sid);
    const a = await fetch(`${base}/api/sessions/${sid}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    expect(a.status).toBe(200);
    expect(getSession(sid)!.projectId).toBe(project.id);
    // cleanup
    await fetch(`${base}/api/projects/${project.id}`, { method: "DELETE" });
  });

  it("POST /api/autonomy/actions/:id/reject：手動派工(無 runId)會被標記 rejected", async () => {
    const pa = createPendingAction({
      sessionId: `test_reject_${Date.now()}`,
      workspaceId: DEFAULT_WORKSPACE_ID,
      kind: "dispatch",
      risk: "high",
      summary: "測試派工",
      detail: "- agentId: a\n  mode: consult\n  task: t",
    });
    const r = await fetch(`${base}/api/autonomy/actions/${pa.id}/reject`, { method: "POST" });
    expect(r.status).toBe(200);
    // 拒絕後不應再是 pending（修好前 bug：手動派工 reject 不被標記，卡片永遠殘留）
    expect(getPendingAction(pa.id)?.status).toBe("rejected");
  });

  it("GET /api/cockpit 無簡報時回 null（或既有簡報）", async () => {
    const r = await fetch(`${base}/api/cockpit`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toHaveProperty("briefing");
  });

  it("POST /api/cockpit/refresh 觸發後回 ok 且 GET 拿得到", async () => {
    const r = await fetch(`${base}/api/cockpit/refresh`, { method: "POST" });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  // ── 問題 A：draft/apply 保留 DAG 欄位 ────────────────────────────────────
  it("POST /api/workflow/draft/apply 保留 DAG 欄位（id/dependsOn/pauseBefore/maxConcurrency）", async () => {
    // 取第一個可用 agentId（避免硬編碼不存在的 agent）
    const agentsResp = await fetch(`${base}/api/agents`);
    const { agents } = (await agentsResp.json()) as { agents: { id: string }[] };
    if (agents.length === 0) return; // 若無 agent 跳過
    const agentId = agents[0].id;

    const resp = await fetch(`${base}/api/workflow/draft/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "test-session-dag",
        workspaceId: DEFAULT_WORKSPACE_ID,
        workflow: {
          name: "__test DAG workflow__",
          description: "test",
          maxConcurrency: 3,
          steps: [
            { id: "step_a", agentId, prompt: "First step" },
            { id: "step_b", agentId, dependsOn: ["step_a"], pauseBefore: true, prompt: "Second {{step_a.out}}" },
          ],
        },
      }),
    });
    expect(resp.status).toBe(200);
    const wf = (await resp.json()) as any;
    expect(wf.id).toBeTruthy();
    createdWorkflowIds.push(wf.id);

    // 頂層 maxConcurrency 保留
    expect(wf.maxConcurrency).toBe(3);

    // step_a：id 正確
    const stepA = (wf.steps as any[]).find((s: any) => s.id === "step_a");
    expect(stepA).toBeDefined();

    // step_b：DAG 欄位保留
    const stepB = (wf.steps as any[]).find((s: any) => s.id === "step_b");
    expect(stepB).toBeDefined();
    expect(stepB.dependsOn).toEqual(["step_a"]);
    expect(stepB.pauseBefore).toBe(true);
  });

  it("POST /api/workflow/draft/apply 循環依賴 → 400", async () => {
    const agentsResp = await fetch(`${base}/api/agents`);
    const { agents } = (await agentsResp.json()) as { agents: { id: string }[] };
    if (agents.length === 0) return;
    const agentId = agents[0].id;

    const resp = await fetch(`${base}/api/workflow/draft/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "test-cycle",
        workspaceId: DEFAULT_WORKSPACE_ID,
        workflow: {
          name: "__test cycle__",
          steps: [
            { id: "a", agentId, prompt: "a", dependsOn: ["b"] },
            { id: "b", agentId, prompt: "b", dependsOn: ["a"] },
          ],
        },
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/循環|cycle/i);
  });

  it("POST /api/workflow/draft/apply 依賴不存在的 step → 400", async () => {
    const agentsResp = await fetch(`${base}/api/agents`);
    const { agents } = (await agentsResp.json()) as { agents: { id: string }[] };
    if (agents.length === 0) return;
    const agentId = agents[0].id;

    const resp = await fetch(`${base}/api/workflow/draft/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "test-missing-dep",
        workspaceId: DEFAULT_WORKSPACE_ID,
        workflow: {
          name: "__test missing dep__",
          steps: [
            { id: "a", agentId, prompt: "a", dependsOn: ["nonexistent"] },
          ],
        },
      }),
    });
    expect(resp.status).toBe(400);
  });
});

// ── /api/guard — 路由層 ──────────────────────────────────────────────────────

describe("/api/guard", () => {
  // 每個測試前後清理 env 並重設 client
  let savedGateMode: string | undefined;
  let savedGate: string | undefined;

  beforeEach(() => {
    savedGateMode = process.env.SHELLWARD_GATE_MODE;
    savedGate = process.env.SHELLWARD_GATE;
    // 預設 shadow（移除可能遺留的 enforce）
    delete process.env.SHELLWARD_GATE_MODE;
    delete process.env.SHELLWARD_GATE;
    // 重設為安全的 fake client
    setShellwardClient({ checkCommand: async () => ({ available: true, safe: true }) });
  });

  afterEach(() => {
    if (savedGateMode !== undefined) process.env.SHELLWARD_GATE_MODE = savedGateMode;
    else delete process.env.SHELLWARD_GATE_MODE;
    if (savedGate !== undefined) process.env.SHELLWARD_GATE = savedGate;
    else delete process.env.SHELLWARD_GATE;
    // 重設為安全的 fake client，避免污染後續測試
    setShellwardClient({ checkCommand: async () => ({ available: true, safe: true }) });
  });

  it("POST /api/guard/check — token 錯 → 403", async () => {
    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": "wrong-token-value" },
      body: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
    });
    expect(r.status).toBe(403);
  });

  it("POST /api/guard/check — Bash 危險指令 + enforce → deny", async () => {
    setShellwardClient({
      checkCommand: async () => ({ available: true, safe: false, reason: "rm -rf detected", ruleId: "rm_rf_root" }),
    });
    process.env.SHELLWARD_GATE_MODE = "enforce";

    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": GUARD_TOKEN },
      body: JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { decision: string; reason?: string };
    expect(j.decision).toBe("deny");
    expect(j.reason).toBeTruthy();
  });

  it("POST /api/guard/check — Bash 危險指令 + shadow（預設）→ allow", async () => {
    setShellwardClient({
      checkCommand: async () => ({ available: true, safe: false, reason: "suspicious" }),
    });
    // shadow is default — no env var set

    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": GUARD_TOKEN },
      body: JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { decision: string };
    expect(j.decision).toBe("allow");
  });

  it("POST /api/guard/check — Bash 安全指令 → allow（enforce & shadow 均）", async () => {
    setShellwardClient({ checkCommand: async () => ({ available: true, safe: true }) });
    process.env.SHELLWARD_GATE_MODE = "enforce";

    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": GUARD_TOKEN },
      body: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls -la" } }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { decision: string };
    expect(j.decision).toBe("allow");
  });

  it("POST /api/guard/check — 缺 tool_name（body 壞）+ shadow → allow（fail-closed）", async () => {
    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": GUARD_TOKEN },
      body: JSON.stringify({ command: "ls" }), // 缺 tool_name
    });
    expect(r.status).toBe(200); // 絕不 500
    const j = await r.json() as { decision: string };
    expect(j.decision).toBe("allow"); // shadow fail-closed → allow
  });

  it("POST /api/guard/check — 缺 tool_name（body 壞）+ enforce → deny（fail-closed）", async () => {
    process.env.SHELLWARD_GATE_MODE = "enforce";

    const r = await fetch(`${base}/api/guard/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-guard-token": GUARD_TOKEN },
      body: JSON.stringify({ command: "ls" }), // 缺 tool_name
    });
    expect(r.status).toBe(200); // 絕不 500
    const j = await r.json() as { decision: string };
    expect(j.decision).toBe("deny"); // enforce fail-closed → deny
  });

  it("GET /api/guard/decisions — 回陣列（debug 端點）", async () => {
    const r = await fetch(`${base}/api/guard/decisions`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j)).toBe(true);
  });
});

// ── 問題 B：workflow run 開機對帳 ──────────────────────────────────────────
describe("workflow run 開機對帳", () => {
  it("reconcileWorkflowRunsOnBoot 把 running 的 workflow_run 轉為 error", () => {
    // 直接用 store 建一個 running run（fake workflowId，FK 未強制）
    const run = createRun("fake-wf-reconcile-test", DEFAULT_WORKSPACE_ID);
    expect(run.status).toBe("running");

    const count = reconcileWorkflowRunsOnBoot();
    expect(count).toBeGreaterThan(0);

    const updated = getRun(run.id);
    expect(updated?.status).toBe("error");
    expect(updated?.error).toBeTruthy();
    expect(updated?.endedAt).toBeTruthy();
  });

  it("reconcileWorkflowRunsOnBoot 把 paused 的 workflow_run 也轉為 error", () => {
    // 先建 running run，再手動改成 paused，再 reconcile
    const run = createRun("fake-wf-reconcile-paused", DEFAULT_WORKSPACE_ID);
    updateRun(run.id, { status: "paused" });
    const before = getRun(run.id);
    expect(before?.status).toBe("paused");

    const count = reconcileWorkflowRunsOnBoot();
    expect(count).toBeGreaterThan(0);

    const updated = getRun(run.id);
    expect(updated?.status).toBe("error");
  });
});
