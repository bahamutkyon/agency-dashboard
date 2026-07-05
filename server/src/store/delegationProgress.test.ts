/**
 * TDD — 測試先於實作。
 * 執行方式：cd server && npx vitest run delegationProgress
 */
import { describe, it, expect } from "vitest";
import { logActivity } from "./activity.js";
import { getDelegationProgress, getBatchDelegationProgress } from "./delegationProgress.js";
import {
  createDelegation,
  finishDelegation,
  listDelegationsWithProgress,
} from "./delegations.js";

// ─── getDelegationProgress ────────────────────────────────────────────────────

describe("getDelegationProgress", () => {
  it("未知 session → toolCalls=0, lastActivityAt=null, lastAction=null", () => {
    const p = getDelegationProgress("session_that_never_existed_xyz");
    expect(p.toolCalls).toBe(0);
    expect(p.lastActivityAt).toBeNull();
    expect(p.lastAction).toBeNull();
  });

  it("只計算 tool_call，tool_result 不計入 toolCalls", () => {
    const sid = `sub_tc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: sid, kind: "tool_call", summary: "Bash: ls" });
    logActivity({ sessionId: sid, kind: "tool_call", summary: "Write: /a.ts" });
    logActivity({ sessionId: sid, kind: "tool_result", summary: "工具完成", status: "ok" });
    const p = getDelegationProgress(sid);
    expect(p.toolCalls).toBe(2);
  });

  it("lastActivityAt 回最大 ts（包含 tool_result）", () => {
    const sid = `sub_lat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: sid, kind: "tool_call", summary: "A" });
    const before = Date.now();
    logActivity({ sessionId: sid, kind: "tool_result", summary: "B" });
    const p = getDelegationProgress(sid);
    expect(p.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it("lastAction 回最後一個 tool_call 的 summary", () => {
    const sid = `sub_la_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: sid, kind: "tool_call", summary: "Bash: old" });
    logActivity({ sessionId: sid, kind: "tool_call", summary: "Write: /new.ts" });
    // tool_result 不影響 lastAction
    logActivity({ sessionId: sid, kind: "tool_result", summary: "完成" });
    const p = getDelegationProgress(sid);
    expect(p.lastAction).toBe("Write: /new.ts");
  });

  it("只有 tool_result 沒有 tool_call → lastAction=null, toolCalls=0", () => {
    const sid = `sub_noact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: sid, kind: "tool_result", summary: "只有結果" });
    const p = getDelegationProgress(sid);
    expect(p.toolCalls).toBe(0);
    expect(p.lastAction).toBeNull();
    expect(p.lastActivityAt).toBeGreaterThan(0);
  });
});

// ─── getBatchDelegationProgress ──────────────────────────────────────────────

describe("getBatchDelegationProgress", () => {
  it("空陣列 → 空 Map", () => {
    const m = getBatchDelegationProgress([]);
    expect(m.size).toBe(0);
  });

  it("一次查多個 session，各自統計正確", () => {
    const s1 = `sub_b1_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const s2 = `sub_b2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: s1, kind: "tool_call", summary: "Bash: a" });
    logActivity({ sessionId: s1, kind: "tool_call", summary: "Bash: b" });
    logActivity({ sessionId: s2, kind: "tool_call", summary: "Read: x" });
    const m = getBatchDelegationProgress([s1, s2, "s_missing_xyz"]);
    expect(m.get(s1)?.toolCalls).toBe(2);
    expect(m.get(s1)?.lastAction).toBe("Bash: b");
    expect(m.get(s2)?.toolCalls).toBe(1);
    expect(m.get(s2)?.lastAction).toBe("Read: x");
    // 不存在的 session 不在 Map 裡
    expect(m.has("s_missing_xyz")).toBe(false);
  });

  it("session 只有 tool_result → 在 Map 中（有 lastActivityAt），lastAction=null", () => {
    const s = `sub_onlyres_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    logActivity({ sessionId: s, kind: "tool_result", summary: "done" });
    const m = getBatchDelegationProgress([s]);
    const p = m.get(s);
    expect(p).toBeTruthy();
    expect(p!.toolCalls).toBe(0);
    expect(p!.lastAction).toBeNull();
    expect(p!.lastActivityAt).toBeGreaterThan(0);
  });
});

// ─── listDelegationsWithProgress ─────────────────────────────────────────────

const mkBase = () => ({
  pmSessionId: `pm_wprog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
  workspaceId: `ws-wprog-${Date.now().toString(36)}`,
  agentId: "developer",
  mode: "execute" as const,
  task: "做個任務",
});

