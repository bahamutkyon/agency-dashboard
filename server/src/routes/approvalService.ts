/**
 * approvalService.ts — 待批動作核可/拒絕的共用核心
 *
 * 從 routes/autonomy.ts 抽出，HTTP 路由與 Telegram 雙向批准共用同一份分流與守衛，
 * 杜絕「第三條核可路徑」。行為與抽取前的 route 完全一致（既有 route 測試為證）：
 *  - 手動派工（kind=dispatch 且無 runId）：走 CAS decidePendingAction + executeDispatch / 拒絕餵回 PM。
 *  - 其餘（自主 run 名下的 pending）：交給 autonomyRunner.approveAction / rejectAction。
 */
import { agentManager } from "../agentManager.js";
import { executeDispatch } from "./sessions.js";
import { approveAction, rejectAction } from "../autonomyRunner.js";
import { getPendingAction, decidePendingAction, markActionExecuted } from "../store/autonomy.js";
import { parseDispatchMarker, type DispatchItem } from "../dispatchParser.js";

/**
 * B5：比對「原 pending 完整清單」（由 pa.detail round-trip 解析）與「實際送去執行的 items」，
 * 若送去的少了某些 agent，回傳一句給 PM 的說明；完整核可則回 undefined（不加雜訊）。
 */
export function computePartialApprovalNote(detail: string | undefined, sentItems: DispatchItem[]): string | undefined {
  const plan = parseDispatchMarker(`=== DISPATCH ===\n${detail ?? ""}\n=== END DISPATCH ===`);
  const original = plan?.items ?? [];
  if (original.length === 0) return undefined;
  const sentIds = new Set(sentItems.map((i) => i.agentId));
  const removed = original.filter((i) => !sentIds.has(i.agentId));
  if (removed.length === 0) return undefined;
  const approvedNames = sentItems.map((i) => i.agentId).join("、") || "（無）";
  const removedNames = removed.map((i) => i.agentId).join("、");
  return `使用者僅核可其中 ${sentItems.length} 項：${approvedNames}；${removedNames} 未核可`;
}

export type ApprovalResult =
  | { status: "not_found" }
  | { status: "already_handled" }
  | { status: "approved"; summary: string }
  | { status: "rejected"; summary: string };

/**
 * 核可一個待批動作。同步回傳決定結果（executeDispatch/approveAction 為 fire-and-forget，
 * 與抽取前的 route 一致）。
 * @param items 手動派工的部分核可 items（前端帶來）；無則 fallback 解析 pa.detail。
 */
export function approvePendingAction(actionId: string, io: any, items?: DispatchItem[]): ApprovalResult {
  const pa = getPendingAction(actionId);
  if (!pa) return { status: "not_found" };

  // 手動派工（kind=dispatch 且無 runId，非自主 run）→ 走 executeDispatch。
  if (pa.kind === "dispatch" && !pa.runId) {
    // body.items 優先（前端部分核可）；無則 fallback 到原始 detail（向後相容）
    let resolved: DispatchItem[];
    if (items && Array.isArray(items) && items.length > 0) {
      resolved = items;
    } else {
      const plan = parseDispatchMarker(`=== DISPATCH ===\n${pa.detail ?? ""}\n=== END DISPATCH ===`);
      resolved = plan?.items ?? [];
    }
    // A4：CAS 防重複批准——只有首次（status 仍 pending）才真的執行；已處理過回 already_handled。
    if (!decidePendingAction(pa.id, "approved")) {
      return { status: "already_handled" };
    }
    // B5：部分核可 → 附一句讓 PM 知道哪些沒被核可。
    const approvalNote = computePartialApprovalNote(pa.detail, resolved);
    executeDispatch(pa.sessionId, resolved, io, { approvalNote })
      .then((out) => markActionExecuted(pa.id, `consult ${out.consulted.length} 項、execute ${out.executing.length} 項`))
      .catch((e: any) => { console.warn("[approval] executeDispatch", e?.message); markActionExecuted(pa.id, String(e?.message || e), false); });
    return { status: "approved", summary: pa.summary };
  }

  // 自主 run 名下的 pending → autonomyRunner（內部自帶 status/CAS 守衛）。
  approveAction(actionId).catch((e: any) => console.warn("[approval] approveAction", e?.message));
  return { status: "approved", summary: pa.summary };
}

/** 拒絕一個待批動作。 */
export function rejectPendingAction(actionId: string): ApprovalResult {
  const pa = getPendingAction(actionId);
  if (!pa) return { status: "not_found" };

  // 手動派工（kind=dispatch 且無 runId）→ CAS 標記 rejected + 餵回 PM。
  if (pa.kind === "dispatch" && !pa.runId) {
    // A4：CAS——已處理過（含「先批准又拒絕」的亂序）回 already_handled。
    if (!decidePendingAction(pa.id, "rejected")) {
      return { status: "already_handled" };
    }
    // A3：手動派工拒絕要讓 PM 知情。走 LLM 讓 PM 回應。
    agentManager.send(pa.sessionId, `使用者拒絕了這次派工（${pa.summary}）。請不要重複提出同一份派工；先詢問使用者顧慮或改換方案。`);
    return { status: "rejected", summary: pa.summary };
  }

  // 自主 run 名下的 pending → autonomyRunner。
  rejectAction(actionId).catch((e: any) => console.warn("[approval] rejectAction", e?.message));
  return { status: "rejected", summary: pa.summary };
}
