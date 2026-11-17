import { useEffect, useMemo, useState } from "react";
import { api, type SessionRecord } from "../lib/api";
import { fmtRelative } from "../lib/relTime";
import { interactivePm, sessionHeading } from "../lib/sessionTitles";
import { sessionBadge } from "../lib/sessionStatus";

interface Props {
  onOpen: (s: SessionRecord) => void;
  onOpenLearning: () => void;
}

const DAY = 86_400_000;

/**
 * 整理掛單：本工作區所有沒結束的專案經理對話一次看完，勾選後「標記完成」或「先擱著」。
 * 擱著＝還沒想開始，不佔「接續上次」；擱置中可隨時拉回。不會自動處理任何對話。
 */
export function TidyPanel({ onOpen, onOpenLearning }: Props) {
  const [all, setAll] = useState<SessionRecord[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [showParked, setShowParked] = useState(false);
  const [learningPending, setLearningPending] = useState(0);

  useEffect(() => {
    api.sessions().then((x) => setAll(interactivePm(x))).catch(() => {});
    api.learningProposals().then((p) => setLearningPending(p.length)).catch(() => {});
  }, []);

  const open = useMemo(() => all.filter((s) => s.state !== "done" && s.state !== "parked").sort((a, b) => b.updatedAt - a.updatedAt), [all]);
  const parked = useMemo(() => all.filter((s) => s.state === "parked").sort((a, b) => b.updatedAt - a.updatedAt), [all]);

  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pickOlderThan30 = () => setPicked(new Set(open.filter((s) => Date.now() - s.updatedAt > 30 * DAY).map((s) => s.id)));

  const apply = async (ids: string[], state: "done" | "parked" | null) => {
    if (!ids.length || busy) return;
    setBusy(true);
    const ok: string[] = [];
    for (const id of ids) {
      try { await api.setSessionState(id, state); ok.push(id); } catch { /* 個別失敗保留原狀 */ }
    }
    setAll((prev) => prev.map((s) => (ok.includes(s.id) ? { ...s, state } : s)));
    setPicked(new Set());
    setBusy(false);
    if (ok.length < ids.length) alert(`有 ${ids.length - ok.length} 場沒更新成功，請稍後再試`);
  };

  const row = (s: SessionRecord, parkedRow: boolean) => {
    const badge = sessionBadge(s);
    const stopped = s.stoppedAt || s.lastSnippet;
    return (
      <div key={s.id} className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-panel p-3">
        {!parkedRow && (
          <input type="checkbox" className="mt-1" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`選取 ${sessionHeading(s)}`} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <button onClick={() => onOpen(s)} className="text-sm font-medium text-left hover:underline">{sessionHeading(s)}</button>
            {badge && !parkedRow && <span className={`text-[11px] px-1.5 py-0.5 rounded ${badge.className}`}>{badge.icon} {badge.label}</span>}
            <span className="text-[11px] text-zinc-500">{fmtRelative(s.updatedAt)}{s.messageCount != null ? ` · ${s.messageCount} 則` : ""}</span>
          </div>
          {stopped && <div className="text-xs text-zinc-400 line-clamp-2 mt-0.5"><span className="text-zinc-500 mr-1">停在：</span>{stopped}</div>}
        </div>
        {parkedRow && (
          <button onClick={() => apply([s.id], null)} disabled={busy} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shrink-0">↩ 拉回</button>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4 overflow-y-auto h-full">
      <div>
        <h1 className="text-lg font-semibold">🧹 整理掛單</h1>
        <p className="text-xs text-zinc-500 mt-1">這個工作區還沒結束的專案經理對話。講完或不做的標「完成」，還沒想開始的「先擱著」——擱著的不會出現在「接續上次」，隨時可以拉回。</p>
      </div>

      {learningPending > 0 && (
        <div className="flex items-center justify-between text-xs rounded border border-zinc-800 p-2 text-zinc-400">
          <span>🎓 學習審核還有 {learningPending} 條待處理</span>
          <button onClick={onOpenLearning} className="text-zinc-300 hover:text-white underline">去審核</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 sticky top-0 bg-ink py-2 z-10">
        <span className="text-sm text-zinc-300">未結束（{open.length}）</span>
        <span className="flex-1" />
        <button onClick={pickOlderThan30} className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">勾選超過 30 天的</button>
        {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300">取消勾選</button>}
        <button onClick={() => apply([...picked], "done")} disabled={!picked.size || busy} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40">✓ 標記完成（{picked.size}）</button>
        <button onClick={() => apply([...picked], "parked")} disabled={!picked.size || busy} className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-40">💤 先擱著（{picked.size}）</button>
      </div>

      <div className="space-y-2">
        {open.map((s) => row(s, false))}
        {open.length === 0 && <div className="text-sm text-zinc-500">沒有未結束的對話 🎉</div>}
      </div>

      {parked.length > 0 && (
        <div>
          <button onClick={() => setShowParked((v) => !v)} className="text-sm text-zinc-400 hover:text-zinc-200">
            {showParked ? "▾" : "▸"} 💤 擱置中（{parked.length}）
          </button>
          {showParked && <div className="space-y-2 mt-2">{parked.map((s) => row(s, true))}</div>}
        </div>
      )}
    </div>
  );
}
