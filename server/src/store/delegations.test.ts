import { describe, it, expect } from "vitest";
import {
  createDelegation,
  finishDelegation,
  listDelegations,
  reconcileDelegationsOnBoot,
} from "./delegations.js";

const base = {
  pmSessionId: `pm_${Date.now().toString(36)}`,
  workspaceId: "ws-deleg-test",
  agentId: "developer",
  mode: "execute" as const,
  task: "建一個登入頁面",
};

describe("delegations store", () => {
  it("createDelegation 回傳 id，status 為 running", () => {
    const id = createDelegation({ ...base });
    expect(id).toMatch(/^dlg_/);
    const rows = listDelegations({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("running");
    expect(row!.mode).toBe("execute");
    expect(row!.endedAt).toBeUndefined();
  });

  it("createDelegation 支援 subSessionId", () => {
    const id = createDelegation({ ...base, subSessionId: "sub_abc123" });
    const rows = listDelegations({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id);
    expect(row!.subSessionId).toBe("sub_abc123");
  });

  it("finishDelegation status=done 設 ended_at 與 resultExcerpt", () => {
    const id = createDelegation({ ...base });
    finishDelegation(id, { status: "done", resultExcerpt: "完成了" });
    const rows = listDelegations({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id)!;
    expect(row.status).toBe("done");
    expect(row.resultExcerpt).toBe("完成了");
    expect(row.endedAt).toBeGreaterThan(0);
  });

  it("finishDelegation status=failed", () => {
    const id = createDelegation({ ...base });
    finishDelegation(id, { status: "failed", resultExcerpt: "逾時" });
    const rows = listDelegations({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id)!;
    expect(row.status).toBe("failed");
  });

  it("inFlightOnly 過濾：只回 queued/running", () => {
    const pmId = `pm_if_${Date.now().toString(36)}`;
    const id1 = createDelegation({ ...base, pmSessionId: pmId });
    const id2 = createDelegation({ ...base, pmSessionId: pmId });
    finishDelegation(id2, { status: "done" });

    const inFlight = listDelegations({ pmSessionId: pmId, inFlightOnly: true });
    expect(inFlight.some((r) => r.id === id1)).toBe(true);
    expect(inFlight.some((r) => r.id === id2)).toBe(false);

    const all = listDelegations({ pmSessionId: pmId });
    expect(all.some((r) => r.id === id2)).toBe(true);
  });

  it("listDelegations workspaceId 過濾", () => {
    const ws = `ws-deleg-${Date.now().toString(36)}`;
    const id = createDelegation({ ...base, workspaceId: ws });
    const rows = listDelegations({ workspaceId: ws });
    expect(rows.some((r) => r.id === id)).toBe(true);
    // 其他工作區不出現
    const other = listDelegations({ workspaceId: "ws-other-9999" });
    expect(other.some((r) => r.id === id)).toBe(false);
  });

  it("reconcileDelegationsOnBoot 把 running/queued 標 orphaned，不動 done/failed", () => {
    const pmId = `pm_rb_${Date.now().toString(36)}`;
    const r1 = createDelegation({ ...base, pmSessionId: pmId });
    const r2 = createDelegation({ ...base, pmSessionId: pmId });
    const r3 = createDelegation({ ...base, pmSessionId: pmId });
    finishDelegation(r3, { status: "done" });

    const count = reconcileDelegationsOnBoot();
    expect(count).toBeGreaterThanOrEqual(2);

    const rows = listDelegations({ pmSessionId: pmId });
    expect(rows.find((r) => r.id === r1)!.status).toBe("orphaned");
    expect(rows.find((r) => r.id === r2)!.status).toBe("orphaned");
    expect(rows.find((r) => r.id === r3)!.status).toBe("done"); // 不動
  });

  it("reconcileDelegationsOnBoot 回傳標記筆數", () => {
    // 先 drain 現有 running（之前測試可能殘留）
    reconcileDelegationsOnBoot();
    const pmId = `pm_rc_${Date.now().toString(36)}`;
    createDelegation({ ...base, pmSessionId: pmId });
    createDelegation({ ...base, pmSessionId: pmId });
    const n = reconcileDelegationsOnBoot();
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("task 超 200 字元會截斷", () => {
    const long = "x".repeat(300);
    const id = createDelegation({ ...base, task: long });
    const rows = listDelegations({ pmSessionId: base.pmSessionId });
    const row = rows.find((r) => r.id === id)!;
    expect(row.task.length).toBeLessThanOrEqual(200);
  });
});
