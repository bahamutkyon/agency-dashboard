/**
 * runDispatchByMode × 台帳/推播（自主迴圈派工收斂）
 *
 * 目標：自主路徑帶 ledger context 時，consult/execute 各開→關一筆 delegation，
 * status 對映（ok→done、timeout/error→failed），execute 完成/失敗推播、consult 不推，
 * retry 只一筆 delegation 且記最終結果；未帶 context 則完全不記帳（向後相容）。
 */
import { describe, it, expect, vi } from "vitest";
import { runDispatchByMode } from "./dispatchRunner.js";
import type { DispatchLedgerContext, DispatchLedgerDeps } from "./dispatchLedger.js";
import type { DispatchItem, } from "./dispatchParser.js";
import type { ConsultResult } from "./dispatchRunner.js";

const consultItem: DispatchItem = { agentId: "agent-a", mode: "consult", task: "諮詢任務" };
const executeItem: DispatchItem = { agentId: "agent-b", mode: "execute", task: "執行任務" };
const opts = { concurrency: 3, consultTimeoutMs: 300_000, executeTimeoutMs: 600_000 };
const ctx: DispatchLedgerContext = { pmSessionId: "pm1", workspaceId: "ws1", runId: "run1" };

function makeLedger() {
  const ledger: DispatchLedgerDeps = {
    createDelegation: vi.fn((input: any) => `dlg-${input.agentId}`),
    finishDelegation: vi.fn(),
    notify: vi.fn(),
    nameOf: (id: string) => id,
  };
  return ledger as DispatchLedgerDeps & {
    createDelegation: ReturnType<typeof vi.fn>;
    finishDelegation: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
  };
}

const ok = (item: DispatchItem, output = "回覆"): ConsultResult => ({ agentId: item.agentId, task: item.task, output, status: "ok", subSessionId: `sub-${item.agentId}` });
const timeout = (item: DispatchItem): ConsultResult => ({ agentId: item.agentId, task: item.task, output: "", status: "timeout", subSessionId: `sub-${item.agentId}` });
const err = (item: DispatchItem): ConsultResult => ({ agentId: item.agentId, task: item.task, output: "", status: "error", subSessionId: `sub-${item.agentId}` });

describe("runDispatchByMode 帶 ledger context", () => {
  it("consult ok → 開→關一筆 delegation（done），不推播", async () => {
    const ledger = makeLedger();
    await runDispatchByMode([consultItem], "ws1", opts, async (i) => ok(i), async (i) => ok(i), ctx, ledger);
    expect(ledger.createDelegation).toHaveBeenCalledTimes(1);
    expect(ledger.createDelegation).toHaveBeenCalledWith(expect.objectContaining({ pmSessionId: "pm1", workspaceId: "ws1", agentId: "agent-a", mode: "consult", task: "諮詢任務" }));
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-agent-a", expect.objectContaining({ status: "done", subSessionId: "sub-agent-a" }));
    expect(ledger.notify).not.toHaveBeenCalled();
  });

  it("execute ok → 開→關一筆 delegation（done）+ 推播交辦完成", async () => {
    const ledger = makeLedger();
    await runDispatchByMode([executeItem], "ws1", opts, async (i) => ok(i), async (i) => ok(i, "已驗證完成"), ctx, ledger);
    expect(ledger.createDelegation).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-b", mode: "execute" }));
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-agent-b", expect.objectContaining({ status: "done", resultExcerpt: "已驗證完成" }));
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦完成" }));
  });

  it("execute timeout → failed + 推播交辦失敗", async () => {
    const ledger = makeLedger();
    await runDispatchByMode([executeItem], "ws1", opts, async (i) => ok(i), async (i) => timeout(i), ctx, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-agent-b", expect.objectContaining({ status: "failed" }));
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦失敗" }));
  });

  it("execute error → failed + 推播交辦失敗", async () => {
    const ledger = makeLedger();
    await runDispatchByMode([executeItem], "ws1", opts, async (i) => ok(i), async (i) => err(i), ctx, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-agent-b", expect.objectContaining({ status: "failed" }));
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦失敗" }));
  });

  it("consult retry（先 error 後 ok）→ 只一筆 delegation，finish 記最終 ok + 最後一次 subSessionId", async () => {
    const ledger = makeLedger();
    let n = 0;
    const runC = async (i: DispatchItem): Promise<ConsultResult> => (n++ === 0 ? err(i) : ok(i, "重試成功"));
    await runDispatchByMode([consultItem], "ws1", opts, runC, async (i) => ok(i), ctx, ledger);
    expect(ledger.createDelegation).toHaveBeenCalledTimes(1);
    expect(ledger.finishDelegation).toHaveBeenCalledTimes(1);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-agent-a", expect.objectContaining({ status: "done", resultExcerpt: "重試成功", subSessionId: "sub-agent-a" }));
  });

  it("mixed（consult+execute）→ 兩筆 delegation，只有 execute 推播", async () => {
    const ledger = makeLedger();
    await runDispatchByMode([consultItem, executeItem], "ws1", opts, async (i) => ok(i), async (i) => ok(i), ctx, ledger);
    expect(ledger.createDelegation).toHaveBeenCalledTimes(2);
    expect(ledger.finishDelegation).toHaveBeenCalledTimes(2);
    expect(ledger.notify).toHaveBeenCalledTimes(1);
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦完成" }));
  });

  it("未帶 ctx → 完全不記帳、不推播（向後相容）", async () => {
    const ledger = makeLedger();
    const text = await runDispatchByMode([executeItem], "ws1", opts, async (i) => ok(i), async (i) => ok(i), undefined, ledger);
    expect(ledger.createDelegation).not.toHaveBeenCalled();
    expect(ledger.finishDelegation).not.toHaveBeenCalled();
    expect(ledger.notify).not.toHaveBeenCalled();
    expect(text).toContain("agent-b（ok）"); // 派工結果照常回
  });
});
