import { describe, it, expect } from "vitest";
import { shouldAutoApprove, type PolicyName } from "./autonomyPolicy.js";

describe("shouldAutoApprove", () => {
  it("balanced 自動放行 plan 與 dispatch", () => {
    expect(shouldAutoApprove("plan", "balanced")).toBe(true);
    expect(shouldAutoApprove("dispatch", "balanced")).toBe(true);
  });

  // B2 安全閘：balanced dispatch mode-aware
  describe("balanced dispatch 依 items 模式決策", () => {
    it("balanced + dispatch + hasExecute:false → 全 consult，仍自動放行", () => {
      expect(shouldAutoApprove("dispatch", "balanced", { hasExecute: false })).toBe(true);
    });
    it("balanced + dispatch + hasExecute:true → 含 execute，轉待批", () => {
      expect(shouldAutoApprove("dispatch", "balanced", { hasExecute: true })).toBe(false);
    });
    it("balanced + dispatch 無 ctx → 向後相容，維持自動放行", () => {
      expect(shouldAutoApprove("dispatch", "balanced")).toBe(true);
    });
    it("manual + dispatch + hasExecute:false → manual 不受 ctx 影響，全待批", () => {
      expect(shouldAutoApprove("dispatch", "manual", { hasExecute: false })).toBe(false);
    });
    it("free + dispatch + hasExecute:true → free 不收緊，仍自動放行", () => {
      expect(shouldAutoApprove("dispatch", "free", { hasExecute: true })).toBe(true);
    });
    it("conservative + dispatch + hasExecute:false → conservative 不放行 dispatch", () => {
      expect(shouldAutoApprove("dispatch", "conservative", { hasExecute: false })).toBe(false);
    });
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
