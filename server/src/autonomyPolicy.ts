import type { ActionKind } from "./actionProtocol.js";

// manual = 既有 autonomy 行為（全部需人工核可、plan 需批准）。
// balanced = 本階段預設：自動放行 plan + dispatch；對外發送/花錢/破壞性仍需批准。
// conservative / free 先定義備用，本階段不接 UI。
export type PolicyName = "manual" | "conservative" | "balanced" | "free";

const AUTO_APPROVE: Record<PolicyName, ActionKind[]> = {
  manual: [],
  conservative: ["plan"],
  balanced: ["plan", "dispatch"],
  free: ["plan", "dispatch", "destructive"],
};

export function shouldAutoApprove(kind: ActionKind, policy: PolicyName): boolean {
  return AUTO_APPROVE[policy].includes(kind);
}

export function isPolicyName(s: unknown): s is PolicyName {
  return s === "manual" || s === "conservative" || s === "balanced" || s === "free";
}
