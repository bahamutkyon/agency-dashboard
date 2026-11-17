import { useEffect, useState } from "react";
import { api, type SessionHandoff } from "../lib/api";

interface Props {
  sessionId: string;
  onOpenSession?: (sessionId: string, agentId: string, title: string) => void;
}

/** 對話頂端「已帶入上一場重點」：開新話題時讓你看到專案經理拿到了什麼，無關就按「不要帶入」。 */
export function HandoffCard({ sessionId, onOpenSession }: Props) {
  const [h, setH] = useState<SessionHandoff | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let alive = true;
    api.sessionHandoff(sessionId).then((r) => { if (alive) setH(r.handoff); }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);
  if (!h) return null;

  const drop = async () => {
    try { await api.dropSessionHandoff(sessionId); setH(null); }
    catch { alert("取消帶入失敗，請稍後再試"); }
  };

  return (
    <div className="px-4 py-2 border-b border-sky-800/30 bg-sky-950/20 text-xs">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="text-sky-300 hover:text-sky-200">
          {open ? "▾" : "▸"} 🔁 已帶入上一場「{h.fromTitle}」的重點
        </button>
        <span className="flex-1" />
        {onOpenSession && (
          <button onClick={() => onOpenSession(h.fromId, "agents-orchestrator", h.fromTitle)} className="text-zinc-400 hover:text-zinc-200">看原對話</button>
        )}
        <button onClick={drop} className="text-zinc-500 hover:text-rose-300" title="這次的話題跟上一場無關">不要帶入</button>
      </div>
      {open && (
        <div className="mt-1 text-zinc-300">
          {h.source === "excerpt" && <span className="text-zinc-500 mr-1">（尚未整理，以下為原文節錄）</span>}
          {h.summary}
        </div>
      )}
    </div>
  );
}
