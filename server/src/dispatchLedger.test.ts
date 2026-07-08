/**
 * dispatchLedger — 共用台帳/推播包裝層（單元）
 *
 * ledgerBegin：開始一項派工時建台帳（回 delegationId）。無 ctx → 不建、回 undefined。
 * ledgerFinish：結束時 finishDelegation（ok→done、其餘→failed），execute 項額外 notify；
 *               consult 不 notify（對齊手動路徑）。用明確 delegationId 綁定，不靠 agentId 比對。
 */
import { describe, it, expect, vi } from "vitest";
import { ledgerBegin, ledgerFinish, type DispatchLedgerDeps } from "./dispatchLedger.js";
import type { DispatchItem } from "./dispatchParser.js";

const consultItem: DispatchItem = { agentId: "agent-a", mode: "consult", task: "諮詢任務" };
const executeItem: DispatchItem = { agentId: "agent-b", mode: "execute", task: "執行任務" };

function makeLedger(): DispatchLedgerDeps & {
  createDelegation: ReturnType<typeof vi.fn>;
  finishDelegation: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  return {
    createDelegation: vi.fn((input: any) => `dlg-${input.agentId}`),
    finishDelegation: vi.fn(),
    notify: vi.fn(),
    nameOf: (id: string) => `名-${id}`,
  };
}

describe("ledgerBegin", () => {
  it("有 ctx → createDelegation 記 pm/ws/agent/mode/task，回 delegationId", () => {
    const ledger = makeLedger();
    const id = ledgerBegin({ pmSessionId: "pm1", workspaceId: "ws1" }, consultItem, ledger);
    expect(id).toBe("dlg-agent-a");
    expect(ledger.createDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ pmSessionId: "pm1", workspaceId: "ws1", agentId: "agent-a", mode: "consult", task: "諮詢任務" }),
    );
  });

  it("execute 項 → mode:execute；可帶 subSessionId 於 create 時寫入", () => {
    const ledger = makeLedger();
    ledgerBegin({ pmSessionId: "pm1", workspaceId: "ws1" }, executeItem, ledger, "sub-1");
    expect(ledger.createDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "execute", subSessionId: "sub-1" }),
    );
  });

  it("無 ctx → 不建台帳，回 undefined", () => {
    const ledger = makeLedger();
    const id = ledgerBegin(undefined, consultItem, ledger);
    expect(id).toBeUndefined();
    expect(ledger.createDelegation).not.toHaveBeenCalled();
  });

  it("createDelegation 拋錯 → 不炸、回 undefined", () => {
    const ledger = makeLedger();
    ledger.createDelegation.mockImplementation(() => { throw new Error("db 掛"); });
    expect(ledgerBegin({ pmSessionId: "pm1", workspaceId: "ws1" }, consultItem, ledger)).toBeUndefined();
  });
});

describe("ledgerFinish", () => {
  it("consult ok → finish done、不 notify", () => {
    const ledger = makeLedger();
    ledgerFinish("dlg-a", consultItem, { ok: true, output: "答覆", subSessionId: "sub-a" }, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-a", expect.objectContaining({ status: "done", resultExcerpt: "答覆", subSessionId: "sub-a" }));
    expect(ledger.notify).not.toHaveBeenCalled();
  });

  it("consult 失敗 → finish failed、仍不 notify", () => {
    const ledger = makeLedger();
    ledgerFinish("dlg-a", consultItem, { ok: false, output: "" }, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-a", expect.objectContaining({ status: "failed" }));
    expect(ledger.notify).not.toHaveBeenCalled();
  });

  it("execute ok → finish done + notify 交辦完成（title 用 nameOf）", () => {
    const ledger = makeLedger();
    ledgerFinish("dlg-b", executeItem, { ok: true, output: "已完成證據", subSessionId: "sub-b" }, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-b", expect.objectContaining({ status: "done" }));
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦完成", title: expect.stringContaining("名-agent-b") }));
  });

  it("execute 失敗 → finish failed + notify 交辦失敗", () => {
    const ledger = makeLedger();
    ledgerFinish("dlg-b", executeItem, { ok: false, output: "錯誤細節" }, ledger);
    expect(ledger.finishDelegation).toHaveBeenCalledWith("dlg-b", expect.objectContaining({ status: "failed" }));
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦失敗" }));
  });

  it("delegId undefined（create 失敗）→ 不 finish，但 execute 仍推播", () => {
    const ledger = makeLedger();
    ledgerFinish(undefined, executeItem, { ok: true, output: "x" }, ledger);
    expect(ledger.finishDelegation).not.toHaveBeenCalled();
    expect(ledger.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "交辦完成" }));
  });

  it("finishDelegation 拋錯 → 不炸（execute notify 照樣送）", () => {
    const ledger = makeLedger();
    ledger.finishDelegation.mockImplementation(() => { throw new Error("db 掛"); });
    expect(() => ledgerFinish("dlg-b", executeItem, { ok: true, output: "x" }, ledger)).not.toThrow();
    expect(ledger.notify).toHaveBeenCalled();
  });
});
