/**
 * dispatchLedger.ts — 單項派工的「台帳記帳 + 員工化推播」共用包裝層。
 *
 * 動機：系統原有兩套派工執行器，只有手動核可路徑（executeDispatch）會記台帳、發推播；
 * 自主迴圈路徑（runDispatchByMode）完全不碰，導致自走模式下在途面板一片空白、手機收不到
 * 單項交辦通知。本檔把「一項派工的生命週期記帳」收攏成 ledgerBegin/ledgerFinish 兩個原子，
 * 讓兩條路徑共用同一套語意：
 *   - 開始：createDelegation（status=running）
 *   - 結束：finishDelegation（ok→done、其餘→failed），並回填最後一次嘗試的 subSessionId
 *   - execute 項結束時 notify（fire-and-forget）；consult 不推——與手動路徑行為對齊
 *
 * 綁定紀律：用明確的 delegationId（create 拿到、finish 用同一個）綁生命週期，
 * 不沿用「agentId 比對」的舊缺陷（同 agent 重複派工時會誤配）。
 *
 * 記帳/推播都是旁路：任何失敗都以 try/catch 吞掉，絕不阻斷派工主流程。
 */
import type { DispatchItem } from "./dispatchParser.js";
import { createDelegation, finishDelegation, type DelegationMode } from "./store/delegations.js";
import { notify, type NotifyEvent } from "./notifier.js";
import { loadAgents } from "./agentLoader.js";

/** 記帳脈絡：自主迴圈把 run 的 sessionId/workspaceId/runId 傳進來；未提供時完全不記帳。 */
export interface DispatchLedgerContext {
  pmSessionId: string;
  workspaceId: string;
  /** 供追蹤/日誌；delegations schema 目前無 runId 欄位，故不落庫。 */
  runId?: string;
}

/** 記帳/推播的最小依賴面，供測試注入 spy；正式碼綁真 store/notifier/agentLoader。 */
export interface DispatchLedgerDeps {
  createDelegation: (input: {
    pmSessionId: string;
    workspaceId: string;
    agentId: string;
    mode: DelegationMode;
    task: string;
    subSessionId?: string;
  }) => string;
  finishDelegation: (id: string, result: { status: "done" | "failed"; resultExcerpt?: string; subSessionId?: string }) => void;
  notify: (evt: NotifyEvent) => void;
  nameOf: (agentId: string) => string;
}

function defaultNameOf(agentId: string): string {
  try {
    return loadAgents().find((a) => a.id === agentId)?.name ?? agentId;
  } catch {
    return agentId;
  }
}

/** 預設依賴：真 store 記帳、真 Telegram 推播（fire-and-forget）、真團隊清單解析顯示名。 */
export const defaultLedgerDeps: DispatchLedgerDeps = {
  createDelegation,
  finishDelegation,
  notify: (evt) => { void notify(evt); },
  nameOf: defaultNameOf,
};

function toDelegationMode(mode: DispatchItem["mode"]): DelegationMode {
  return mode === "execute" ? "execute" : "consult";
}

/**
 * 開始一項派工的記帳：建一筆 running delegation，回 delegationId。
 * - ctx 為 undefined → 不記帳、回 undefined（自主路徑未提供脈絡時的向後相容出口）。
 * - subSessionId 可選：非同步 execute 在建 handle 後即知，故 create 時就能寫；
 *   同步 consult/execute 建立時還不知道，留給 ledgerFinish 回填。
 * - 記帳失敗吞掉、回 undefined（派工照跑）。
 */
export function ledgerBegin(
  ctx: DispatchLedgerContext | undefined,
  item: DispatchItem,
  ledger: DispatchLedgerDeps = defaultLedgerDeps,
  subSessionId?: string,
): string | undefined {
  if (!ctx) return undefined;
  try {
    return ledger.createDelegation({
      pmSessionId: ctx.pmSessionId,
      workspaceId: ctx.workspaceId,
      agentId: item.agentId,
      mode: toDelegationMode(item.mode),
      task: item.task,
      subSessionId,
    });
  } catch {
    return undefined;
  }
}

/**
 * 結束一項派工的記帳與推播：
 * - delegId 有值 → finishDelegation（ok→done、其餘→failed），回填 subSessionId（最後一次嘗試的）。
 * - execute 項 → notify（交辦完成/交辦失敗）；consult 不推——與手動路徑一致。
 * - 兩者皆旁路：失敗吞掉，不影響呼叫端。
 */
export function ledgerFinish(
  delegId: string | undefined,
  item: DispatchItem,
  outcome: { ok: boolean; output: string; subSessionId?: string },
  ledger: DispatchLedgerDeps = defaultLedgerDeps,
): void {
  if (delegId) {
    try {
      ledger.finishDelegation(delegId, {
        status: outcome.ok ? "done" : "failed",
        resultExcerpt: outcome.output ? outcome.output.slice(0, 500) : undefined,
        subSessionId: outcome.subSessionId || undefined,
      });
    } catch { /* 記帳失敗不阻斷 */ }
  }
  if (item.mode === "execute") {
    try {
      ledger.notify({
        kind: outcome.ok ? "交辦完成" : "交辦失敗",
        title: `${ledger.nameOf(item.agentId)}：${item.task.slice(0, 60)}`,
        body: outcome.output.slice(0, 300),
      });
    } catch { /* 推播失敗不阻斷 */ }
  }
}
