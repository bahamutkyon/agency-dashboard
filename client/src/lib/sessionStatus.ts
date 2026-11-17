import type { SessionRecord } from "./api";

export interface Badge { icon: string; label: string; className: string }

/**
 * 對話狀態標籤。確定的訊號（正在跑、派工中、待批准）優先；
 * 「等你回覆」是閒置時模型判斷的，可能判斷錯，只當提示。
 */
export function sessionBadge(s: Partial<Pick<SessionRecord, "status" | "state" | "pendingCount" | "runningDelegations">>): Badge | null {
  if (s.status === "busy" || s.status === "starting") return { icon: "🟡", label: "執行中", className: "bg-amber-500/15 text-amber-300" };
  if ((s.runningDelegations ?? 0) > 0) return { icon: "🟡", label: "同事執行中", className: "bg-amber-500/15 text-amber-300" };
  if ((s.pendingCount ?? 0) > 0) return { icon: "🔴", label: `等你批准 ${s.pendingCount} 件`, className: "bg-rose-500/15 text-rose-300" };
  if (s.state === "done") return { icon: "⚪", label: "已結束", className: "bg-zinc-700/40 text-zinc-400" };
  if (s.state === "waiting_user") return { icon: "🟠", label: "等你回覆", className: "bg-orange-500/15 text-orange-300" };
  return null;
}
