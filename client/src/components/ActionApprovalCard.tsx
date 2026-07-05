import { useState } from "react";
import type { PendingAction, DispatchItem } from "../lib/api";

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
  onApprove: (items?: DispatchItem[]) => void;
  onReject: () => void;
}) {
  const high = action.risk === "high";
  const isDispatch = action.kind === "dispatch" && Array.isArray(action.parsedItems) && action.parsedItems.length > 0;

  const [itemStates, setItemStates] = useState<Array<{ checked: boolean; editedTask: string }>>(() =>
    (action.parsedItems ?? []).map((item) => ({ checked: true, editedTask: item.task }))
  );

  const checkedCount = itemStates.filter((s) => s.checked).length;

  function handleApprove() {
    if (isDispatch) {
      const checkedItems = (action.parsedItems ?? [])
        .filter((_, i) => itemStates[i]?.checked)
        .map((item, i) => ({ ...item, task: itemStates[i]?.editedTask ?? item.task }));
      onApprove(checkedItems.length > 0 ? checkedItems : undefined);
    } else {
      onApprove();
    }
  }

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

      {isDispatch && (
        <div className="mb-3 space-y-2">
          <div className="text-zinc-400 text-xs mb-1">
            已選 {checkedCount}/{action.parsedItems!.length} 項
          </div>
          {action.parsedItems!.map((item, i) => {
            const state = itemStates[i] ?? { checked: true, editedTask: item.task };
            return (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-zinc-900/60 border border-zinc-800">
                <input
                  type="checkbox"
                  checked={state.checked}
                  onChange={(e) =>
                    setItemStates((prev) =>
                      prev.map((s, idx) => idx === i ? { ...s, checked: e.target.checked } : s)
                    )
                  }
                  className="mt-0.5 flex-shrink-0"
                />
                <div className="flex-1 space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300 text-[10px]">
                      {item.agentId}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        item.mode === "execute"
                          ? "bg-amber-700/30 text-amber-300"
                          : "bg-sky-700/30 text-sky-300"
                      }`}
                    >
                      {item.mode}
                    </span>
                    {state.checked && (
                      <span className="text-zinc-500 text-[10px]">
                        {item.mode === "consult" ? "約 2-4 分" : "最長 30 分"}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={state.editedTask}
                    disabled={!state.checked}
                    onChange={(e) =>
                      setItemStates((prev) =>
                        prev.map((s, idx) => idx === i ? { ...s, editedTask: e.target.value } : s)
                      )
                    }
                    className="w-full bg-zinc-800 rounded px-2 py-1 text-zinc-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:opacity-40"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={handleApprove}
          className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy ? "處理中…" : `✅ 核可${isDispatch ? `（${checkedCount} 項）` : ""}`}
        </button>
        <button
          disabled={busy}
          onClick={onReject}
          className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40"
        >
          {isDispatch ? "全部拒絕" : "拒絕"}
        </button>
      </div>
    </div>
  );
}
