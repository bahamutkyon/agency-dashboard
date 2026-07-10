/**
 * watchtower store 測試：CRUD、quota 今日計數、工作區隔離
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWatchtowerTask,
  getWatchtowerTask,
  listWatchtowerTasks,
  listEnabledTasks,
  updateWatchtowerTask,
  deleteWatchtowerTask,
  appendLog,
  listLogs,
  countActsToday,
  updateLastConclusion,
  updateLastFired,
} from "./store/watchtower.js";
import { db } from "./db.js";

// cleanup helper
const createdTaskIds: string[] = [];

afterEach(() => {
  for (const id of createdTaskIds) {
    try { db.prepare("DELETE FROM watchtower_tasks WHERE id = ?").run(id); } catch {}
    try { db.prepare("DELETE FROM watchtower_logs WHERE task_id = ?").run(id); } catch {}
  }
  createdTaskIds.length = 0;
});

function makeTask(workspaceId = "ws_test", overrides: object = {}) {
  const t = createWatchtowerTask({
    workspaceId,
    name: "測試看守",
    cron: "0 * * * *",
    quietHours: "22-8",
    dailyQuota: 3,
    ...overrides,
  });
  createdTaskIds.push(t.id);
  return t;
}

describe("watchtower store — CRUD", () => {
  it("createWatchtowerTask → getWatchtowerTask 可查到", () => {
    const t = makeTask();
    const got = getWatchtowerTask(t.id);
    expect(got?.name).toBe("測試看守");
    expect(got?.dailyQuota).toBe(3);
    expect(got?.enabled).toBe(1);
    expect(got?.quietHours).toBe("22-8");
  });

  it("listWatchtowerTasks 工作區隔離：只回自己工作區的", () => {
    const ws1 = `ws_list_${Date.now()}_a`;
    const ws2 = `ws_list_${Date.now()}_b`;
    const t1 = makeTask(ws1);
    const t2 = makeTask(ws2);
    const r1 = listWatchtowerTasks(ws1);
    const r2 = listWatchtowerTasks(ws2);
    expect(r1.some((t) => t.id === t1.id)).toBe(true);
    expect(r1.some((t) => t.id === t2.id)).toBe(false);
    expect(r2.some((t) => t.id === t2.id)).toBe(true);
    expect(r2.some((t) => t.id === t1.id)).toBe(false);
  });

  it("listEnabledTasks 只回 enabled=1 的", () => {
    const active = makeTask("ws_e1", { enabled: true });
    const disabled = makeTask("ws_e1", { enabled: false });
    const all = listEnabledTasks();
    expect(all.some((t) => t.id === active.id)).toBe(true);
    expect(all.some((t) => t.id === disabled.id)).toBe(false);
  });

  it("updateWatchtowerTask 正常更新", () => {
    const t = makeTask();
    const updated = updateWatchtowerTask(t.id, { name: "更新看守", dailyQuota: 5 });
    expect(updated?.name).toBe("更新看守");
    expect(updated?.dailyQuota).toBe(5);
  });

  it("updateWatchtowerTask 工作區不符 → undefined", () => {
    const t = makeTask("ws_upd_ok");
    const result = updateWatchtowerTask(t.id, { name: "偷改" }, "ws_other");
    expect(result).toBeUndefined();
    // 資料未被改
    expect(getWatchtowerTask(t.id)?.name).toBe("測試看守");
  });

  it("deleteWatchtowerTask 正常刪除", () => {
    const t = makeTask();
    const ok = deleteWatchtowerTask(t.id, t.workspaceId);
    expect(ok).toBe(true);
    expect(getWatchtowerTask(t.id)).toBeUndefined();
    // 已刪就不需要 afterEach 再清
    createdTaskIds.splice(createdTaskIds.indexOf(t.id), 1);
  });

  it("deleteWatchtowerTask 工作區不符 → false", () => {
    const t = makeTask("ws_del_ok");
    const ok = deleteWatchtowerTask(t.id, "ws_wrong");
    expect(ok).toBe(false);
    expect(getWatchtowerTask(t.id)).toBeDefined();
  });

  it("updateLastConclusion + updateLastFired 寫入", () => {
    const t = makeTask();
    updateLastConclusion(t.id, "今日無事");
    updateLastFired(t.id);
    const got = getWatchtowerTask(t.id);
    expect(got?.lastConclusion).toBe("今日無事");
    expect(got?.lastFiredAt).toBeGreaterThan(0);
  });
});

describe("watchtower store — Log + quota", () => {
  it("appendLog 可被 listLogs 查到", () => {
    const t = makeTask();
    appendLog({ taskId: t.id, workspaceId: t.workspaceId, decision: "skip", reason: "沒事" });
    const logs = listLogs(t.id, t.workspaceId);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].decision).toBe("skip");
    expect(logs[0].reason).toBe("沒事");
    expect(logs[0].runId).toBeNull();
  });

  it("appendLog 帶 runId", () => {
    const t = makeTask();
    appendLog({ taskId: t.id, workspaceId: t.workspaceId, decision: "act", reason: "起動", runId: "run_123" });
    const logs = listLogs(t.id, t.workspaceId);
    expect(logs[0].runId).toBe("run_123");
  });

  it("listLogs 工作區隔離：不回其他工作區的 log", () => {
    const t = makeTask("ws_log_iso");
    appendLog({ taskId: t.id, workspaceId: "ws_other", decision: "skip", reason: "other" });
    const logs = listLogs(t.id, "ws_log_iso");
    // 雖然 taskId 相同，ws 不符應過濾掉
    expect(logs.every((l) => l.workspaceId === "ws_log_iso")).toBe(true);
  });

  it("countActsToday 只算 decision=act 且今日（Taipei）", () => {
    const t = makeTask();
    const now = Date.now();
    // 加 2 筆 act
    appendLog({ taskId: t.id, workspaceId: t.workspaceId, decision: "act", reason: "動了1" });
    appendLog({ taskId: t.id, workspaceId: t.workspaceId, decision: "act", reason: "動了2" });
    // 加 1 筆 skip（不計入）
    appendLog({ taskId: t.id, workspaceId: t.workspaceId, decision: "skip", reason: "沒動" });
    const count = countActsToday(t.id, now);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("countActsToday 隔離：不算別的 taskId", () => {
    const t1 = makeTask("ws_cnt");
    const t2 = makeTask("ws_cnt");
    appendLog({ taskId: t1.id, workspaceId: "ws_cnt", decision: "act", reason: "t1" });
    expect(countActsToday(t2.id, Date.now())).toBe(0);
  });
});
