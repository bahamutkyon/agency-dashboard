/**
 * watchtowerScheduler.ts 測試：四道護欄 + 升級邏輯（注入式 deps）
 *
 * 不需要真實的 claude binary，完全用 fake deps 跑。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { firewatchdogTask, isInQuietHours, watchtowerScheduler } from "./watchtowerScheduler.js";
import type { WatchtowerFireDeps } from "./watchtowerScheduler.js";
import { createWatchtowerTask, appendLog, listLogs } from "./store/watchtower.js";
import { db } from "./db.js";
import type { WatchtowerTask } from "./store/watchtower.js";

// ─── cleanup ──────────────────────────────────────────────────────────────────

const cleanIds: string[] = [];

afterEach(() => {
  for (const id of cleanIds) {
    try { db.prepare("DELETE FROM watchtower_tasks WHERE id = ?").run(id); } catch {}
    try { db.prepare("DELETE FROM watchtower_logs WHERE task_id = ?").run(id); } catch {}
  }
  cleanIds.length = 0;
});

function makeTask(overrides: Partial<WatchtowerTask> = {}): WatchtowerTask {
  const t = createWatchtowerTask({
    workspaceId: "ws_sched_test",
    name: "排程看守",
    cron: "0 * * * *",
    quietHours: "",
    dailyQuota: 3,
  });
  cleanIds.push(t.id);
  // apply overrides in-memory（不寫 DB，讓 test 控制 task 欄位）
  return { ...t, ...overrides };
}

// ─── fake deps factory ────────────────────────────────────────────────────────

function makeFakeDeps(overrides: Partial<WatchtowerFireDeps> = {}): {
  deps: WatchtowerFireDeps;
  calls: {
    runOneShot: any[];
    startRun: any[];
    startOrchestratorSession: any[];
  };
} {
  const calls = {
    runOneShot: [] as any[],
    startRun: [] as any[],
    startOrchestratorSession: [] as any[],
  };

  const deps: WatchtowerFireDeps = {
    runOneShot: async (...args: any[]) => {
      calls.runOneShot.push(args);
      return { ok: true, stdout: JSON.stringify({ shouldAct: false, reason: "無事", goal: "" }), stderr: "", exitCode: 0 };
    },
    startRun: async (sessionId: string, workspaceId: string, goal: string, opts: any) => {
      calls.startRun.push({ sessionId, workspaceId, goal, opts });
      return "run_fake_001";
    },
    makeAutonomyDeps: (_io: any) => ({} as any),
    startOrchestratorSession: (wsId: string, title: string) => {
      calls.startOrchestratorSession.push({ wsId, title });
      return "session_fake_001";
    },
    now: () => Date.now(),
    notifyFn: async (_opts: any) => false as boolean,
    ...overrides,
  };

  return { deps, calls };
}

// ─── isInQuietHours ──────────────────────────────────────────────────────────

describe("isInQuietHours", () => {
  it("空字串 → false（無 quiet hours）", () => {
    expect(isInQuietHours("", Date.now())).toBe(false);
  });

  it("非跨午夜：'9-17' → 中間時段為 true", () => {
    // 造一個 Taipei 時間 12:00 的 UTC 時戳
    // Taipei = UTC+8，12:00 Taipei = 04:00 UTC
    const date = new Date();
    date.setUTCHours(4, 0, 0, 0); // 04:00 UTC = 12:00 Taipei
    expect(isInQuietHours("9-17", date.getTime())).toBe(true);
  });

  it("非跨午夜：'9-17' → 超出範圍為 false", () => {
    // 20:00 Taipei = 12:00 UTC
    const date = new Date();
    date.setUTCHours(12, 0, 0, 0);
    expect(isInQuietHours("9-17", date.getTime())).toBe(false);
  });

  it("跨午夜：'22-8' → 23:00 Taipei 在內", () => {
    // 23:00 Taipei = 15:00 UTC
    const date = new Date();
    date.setUTCHours(15, 0, 0, 0);
    expect(isInQuietHours("22-8", date.getTime())).toBe(true);
  });

  it("跨午夜：'22-8' → 06:00 Taipei 在內", () => {
    // 06:00 Taipei = 22:00 UTC 前一天
    const date = new Date();
    date.setUTCHours(22, 0, 0, 0);
    expect(isInQuietHours("22-8", date.getTime())).toBe(true);
  });

  it("跨午夜：'22-8' → 10:00 Taipei 不在內", () => {
    // 10:00 Taipei = 02:00 UTC
    const date = new Date();
    date.setUTCHours(2, 0, 0, 0);
    expect(isInQuietHours("22-8", date.getTime())).toBe(false);
  });
});

// ─── 護欄① quiet ─────────────────────────────────────────────────────────────

describe("firewatchdogTask — quiet guard", () => {
  it("quiet hours 命中 → decision=quiet，log 正確，不呼叫 runOneShot", async () => {
    // 製造一個永遠在 quiet hours 的 task
    const nowMs = Date.now();
    // 找當前 Taipei hour
    const tpH = parseInt(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", hour: "numeric", hour12: false,
    }).format(nowMs), 10);
    // 把 quiet hours 設成覆蓋目前小時：使用 "0-24"（全天靜音）
    const task = makeTask({ quietHours: "0-24", enabled: 1 });
    const { deps, calls } = makeFakeDeps({ now: () => nowMs });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("quiet");
    expect(calls.runOneShot).toHaveLength(0);

    const logs = listLogs(task.id, task.workspaceId);
    expect(logs[0].decision).toBe("quiet");
  });
});

// ─── 護欄② quota ─────────────────────────────────────────────────────────────

describe("firewatchdogTask — quota guard", () => {
  it("今日 act 已達 dailyQuota → decision=quota，不呼叫 runOneShot", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 2, enabled: 1 });
    // 預先插 2 筆 act log
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "之前的1" });
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "之前的2" });

    const { deps, calls } = makeFakeDeps();
    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("quota");
    expect(calls.runOneShot).toHaveLength(0);

    const logs = listLogs(task.id, task.workspaceId);
    expect(logs[0].decision).toBe("quota");
  });

  it("今日 act 未達 dailyQuota → 不被 quota 擋（繼續往下）", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    // 只有 1 筆 act，quota=5 不應擋
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "之前的1" });

    const { deps, calls } = makeFakeDeps();
    // 繼續到 eval round（fake runOneShot 回 skip）
    const decision = await firewatchdogTask(task, null, deps);
    // eval 回 shouldAct=false → decision=skip（不是 quota）
    expect(decision).toBe("skip");
    expect(calls.runOneShot).toHaveLength(1);
  });
});

// ─── shouldAct=false → skip ───────────────────────────────────────────────────

describe("firewatchdogTask — eval skip path", () => {
  it("haiku 回 shouldAct=false → decision=skip，不起 startRun", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    const { deps, calls } = makeFakeDeps({
      runOneShot: async () => ({
        ok: true,
        stdout: JSON.stringify({ shouldAct: false, reason: "無異常", goal: "" }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("skip");
    expect(calls.startRun).toHaveLength(0);
    expect(calls.startOrchestratorSession).toHaveLength(0);

    const logs = listLogs(task.id, task.workspaceId);
    expect(logs[0].decision).toBe("skip");
  });
});

// ─── shouldAct=true → act，開 balanced run ────────────────────────────────────

describe("firewatchdogTask — act upgrade path", () => {
  it("shouldAct=true → 開 PM session + startRun(policy=balanced)，log 帶 run_id", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    const { deps, calls } = makeFakeDeps({
      runOneShot: async () => ({
        ok: true,
        stdout: JSON.stringify({ shouldAct: true, reason: "有到期追蹤", goal: "追進件狀態" }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("act");

    // 驗 startOrchestratorSession 被呼叫
    expect(calls.startOrchestratorSession).toHaveLength(1);
    expect(calls.startOrchestratorSession[0].wsId).toBe(task.workspaceId);

    // 驗 startRun 用 policy=balanced
    expect(calls.startRun).toHaveLength(1);
    expect(calls.startRun[0].opts?.policy).toBe("balanced");

    // 驗 log 帶 run_id
    const logs = listLogs(task.id, task.workspaceId);
    const actLog = logs.find((l) => l.decision === "act");
    expect(actLog).toBeDefined();
    expect(actLog?.runId).toBe("run_fake_001");
  });
});

// ─── parse 失敗不誤升級 ───────────────────────────────────────────────────────

describe("firewatchdogTask — parse failure path", () => {
  it("haiku 輸出垃圾 JSON → decision=error，不起 startRun", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    const { deps, calls } = makeFakeDeps({
      runOneShot: async () => ({
        ok: true,
        stdout: "這不是 JSON 啊啊啊",
        stderr: "",
        exitCode: 0,
      }),
    });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("error");
    expect(calls.startRun).toHaveLength(0);
    expect(calls.startOrchestratorSession).toHaveLength(0);

    const logs = listLogs(task.id, task.workspaceId);
    expect(logs[0].decision).toBe("error");
    expect(logs[0].reason).toContain("解析失敗");
  });

  it("haiku runOneShot 失敗（ok=false） → decision=error，不起 startRun", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    const { deps, calls } = makeFakeDeps({
      runOneShot: async () => ({
        ok: false,
        stdout: "",
        stderr: "some error",
        exitCode: 1,
        error: "exit code 1",
      }),
    });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("error");
    expect(calls.startRun).toHaveLength(0);
  });

  it("claude JSON wrapper 格式 shouldAct=true 也能解析並升級", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    const inner = { shouldAct: true, reason: "測試 wrapper", goal: "目標" };
    const { deps, calls } = makeFakeDeps({
      runOneShot: async () => ({
        ok: true,
        stdout: JSON.stringify({ type: "result", result: JSON.stringify(inner) }),
        stderr: "",
        exitCode: 0,
      }),
    });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("act");
    expect(calls.startRun).toHaveLength(1);
  });
});

// ─── W-1 live-run overlap guard ───────────────────────────────────────────────

describe("firewatchdogTask — live-run overlap guard（W-1）", () => {
  it("上一個升級的 run 尚未終結（paused_for_action）→ overlap，不評估不升級", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "上次升級", runId: "r_live" });
    const { deps, calls } = makeFakeDeps({ getRunStatus: () => "paused_for_action" });

    const decision = await firewatchdogTask(task, null, deps);
    expect(decision).toBe("overlap");
    expect(calls.runOneShot).toHaveLength(0); // 沒白花 haiku
    expect(calls.startRun).toHaveLength(0);   // 沒開第二個並存 run
    const logs = listLogs(task.id, task.workspaceId);
    // 順序無關（預插 act 與新 overlap 可能同毫秒 tie）：確認有記 overlap
    expect(logs.some((l) => l.decision === "overlap")).toBe(true);
  });

  it("上一個 run 已終結（done）→ 不擋，正常進評估", async () => {
    const task = makeTask({ quietHours: "", dailyQuota: 5, enabled: 1 });
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "上次", runId: "r_done" });
    const { deps, calls } = makeFakeDeps({ getRunStatus: () => "done" });

    const decision = await firewatchdogTask(task, null, deps); // eval fake 回 shouldAct=false
    expect(decision).toBe("skip");
    expect(calls.runOneShot).toHaveLength(1);
  });

  it("force 略過 quiet/quota，但 live-run overlap 仍擋（資源安全）", async () => {
    const task = makeTask({ quietHours: "0-24", dailyQuota: 1, enabled: 1 });
    // 這筆 act 同時讓 quota 達標(1) 且提供未終結 run
    appendLog({ taskId: task.id, workspaceId: task.workspaceId, decision: "act", reason: "上次", runId: "r_live" });
    const { deps, calls } = makeFakeDeps({ getRunStatus: () => "running" });

    const decision = await firewatchdogTask(task, null, deps, { force: true });
    expect(decision).toBe("overlap"); // force 跳過 quiet+quota，overlap 仍攔
    expect(calls.runOneShot).toHaveLength(0);
  });
});

// ─── W-2 run-now 走同一併發守衛 ───────────────────────────────────────────────

describe("WatchtowerScheduler.runNow — 併發守衛（W-2）", () => {
  it("上一輪 run-now 還在跑時再觸發 → overlap，不重複開 run", async () => {
    const task = makeTask({ enabled: 1 }); // 持久化於 DB（enabled 預設 1）
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => { releaseFirst = r; });
    const { deps } = makeFakeDeps({
      runOneShot: async () => {
        await gate; // 卡住第一輪，模擬在途
        return { ok: true, stdout: JSON.stringify({ shouldAct: false, reason: "無事", goal: "" }), stderr: "", exitCode: 0 };
      },
    });

    const p1 = watchtowerScheduler.runNow(task.id, {}, deps); // 第一輪（in-flight，佔用 running set）
    const d2 = await watchtowerScheduler.runNow(task.id, {}, deps); // 第二輪撞上
    expect(d2).toBe("overlap");

    releaseFirst();
    const d1 = await p1;
    expect(d1).toBe("skip"); // 第一輪正常完成
  });
});
