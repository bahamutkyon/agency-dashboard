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

  const reload = () => api.learningProposals().then(setProposals).catch(() => {});
  useEffect(() => { reload(); }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  const decide = async (p: LearningProposal, action: "approve" | "reject") => {
    setBusy(p.id);
    try {
      if (action === "approve") await api.approveLearning(p.id);
      else await api.rejectLearning(p.id);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: any) {
      alert(`操作失敗：${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">🧠 學習審核佇列</h2>
          <p className="text-xs text-zinc-500 mt-1">
            agent 提出的學習成果。批准後才會寫進該 agent 的能力 / 工作區檔案；拒絕的不再重複出現。
          </p>
        </div>

        {proposals.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">🧠</div>
            <div className="text-sm">目前沒有待審的學習。agent 在對話中學到東西時會出現在這裡。</div>
          </div>
        )}

        <div className="space-y-2">
          {proposals.map((p) => (
            <div key={p.id} className="bg-panel border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                    <span>{KIND_LABEL[p.kind] || p.kind}</span>
                    <span>·</span>
                    <span>{agentName(p.agentId)}</span>
                    <span>·</span>
                    <span>{p.scope === "agent-global" ? "跨工作區" : "限本工作區"}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{p.content}</div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    disabled={busy === p.id}
                    onClick={() => decide(p, "approve")}
                    className="text-xs px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-white disabled:opacity-50"
                  >批准</button>
                  <button
                    disabled={busy === p.id}
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
