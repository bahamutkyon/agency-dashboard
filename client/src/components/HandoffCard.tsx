import { useEffect, useState } from "react";
import { api, type SessionHandoff } from "../lib/api";

interface Props {
  sessionId: string;
  onOpenSession?: (sessionId: string, agentId: string, title: string) => void;
  /** 新對話還沒有使用者訊息時才可編輯交接單 */
  canEdit?: boolean;
  /** 改變時重抓（收到 session:handoff 後用） */
  reloadKey?: number;
}

/** 伺服器錯誤訊息：ApiError.message 是回應原文（通常是 {"error": "..."}） */
function serverError(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch { /* 非 JSON */ }
  return raw || null;
}

/**
 * 對話頂端交接卡：
 * - 新對話：「已帶入上一場重點／交接單」，無關就按「不要帶入」；交接單（doc）可在開聊前編輯。
 * - 來源對話：「已交接 → 新對話」連結。
 */
export function HandoffCard({ sessionId, onOpenSession, canEdit, reloadKey }: Props) {
  const [h, setH] = useState<SessionHandoff | null>(null);
  const [to, setTo] = useState<{ id: string; title: string } | null>(null);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    setEditing(false);
    api.sessionHandoff(sessionId).then((r) => {
      if (!alive) return;
      setH(r.handoff);
      setTo(r.handedOffTo ?? null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId, reloadKey]);
  if (!h && !to) return null;

  const drop = async () => {
    try { await api.dropSessionHandoff(sessionId); setH(null); }
    catch { alert("取消帶入失敗，請稍後再試"); }
  };

  const save = async () => {
    if (!h) return;
    setSaving(true);
    try {
      await api.updateSessionHandoff(sessionId, draft);
      setH({ ...h, summary: draft });
      setEditing(false);
    } catch (e) {
      alert("儲存交接單失敗：" + (serverError(e) ?? "請稍後再試"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {to && (
        <div className="px-4 py-2 border-b border-emerald-800/30 bg-emerald-950/20 text-xs flex items-center gap-2">
          <span className="text-emerald-300">✅ 已交接 →</span>
          <button
            onClick={() => onOpenSession?.(to.id, "agents-orchestrator", to.title)}
            className="text-sky-300 hover:text-sky-200 underline truncate"
            title="打開接手的新對話"
          >{to.title}</button>
        </div>
      )}
      {h && (
        <div className="px-4 py-2 border-b border-sky-800/30 bg-sky-950/20 text-xs">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen((v) => !v)} className="text-sky-300 hover:text-sky-200">
              {open ? "▾" : "▸"} 🔁 已帶入上一場「{h.fromTitle}」的{h.source === "doc" ? "交接單" : "重點"}
            </button>
            <span className="flex-1" />
            {h.source === "doc" && canEdit && !editing && (
              <button onClick={() => { setDraft(h.summary); setEditing(true); setOpen(true); }} className="text-zinc-400 hover:text-zinc-200" title="開聊前可以修改交接單">編輯</button>
            )}
            {onOpenSession && (
              <button onClick={() => onOpenSession(h.fromId, "agents-orchestrator", h.fromTitle)} className="text-zinc-400 hover:text-zinc-200">看原對話</button>
            )}
            <button onClick={drop} className="text-zinc-500 hover:text-rose-300" title="這次的話題跟上一場無關">不要帶入</button>
          </div>
          {open && editing && (
            <div className="mt-1 space-y-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-200 font-mono"
              />
              <div className="flex gap-2">
                <button onClick={save} disabled={saving || !draft.trim()} className="text-sky-300 hover:text-sky-200 disabled:opacity-40">儲存</button>
                <button onClick={() => setEditing(false)} disabled={saving} className="text-zinc-500 hover:text-zinc-300">取消</button>
              </div>
            </div>
          )}
          {open && !editing && (
            <div className={"mt-1 text-zinc-300" + (h.source === "doc" ? " whitespace-pre-wrap" : "")}>
              {h.source === "excerpt" && <span className="text-zinc-500 mr-1">（尚未整理，以下為原文節錄）</span>}
              {h.summary}
            </div>
          )}
        </div>
      )}
    </>
  );
}
