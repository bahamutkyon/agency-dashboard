import { describe, it, expect } from "vitest";
import { shouldAutoApprove, type PolicyName } from "./autonomyPolicy.js";

describe("shouldAutoApprove", () => {
  it("balanced 自動放行 plan 與 dispatch", () => {
    expect(shouldAutoApprove("plan", "balanced")).toBe(true);
    expect(shouldAutoApprove("dispatch", "balanced")).toBe(true);
  });
  it("balanced 攔 external_send / spend / destructive", () => {
    expect(shouldAutoApprove("external_send", "balanced")).toBe(false);
    expect(shouldAutoApprove("spend", "balanced")).toBe(false);
    expect(shouldAutoApprove("destructive", "balanced")).toBe(false);
  });
  it("manual 全攔（向後相容既有 autonomy）", () => {
    for (const k of ["plan", "dispatch", "external_send", "spend", "destructive"] as const) {
      expect(shouldAutoApprove(k, "manual")).toBe(false);
    }
  });
  it("conservative 只放行 plan，其餘高風險全攔", () => {
    expect(shouldAutoApprove("plan", "conservative")).toBe(true);
    expect(shouldAutoApprove("dispatch", "conservative")).toBe(false);
    expect(shouldAutoApprove("external_send", "conservative")).toBe(false);
    expect(shouldAutoApprove("spend", "conservative")).toBe(false);
    expect(shouldAutoApprove("destructive", "conservative")).toBe(false);
  });
  it("free 放行 plan/dispatch/destructive，但仍攔 external_send 與 spend", () => {
    expect(shouldAutoApprove("plan", "free")).toBe(true);
    expect(shouldAutoApprove("dispatch", "free")).toBe(true);
    expect(shouldAutoApprove("destructive", "free")).toBe(true);
    expect(shouldAutoApprove("external_send", "free")).toBe(false);
    expect(shouldAutoApprove("spend", "free")).toBe(false);
  });
});
