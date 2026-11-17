import { describe, it, expect } from "vitest";
import { sessionBadge } from "./sessionStatus";

describe("sessionBadge（優先序：執行中 > 等你批准 > 已結束 > 等你回覆）", () => {
  it("正在回覆或有派工在跑 → 執行中", () => {
    expect(sessionBadge({ status: "busy" })?.label).toBe("執行中");
    expect(sessionBadge({ runningDelegations: 2 })?.label).toBe("同事執行中");
  });
  it("有待批准動作 → 等你批准（帶數量）", () => {
    expect(sessionBadge({ pendingCount: 1 })?.label).toBe("等你批准 1 件");
  });
  it("確定的訊號優先於自動判斷", () => {
    expect(sessionBadge({ pendingCount: 1, state: "done" })?.label).toBe("等你批准 1 件");
  });
  it("已結束、等你回覆", () => {
    expect(sessionBadge({ state: "done" })?.label).toBe("已結束");
    expect(sessionBadge({ state: "waiting_user" })?.label).toBe("等你回覆");
  });
  it("其他不標", () => {
    expect(sessionBadge({ state: "open" })).toBeNull();
    expect(sessionBadge({})).toBeNull();
  });
  it("擱置中", () => {
    expect(sessionBadge({ state: "parked" })?.label).toBe("擱置中");
  });
});
