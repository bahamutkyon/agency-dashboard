import { useEffect, useState } from "react";
import { api, type BriefingRow, type BriefingItem, type SessionRecord } from "../lib/api";
import { ResumeStrip } from "./ResumeStrip";
import { getActiveWorkspace } from "../lib/workspace";
import { scopeBriefing, type ScopedEntry } from "../lib/cockpitScope";

interface Props {
  onDiscuss: (item: BriefingItem) => void;
  /** 「接續上次」：本工作區可接續的專案經理對話 */
  resumable?: SessionRecord[];
  onResume?: (s: SessionRecord) => void;
  onNewTopic?: () => void;
  onMarkDone?: (s: SessionRecord) => void;
}

export function CockpitPanel({ onDiscuss, resumable = [], onResume, onNewTopic, onMarkDone }: Props) {
  const [row, setRow] = useState<BriefingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<{ status: string; raw: string; at: number } | undefined>(undefined);

  const [wsNames, setWsNames] = useState<Record<string, string>>({});
  const activeWs = getActiveWorkspace(); // 工作區切換時 App 會以 reloadKey 重掛本面板
  useEffect(() => {
    api.workspaces().then((ws) => setWsNames(Object.fromEntries(ws.map((w) => [w.id, w.name])))).catch(() => {});
  }, []);

  const load = () => api.cockpit().then((r) => { setRow(r.briefing); setLastError(r.lastError); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setBusy(true);
    try { const r = await api.cockpitRefresh(); setRow(r.briefing); }
    catch { alert("重新生成失敗，請稍後再試"); }
    finally { setBusy(false); }
  };

  const applyAction = async (sectionIdx: number, itemIdx: number, item: BriefingItem) => {
    if (!item.action || busy) return; // busy guard：防連點重複送出
    setBusy(true);
    try {
      const path = item.action.type === "approve" ? "bulk-approve" : "bulk-reject";
      const resp = await fetch(`/api/learning/proposals/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: item.action.proposalIds }),
      });
      if (!resp.ok) { alert("處理失敗，請稍後再試"); return; }
      const j = await resp.json().catch(() => ({}));
      // 就地從畫面移除該 item（伺服端 GET 也會自癒過濾，重新整理不會再出現）
      setRow((prev) => {
        if (!prev?.content) return prev;
        const sections = prev.content.sections.map((s, si) =>
          si === sectionIdx ? { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) } : s);
        return { ...prev, content: { ...prev.content, sections } };
      });
      const okN = j.ok ?? item.action.proposalIds.length;
      alert(`已${item.action.type === "approve" ? "批准" : "駁回"} ${okN} 條` + (j.fail ? `，失敗 ${j.fail} 條` : ""));
    } finally { setBusy(false); }
  };

  const scoped = row?.content ? scopeBriefing(row.content.sections, activeWs) : null;

  const renderItem = ({ item: it, sectionIdx, itemIdx }: ScopedEntry, foreign: boolean) => {
    const wsName = it.workspaceId ? (wsNames[it.workspaceId] || it.workspaceId) : "";
    return (
      <div key={`${sectionIdx}-${itemIdx}`} className="rounded-lg border border-zinc-800 bg-panel p-3">
        {foreign && <div className="text-[11px] text-zinc-500 mb-1">📁 {wsName}</div>}
        <div className="font-medium text-sm">{it.title}</div>
        <div className="text-sm text-zinc-400 mt-1 whitespace-pre-wrap">{it.body}</div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => onDiscuss(it)} className="text-xs px-2 py-1 rounded bg-accent hover:bg-violet-500 text-white">
            {foreign ? `↪ 切到「${wsName}」討論` : "💬 展開討論"}
          </button>
          {it.action && (
            <button onClick={() => applyAction(sectionIdx, itemIdx, it)} disabled={busy} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40">
              照建議{it.action.type === "approve" ? "批准" : "駁回"}（{it.action.proposalIds.length}）
            </button>
          )}
        </div>
      </div>
    );
  };

  // 放在「尚無簡報」判斷之前也要顯示：接續上次不依賴簡報
  const resumeStrip = onResume && onNewTopic && onMarkDone
    ? <ResumeStrip sessions={resumable} onResume={onResume} onNewTopic={onNewTopic} onMarkDone={onMarkDone} /> : null;

  if (!row) return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {resumeStrip}
      <div className="text-zinc-500">尚無今日簡報。<button onClick={refresh} className="underline ml-2">立即生成</button></div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">🧭 今日總管簡報</h1>
        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <span>更新：{new Date(row.createdAt).toLocaleString("zh-TW", { hour12: false })}</span>
          <button onClick={refresh} disabled={busy} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔄 再想一次</button>
        </div>
      </div>

      {resumeStrip}

      {lastError && (
        <div className="text-xs text-amber-400 border border-amber-800/40 rounded p-2">
          ⚠️ 最近一次自動更新失敗（{lastError.status}），以下為上一份可用簡報
        </div>
      )}

      {row.status !== "ok" && (
        <div className="text-xs text-amber-400 border border-amber-800/40 rounded p-2">
          簡報格式待修（status={row.status}），以下為原始輸出：
          <pre className="whitespace-pre-wrap mt-1 text-zinc-300">{row.raw.slice(0, 4000)}</pre>
        </div>
      )}

      {scoped && scoped.current.map((sec, i) => (
        <section key={i} className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-300">{sec.title}</h2>
          {sec.entries.map((e) => renderItem(e, false))}
        </section>
      ))}

      {scoped && scoped.current.length === 0 && (
        <div className="text-sm text-zinc-500">今天的簡報沒有「{wsNames[activeWs] || "本工作區"}」的項目。</div>
      )}

      {scoped && scoped.others.length > 0 && (
        <details className="rounded-lg border border-zinc-800/60 p-3">
          <summary className="text-sm text-zinc-500 cursor-pointer">其他工作區的項目（{scoped.others.length}）</summary>
          <div className="space-y-2 mt-2 opacity-80">{scoped.others.map((e) => renderItem(e, true))}</div>
        </details>
      )}
    </div>
  );
}
