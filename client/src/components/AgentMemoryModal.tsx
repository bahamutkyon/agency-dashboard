import { useEffect, useState } from "react";
import { withWorkspace } from "../lib/workspace";

interface Props {
  sessionId: string;
  agentId: string;
  agentName: string;
  onClose: () => void;
}

interface MemoryRecord {
  workspaceId: string;
  agentId: string;
  content: string;
  updatedAt: number;
  distilledFromSessionId: string | null;
}

export function AgentMemoryModal({ sessionId, agentId, agentName, onClose }: Props) {
  const [mem, setMem] = useState<MemoryRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [distilling, setDistilling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(withWorkspace(`/api/agent-memory?agentId=${encodeURIComponent(agentId)}`))
      .then((r) => r.json())
      .then((d: MemoryRecord) => { setMem(d); setDraft(d.content || ""); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [agentId]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await fetch(withWorkspace("/api/agent-memory"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, content: draft }),
      });
      setMsg("✓ 已儲存");
      load();
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2000);
    }
  };

  const distill = async () => {
    if (!confirm(`要從這場對話蒸餾出新版「${agentName} 對你的記憶」嗎?\n\n會用 Haiku 模型(很便宜),約 5-15 秒\n結果會【取代】目前的記憶,不是 append`)) return;
    setDistilling(true);
    setMsg(null);
    try {
      const r = await fetch(withWorkspace("/api/agent-memory/distill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, agentId }),
      });
      const d = await r.json();
      if (d.ok) {
        setMsg("✓ 蒸餾完成,記憶已更新");
        load();
      } else {
        setMsg("✗ 蒸餾失敗:" + (d.error || "未知錯誤"));
      }
    } catch (e: any) {
      setMsg("✗ 網路錯誤:" + e.message);
    } finally {
      setDistilling(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const clear = async () => {
    if (!confirm(`確定要清空「${agentName} 對你的記憶」?此動作無法復原。`)) return;
    await fetch(withWorkspace(`/api/agent-memory?agentId=${encodeURIComponent(agentId)}`), { method: "DELETE" });
    setDraft("");
    load();
    setMsg("✓ 已清空");
    setTimeout(() => setMsg(null), 2000);
  };

  const fmtUpdated = (ts: number) => {
    if (!ts) return "從未蒸餾";
    return new Date(ts).toLocaleString("zh-TW");
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-panel border border-zinc-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* header */}
        <div className="px-4 md:px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
          <div className="text-2xl">📝</div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-zinc-100 truncate">{agentName} 對你的記憶</div>
            <div className="text-[11px] text-zinc-500">
              最後更新:{fmtUpdated(mem?.updatedAt || 0)}
              {mem?.content && <span className="ml-2">· {mem.content.length} 字</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 px-2">×</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          {loading ? (
            <div className="text-center text-zinc-500 py-12">載入中…</div>
          ) : (
            <>
              <div className="text-[11px] text-zinc-500 mb-2 leading-relaxed">
                這是 <span className="text-zinc-300 font-medium">{agentName}</span> 在「目前工作區」累積的個人理解。新對話啟動時自動注入,讓 TA 不用每次都重新認識你。
                你可以手動編輯或叫 TA 從這場對話重新蒸餾。
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="(尚無記憶。蒸餾或手動寫進來吧。)

範例格式:
## 這位使用者是誰
- 傳產二代,本業外勞仲介
- 在做個人 IP 自媒體

## 進行中的專案
- [3 週衝刺] 已完成定位

## 偏好
- 偏好直接務實"
              />
              <div className="text-[10px] text-zinc-500 mt-1 text-right">
                上限 4000 字。超過會被截斷。
              </div>
            </>
          )}
        </div>

        {/* footer actions */}
        <div className="px-4 md:px-5 py-3 border-t border-zinc-800 bg-panel/40 flex items-center gap-2 flex-wrap">
          <button
            onClick={distill}
            disabled={distilling || loading}
            className="px-3 py-1.5 text-sm bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 disabled:opacity-40 text-white rounded flex items-center gap-1.5"
            title="從這場對話用 Haiku 蒸餾出新版記憶,取代目前內容"
          >
            {distilling ? "🔬 蒸餾中…" : "🔬 從這場對話蒸餾"}
          </button>
          <button
            onClick={save}
            disabled={saving || loading || draft === (mem?.content || "")}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded"
          >
            {saving ? "儲存中…" : "💾 儲存修改"}
          </button>
          <div className="flex-1" />
          {msg && <span className="text-xs text-zinc-300">{msg}</span>}
          <button
            onClick={clear}
            disabled={loading || !mem?.content}
            className="px-3 py-1.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded disabled:opacity-30"
            title="清空記憶,從零開始"
          >
            🗑 清空
          </button>
        </div>
      </div>
    </div>
  );
}
