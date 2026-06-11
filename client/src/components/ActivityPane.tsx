import { useEffect, useState } from "react";
import { api, type ActivityRow } from "../lib/api";
import { getSocket } from "../lib/socket";

const KIND_ICON: Record<string, string> = {
  tool_call: "🔧",
  tool_result: "↳",
  run_started: "🎯",
  run_step: "▸",
  run_done: "🏁",
  action_pending: "⏳",
  action_approved: "✅",
  action_rejected: "⛔",
  dispatch: "🤝",
  schedule_fired: "⏰",
};

export function ActivityPane() {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [nextBefore, setNextBefore] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listActivity().then((res) => {
      if (!alive) return;
      setItems(res.items);
      setNextBefore(res.nextBefore);
      setLoading(false);
    }).catch(() => {
      if (alive) setLoading(false);
    });

    const socket = getSocket();
    const handler = (row: ActivityRow) => {
      setItems((prev) => [row, ...prev]);
    };
    socket.on("activity:event", handler);

    return () => {
      alive = false;
      socket.off("activity:event", handler);
    };
  }, []);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.listActivity({ before: nextBefore });
      setItems((prev) => [...prev, ...res.items]);
      setNextBefore(res.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-base">📋</span>
        <h2 className="text-sm font-semibold text-zinc-200">活動時間軸</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-zinc-500 text-sm">載入中…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-zinc-500 text-sm">尚無活動記錄</div>
        ) : (
          <ul className="divide-y divide-zinc-800/50">
            {items.map((item) => (
              <li key={item.id} className="px-4 py-2 text-sm hover:bg-zinc-900/40 transition-colors">
                <div className="flex items-start gap-2">
                  <span className="text-zinc-400 text-xs shrink-0 pt-0.5 w-16 text-right tabular-nums">
                    {new Date(item.ts).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0 w-5 text-center" title={item.kind}>
                    {KIND_ICON[item.kind] ?? "•"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span
                      className={
                        item.status === "error"
                          ? "text-rose-400"
                          : "text-zinc-200"
                      }
                    >
                      {item.summary}
                    </span>
                    {item.detail && (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-400 select-none">
                          {item.totalLen != null
                            ? `展開詳情（顯示前 2000 / 共 ${item.totalLen} 字）`
                            : "展開詳情"}
                        </summary>
                        <pre className="mt-1 text-xs text-zinc-400 whitespace-pre-wrap break-all bg-zinc-900 rounded p-2 max-h-48 overflow-y-auto">
                          {item.detail}
                        </pre>
                      </details>
                    )}
                  </div>
                  {item.kind && (
                    <span className="shrink-0 text-xs text-zinc-600 hidden sm:inline">
                      {item.kind}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && nextBefore && (
          <div className="px-4 py-3 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
            >
              {loadingMore ? "載入中…" : "載入更多"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
