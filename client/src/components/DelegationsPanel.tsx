import { useState, useCallback, useEffect } from "react";
import { getSocket } from "../lib/socket";
import { getActiveWorkspace } from "../lib/workspace";
import { api, type DelegationWithProgress } from "../lib/api";
import { useVisiblePolling } from "../hooks/useVisiblePolling";

interface LimiterStats {
  running: number;
  queued: number;
  backoffUntil: number;
  limit: number;
}

export function DelegationsPanel({ onOpenSession }: { onOpenSession?: (sessionId: string, agentId: string, title: string) => void }) {
  const [items, setItems] = useState<DelegationWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [limiter, setLimiter] = useState<LimiterStats | null>(null);

  const reload = useCallback(() => {
    api.listDelegations({ workspace: getActiveWorkspace() ?? undefined, inFlight: true })
      .then((data) => { setItems(data); setLoading(false); setError(null); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : "載入失敗"); setLoading(false); });
    // 搭便車：同步輪詢背景限流狀態
    fetch("/api/system/limiter").then((r) => r.json()).then((d: LimiterStats) => setLimiter(d)).catch(() => {});
  }, []);

  useVisiblePolling(reload, 5000);

  // Socket: delegation:progress event updates matching item
  useEffect(() => {
    const sock = getSocket();
    const onProgress = (update: { id: string; progress: DelegationWithProgress["progress"] }) => {
      setItems((prev) => prev.map((item) => item.id === update.id ? { ...item, progress: update.progress } : item));
    };
    sock.on("delegation:progress", onProgress);
    return () => { sock.off("delegation:progress", onProgress); };
  }, []);

  const handleCancel = useCallback(async (id: string) => {
    setCancellingId(id);
    try {
      await api.cancelDelegation(id);
      reload();
    } catch (e: unknown) {
      console.warn("[DelegationsPanel] cancel failed:", e);
    } finally {
      setCancellingId(null);
    }
  }, [reload]);

  function relativeTime(ts: number | null): string {
    if (!ts) return "—";
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff} 秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
    return `${Math.floor(diff / 3600)} 小時前`;
  }

  const STATUS_CHIP: Record<string, string> = {
    running: "bg-emerald-700/40 text-emerald-300 animate-pulse",
    queued: "bg-sky-700/40 text-sky-300",
    done: "bg-zinc-700/40 text-zinc-400",
    failed: "bg-rose-700/40 text-rose-300",
    orphaned: "bg-amber-700/40 text-amber-300",
  };

  // Limiter status display helpers
  const limiterLine = limiter ? (() => {
    const isBackoff = limiter.backoffUntil > Date.now();
    if (isBackoff) {
      const hhmm = new Date(limiter.backoffUntil).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
      return { text: `⏸ 限流退避中，至 ${hhmm}`, warn: true };
    }
    const parts: string[] = [];
    if (limiter.running > 0 || limiter.queued > 0) {
      parts.push(`背景槽 ${limiter.running}/${limiter.limit} 使用中`);
    }
    if (limiter.queued > 0) parts.push(`排隊 ${limiter.queued}`);
    return parts.length ? { text: parts.join(" · "), warn: false } : null;
  })() : null;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-200">🚀 在途交辦</h2>
          <button onClick={reload} className="text-xs text-zinc-500 hover:text-zinc-300">重整</button>
        </div>
        {limiterLine && (
          <div className={`text-[11px] ${limiterLine.warn ? "text-amber-400 font-medium" : "text-zinc-500"}`}>
            {limiterLine.text}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <div className="text-zinc-500 text-sm">載入中…</div>}
        {error && <div className="text-rose-400 text-sm">{error}</div>}
        {!loading && items.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-8">目前沒有在途交辦項目</div>
        )}
        {items.map((item) => (
          <div key={item.id} className="border border-zinc-800 rounded p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">{item.agentId}</span>
              <span className={`px-1.5 py-0.5 rounded ${item.mode === "execute" ? "bg-amber-700/30 text-amber-300" : "bg-sky-700/30 text-sky-300"}`}>
                {item.mode}
              </span>
              <span className={`px-1.5 py-0.5 rounded ${STATUS_CHIP[item.status] ?? "bg-zinc-700/40 text-zinc-400"}`}>
                {item.status}
              </span>
            </div>
            <div className="text-zinc-300">{item.task.slice(0, 60)}{item.task.length > 60 ? "…" : ""}</div>
            {item.progress && (
              <div className="text-zinc-500 space-y-0.5">
                <div>🔧 {item.progress.toolCalls} 工具呼叫 · 最後活動：{relativeTime(item.progress.lastActivityAt)}</div>
                {item.progress.lastAction && <div className="truncate">↪ {item.progress.lastAction}</div>}
              </div>
            )}
            <div className="flex items-center gap-2">
              {item.subSessionId && onOpenSession && (
                <button
                  onClick={() => onOpenSession(item.subSessionId!, item.agentId, `${item.agentId} 執行中`)}
                  className="text-sky-400 hover:text-sky-300 underline"
                >開啟對話</button>
              )}
              {item.status === "running" && item.mode === "execute" && (
                <button
                  disabled={cancellingId === item.id}
                  onClick={() => handleCancel(item.id)}
                  className="px-2 py-0.5 rounded bg-rose-900/40 hover:bg-rose-800/60 text-rose-300 disabled:opacity-40"
                >
                  {cancellingId === item.id ? "取消中…" : "取消"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
