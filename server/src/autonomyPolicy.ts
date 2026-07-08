import type { ActionKind } from "./actionProtocol.js";

// manual = 既有 autonomy 行為（全部需人工核可、plan 需批准）。
// balanced = 本階段預設：自動放行 plan + dispatch；對外發送/花錢/破壞性仍需批准。
// conservative / free 先定義備用，本階段不接 UI。
export type PolicyName = "manual" | "conservative" | "balanced" | "free";

// 自動放行清單：列出「不需人工核可、由迴圈直接執行」的 ActionKind。
// 注意：next_step / goal_done / need_input 不在任何清單中，因為它們本就不是
// 需要核可的高風險動作（由 autonomyRunner 迴圈直接處理），不經過此政策判斷。
// free 放行 destructive 但仍攔 external_send：對外發送到第三方影響不可控、需額外把關；
// 破壞性動作在 free 模式視為使用者已充分授權。
const AUTO_APPROVE: Record<PolicyName, ActionKind[]> = {
  manual: [],
  conservative: ["plan"],
  balanced: ["plan", "dispatch"],
  free: ["plan", "dispatch", "destructive"],
};

/**
 * 判斷給定 kind 在當前政策下是否自動放行。
 * ctx.hasExecute：dispatch 類的 items 中是否含有 mode:"execute" 的項目。
 * - balanced + dispatch + hasExecute:true → 轉待批（B2 安全閘）
 * - 其餘情況（含無 ctx）維持原語意。
 */
export function shouldAutoApprove(
  kind: ActionKind,
  policy: PolicyName,
  ctx?: { hasExecute?: boolean },
): boolean {
  // B2 安全閘：balanced 下含 execute 的派工不自動放行
  if (kind === "dispatch" && policy === "balanced" && ctx?.hasExecute) return false;
  return AUTO_APPROVE[policy].includes(kind);
}

export function isPolicyName(s: unknown): s is PolicyName {
  return s === "manual" || s === "conservative" || s === "balanced" || s === "free";
}
