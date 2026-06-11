import type { PendingAction } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  plan: "執行計畫",
  dispatch: "派工",
  external_send: "對外發送",
  destructive: "破壞性操作",
  spend: "花費/交易",
  need_input: "需要補充",
  next_step: "下一步",
  goal_done: "完成",
};

export function ActionApprovalCard({
  action,
  busy,
  onApprove,
  onReject,
}: {
  action: PendingAction;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const high = action.risk === "high";
  return (
    <div
      className={`mb-2 rounded border p-3 text-xs ${
        high
          ? "border-amber-600/50 bg-amber-950/30"
          : "border-sky-700/50 bg-sky-950/30"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded px-1.5 ${
            high
              ? "bg-amber-600/30 text-amber-300"
              : "bg-sky-600/30 text-sky-300"
          }`}
        >
          {KIND_LABEL[action.kind] ?? action.kind}
        </span>
        {high && <span className="text-amber-400">⚠ 高風險，需核可</span>}
      </div>
      <div className="mb-1 text-zinc-200">{action.summary}</div>
      {action.detail && (
        <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap text-zinc-400">
          {action.detail}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={onApprove}
          className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy ? "處理中…" : "✅ 核可"}
        </button>
        <button
          disabled={busy}
          onClick={onReject}
          className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40"
        >
          拒絕
        </button>
      </div>
    </div>
  );
}
