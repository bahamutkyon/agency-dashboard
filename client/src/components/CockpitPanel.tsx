import { useEffect, useState } from "react";
import { api, type BriefingRow, type BriefingItem } from "../lib/api";

interface Props {
  onDiscuss: (item: BriefingItem) => void;
}

export function CockpitPanel({ onDiscuss }: Props) {
  const [row, setRow] = useState<BriefingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<{ status: string; raw: string; at: number } | undefined>(undefined);

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

  if (!row) return <div className="p-6 text-zinc-500">尚無今日簡報。<button onClick={refresh} className="underline ml-2">立即生成</button></div>;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">🧭 今日總管簡報</h1>
        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <span>更新：{new Date(row.createdAt).toLocaleString("zh-TW", { hour12: false })}</span>
          <button onClick={refresh} disabled={busy} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔄 再想一次</button>
        </div>
      </div>

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

      {row.content?.sections.map((sec, i) => (
        <section key={i} className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-300">{sec.title}</h2>
          {sec.items.map((it, j) => (
            <div key={j} className="rounded-lg border border-zinc-800 bg-panel p-3">
              <div className="font-medium text-sm">{it.title}</div>
              <div className="text-sm text-zinc-400 mt-1 whitespace-pre-wrap">{it.body}</div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => onDiscuss(it)} className="text-xs px-2 py-1 rounded bg-accent hover:bg-violet-500 text-white">💬 展開討論</button>
                {it.action && (
                  <button onClick={() => applyAction(i, j, it)} disabled={busy} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40">
                    照建議{it.action.type === "approve" ? "批准" : "駁回"}（{it.action.proposalIds.length}）
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
