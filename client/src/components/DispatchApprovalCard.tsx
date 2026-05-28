interface DispatchItemView { agentId: string; mode: "consult" | "execute"; task: string; }

export function DispatchApprovalCard({
  items, busy, onApprove, onCancel,
}: {
  items: DispatchItemView[];
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-2 rounded border border-sky-700/50 bg-sky-950/30 p-3 text-xs">
      <div className="mb-2 text-zinc-300">專案經理想派工給 {items.length} 位（先問再跑，按下才執行）：</div>
      <ul className="mb-2 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={`shrink-0 rounded px-1.5 ${it.mode === "execute" ? "bg-amber-600/30 text-amber-300" : "bg-sky-600/30 text-sky-300"}`}>
              {it.mode === "execute" ? "外包執行" : "請教"}
            </span>
            <span className="font-mono text-zinc-400">{it.agentId}</span>
            <span className="text-zinc-300">— {it.task}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button disabled={busy} onClick={onApprove}
          className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40">
          {busy ? "派工中…" : "✅ 派工"}
        </button>
        <button disabled={busy} onClick={onCancel}
          className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40">
          取消
        </button>
      </div>
    </div>
  );
}
