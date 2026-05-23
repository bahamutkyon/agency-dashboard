import { useEffect, useState } from "react";
import { api, type AgentMeta, type LearningProposal } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  fact: "📌 關於你",
  craft: "🛠️ 手藝",
  domain: "🌐 領域新知",
  calibration: "🎯 回饋校準",
};

export function LearningQueuePanel({ agents }: { agents: AgentMeta[] }) {
  const [proposals, setProposals] = useState<LearningProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const reload = () =>
    api.learningProposals().then((ps) => {
      setProposals(ps);
      // clear any selected ids that are no longer in list
      setSelected((prev) => {
        const ids = new Set(ps.map((p) => p.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    }).catch(() => {});

  useEffect(() => { reload(); }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  const decide = async (p: LearningProposal, action: "approve" | "reject") => {
    setBusy(p.id);
    try {
      if (action === "approve") await api.approveLearning(p.id);
      else await api.rejectLearning(p.id);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      setSelected((prev) => { const next = new Set(prev); next.delete(p.id); return next; });
    } catch (e: any) {
      alert(`操作失敗：${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(proposals.map((p) => p.id)));
  const clearSelect = () => setSelected(new Set());

  const bulkAction = async (action: "approve" | "reject") => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const endpoint =
        action === "approve"
          ? "/api/learning/proposals/bulk-approve"
          : "/api/learning/proposals/bulk-reject";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: r.statusText }));
        alert(`批次操作失敗：${e?.error || r.statusText}`);
        return;
      }
      const d = await r.json();
      if (d.fail > 0 && d.errors?.length) {
        console.warn("[bulk] partial fail:", d.errors);
      }
      setSelected(new Set());
      await reload();
    } catch (e: any) {
      alert(`批次操作失敗：${e?.message || e}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const selCount = selected.size;
  const allSelected = proposals.length > 0 && selCount === proposals.length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">🧠 學習審核佇列</h2>
          <p className="text-xs text-zinc-500 mt-1">
            agent 提出的學習成果。批准後才會寫進該 agent 的能力 / 工作區檔案；拒絕的不再重複出現。
          </p>
        </div>

        {/* Bulk action toolbar */}
        {proposals.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={allSelected ? clearSelect : selectAll}
                className="rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900"
              />
              {allSelected ? "取消全選" : `全選本頁（${proposals.length} 條）`}
            </label>

            {selCount > 0 && (
              <>
                <span className="text-xs text-zinc-500">已選 {selCount} 條</span>
                <button
                  disabled={bulkBusy}
                  onClick={() => bulkAction("approve")}
                  className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded text-white font-medium"
                >
                  {bulkBusy ? "處理中…" : `批准選取 (${selCount})`}
                </button>
                <button
                  disabled={bulkBusy}
                  onClick={() => bulkAction("reject")}
                  className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-rose-800 disabled:opacity-50 rounded text-zinc-400 hover:text-white font-medium"
                >
                  {bulkBusy ? "處理中…" : `拒絕選取 (${selCount})`}
                </button>
                <button
                  onClick={clearSelect}
                  className="text-xs px-2 py-1.5 text-zinc-500 hover:text-zinc-300"
                >
                  清除
                </button>
              </>
            )}
          </div>
        )}

        {proposals.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">🧠</div>
            <div className="text-sm">目前沒有待審的學習。agent 在對話中學到東西時會出現在這裡。</div>
          </div>
        )}

        <div className="space-y-2">
          {proposals.map((p) => (
            <div
              key={p.id}
              className={`bg-panel border rounded-lg p-4 transition-colors ${
                selected.has(p.id) ? "border-accent/60 bg-accent/5" : "border-zinc-800"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                  className="mt-1 rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                    <span>{KIND_LABEL[p.kind] || p.kind}</span>
                    <span>·</span>
                    <span>{agentName(p.agentId)}</span>
                    <span>·</span>
                    <span>{p.scope === "agent-global" ? "跨工作區" : p.scope === "category" ? "類共通" : "限本工作區"}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{p.content}</div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    disabled={busy === p.id || bulkBusy}
                    onClick={() => decide(p, "approve")}
                    className="text-xs px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-white disabled:opacity-50"
                  >批准</button>
                  <button
                    disabled={busy === p.id || bulkBusy}
                    onClick={() => decide(p, "reject")}
                    className="text-xs px-3 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white disabled:opacity-50"
                  >拒絕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