describe("listDelegationsWithProgress", () => {
  it("in-flight execute delegation 帶 progress（含 toolCalls 和 lastAction）", () => {
    const base = mkBase();
    const subSid = `sub_prog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const id = createDelegation({ ...base, subSessionId: subSid });
    logActivity({ sessionId: subSid, kind: "tool_call", summary: "Bash: npm test" });
    logActivity({ sessionId: subSid, kind: "tool_call", summary: "Write: /out.ts" });

    const rows = listDelegationsWithProgress({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.progress).toBeTruthy();
    expect(row!.progress!.toolCalls).toBe(2);
    expect(row!.progress!.lastAction).toBe("Write: /out.ts");
    expect(row!.progress!.lastActivityAt).toBeGreaterThan(0);
  });

  it("done delegation 不帶 progress（progress 為 undefined）", () => {
    const base = mkBase();
    const subSid = `sub_done_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const id = createDelegation({ ...base, subSessionId: subSid });
    finishDelegation(id, { status: "done" });
    logActivity({ sessionId: subSid, kind: "tool_call", summary: "Bash: x" });

    const rows = listDelegationsWithProgress({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.progress).toBeUndefined();
  });

  it("failed delegation 不帶 progress", () => {
    const base = mkBase();
    const subSid = `sub_fail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const id = createDelegation({ ...base, subSessionId: subSid });
    finishDelegation(id, { status: "failed", resultExcerpt: "逾時" });

    const rows = listDelegationsWithProgress({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.progress).toBeUndefined();
  });

  it("consult mode delegation（即使 running）不帶 progress", () => {
    const base = mkBase();
    const consultBase = { ...base, mode: "consult" as const };
    const subSid = `sub_consult_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const id = createDelegation({ ...consultBase, subSessionId: subSid });
    logActivity({ sessionId: subSid, kind: "tool_call", summary: "Bash: x" });

    const rows = listDelegationsWithProgress({ pmSessionId: consultBase.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.progress).toBeUndefined();
  });

  it("in-flight execute 但沒有 subSessionId → progress 為 undefined", () => {
    const base = mkBase();
    const id = createDelegation({ ...base }); // no subSessionId

    const rows = listDelegationsWithProgress({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.progress).toBeUndefined();
  });

  it("多筆 in-flight，用 batch 而非 N+1（確認回傳結果完整）", () => {
    const base = mkBase();
    const s1 = `sub_m1_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const s2 = `sub_m2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const id1 = createDelegation({ ...base, subSessionId: s1 });
    const id2 = createDelegation({ ...base, subSessionId: s2 });
    logActivity({ sessionId: s1, kind: "tool_call", summary: "Bash: s1" });
    logActivity({ sessionId: s2, kind: "tool_call", summary: "Read: s2" });
    logActivity({ sessionId: s2, kind: "tool_call", summary: "Write: s2" });

    const rows = listDelegationsWithProgress({ pmSessionId: base.pmSessionId });
    const r1 = rows.find((r) => r.id === id1)!;
    const r2 = rows.find((r) => r.id === id2)!;
    expect(r1.progress?.toolCalls).toBe(1);
    expect(r2.progress?.toolCalls).toBe(2);
    expect(r2.progress?.lastAction).toBe("Write: s2");
  });
});
