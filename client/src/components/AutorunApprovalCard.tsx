/**
 * G1 — 一鍵起自走確認卡
 * 收到 autonomy:event(kind:"autorun:pending") 時在聊天側欄彈出此卡；
 * 使用者按「確認啟動」→ 呼叫 onConfirm()（onConfirm 內呼叫 api.autonomyStart）；
 * 按「取消」→ 呼叫 onDismiss() 關閉卡片，不起 run。
 */
export function AutorunApprovalCard({
  goal,
  busy,
  onConfirm,
  onDismiss,
}: {
  goal: string;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-2 rounded border border-sky-700/50 bg-sky-950/30 p-3 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-sky-600/30 px-1.5 text-sky-300">自走模式</span>
        <span className="text-sky-400">PM 建議啟動自走</span>
      </div>
      <div className="mb-3 text-zinc-200">{goal}</div>
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={onConfirm}
          aria-label="確認啟動"
          className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy ? "處理中…" : "確認啟動"}
        </button>
        <button
          disabled={busy}
          onClick={onDismiss}
          aria-label="取消"
          className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40"
        >
          取消
        </button>
      </div>
    </div>
  );
}
