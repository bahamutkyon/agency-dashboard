import { useEffect, useState } from "react";
import { getSocket } from "../lib/socket";

interface AgentMeta { id: string; name: string; category: string; }
interface Category { id: string; label: string; count: number; }
interface RunProgress {
  runId: string;
  status: string;
  total: number;
  done: number;
  current: string | null;
  failed: { target: string; error: string }[];
  createdProposals: number;
}

export function CapabilityLearningPanel() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents || []);
        setCategories(d.categories || []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sock = getSocket();
    const onProgress = (p: RunProgress) => {
      setProgress(p);
      if (p.status === "done" || p.status === "error") setBusy(false);
    };
    sock.on("learning:progress", onProgress);
    return () => { sock.off("learning:progress", onProgress); };
  }, []);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleExpand(catId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  }

  async function start() {
    const targets = [...picked].map((k) => {
      const [type, ...rest] = k.split(":");
      return { type, id: rest.join(":") };
    });
    if (targets.length === 0) return;
    setBusy(true);
    setProgress(null);
    const r = await fetch("/api/learning/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    if (!r.ok) {
      setBusy(false);
      alert("啟動失敗");
    }
  }

  const pickedCount = picked.size;

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold">🎓 能力學習進程</h2>
          <p className="text-xs text-zinc-500 mt-1">
            選擇類別或個別 agent，讓 Claude 從對話紀錄中萃取能力學習提案，再到「學習佇列」批准。
          </p>
        </div>

        {/* Guidance */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-4 text-xs text-zinc-400 space-y-1">
          <div className="font-medium text-zinc-300 mb-1">📋 建議流程</div>
          <div>① 勾選類別（或個別 agent）→ ② 點「開始學習」→ ③ 到「學習佇列」批准提案</div>
          <div className="mt-2 text-amber-400/80">
            ⚠️ 能力學習使用 Claude Opus 4.7，每次執行會消耗訂閱額度。agent 數量多時耗時較長，請耐心等待。
          </div>
        </div>

        {/* Category + Agent Checklist */}
        <div className="bg-panel border border-zinc-800 rounded-lg mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-medium">選擇目標</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const allKeys = [
                    ...categories.map((c) => `category:${c.id}`),
                    ...agents.map((a) => `agent:${a.id}`),
                  ];
                  setPicked(new Set(allKeys));
                }}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                全選
              </button>
              <button
                onClick={() => setPicked(new Set())}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                清除
              </button>
            </div>
          </div>

          {categories.length === 0 && (
            <div className="p-6 text-center text-zinc-500 text-sm">
              載入中…
            </div>
          )}

          <div className="divide-y divide-zinc-800">
            {categories.map((cat) => {
              const catKey = `category:${cat.id}`;
              const catAgents = agents.filter((a) => a.category === cat.id);
              const isExpanded = expanded.has(cat.id);
              const isCatPicked = picked.has(catKey);

              return (
                <div key={cat.id}>
                  {/* Category row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50">
                    <input
                      type="checkbox"
                      checked={isCatPicked}
                      onChange={() => toggle(catKey)}
                      className="rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900"
                      id={`cat-${cat.id}`}
                    />
                    <label
                      htmlFor={`cat-${cat.id}`}
                      className="flex-1 text-sm cursor-pointer select-none"
                    >
                      <span className="font-medium">{cat.label}</span>
                      <span className="text-zinc-500 text-xs ml-2">({cat.count} 個 agent)</span>
                    </label>
                    {catAgents.length > 0 && (
                      <button
                        onClick={() => toggleExpand(cat.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                        title={isExpanded ? "收合" : "展開個別 agent"}
                      >
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </div>

                  {/* Agent rows (expanded) */}
                  {isExpanded && catAgents.map((agent) => {
                    const agentKey = `agent:${agent.id}`;
                    const isAgentPicked = picked.has(agentKey);
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center gap-3 px-4 py-2 pl-10 bg-zinc-900/30 hover:bg-zinc-900/60"
                      >
                        <input
                          type="checkbox"
                          checked={isAgentPicked}
                          onChange={() => toggle(agentKey)}
                          className="rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900"
                          id={`agent-${agent.id}`}
                        />
                        <label
                          htmlFor={`agent-${agent.id}`}
                          className="flex-1 text-xs text-zinc-300 cursor-pointer select-none"
                        >
                          {agent.name}
                        </label>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Start Button */}
        <div className="mb-6">
          <button
            disabled={busy || pickedCount === 0}
            onClick={start}
            className="px-5 py-2.5 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            {busy
              ? "⏳ 執行中…"
              : pickedCount > 0
              ? `🚀 開始學習（已選 ${pickedCount} 個）`
              : "請先勾選目標"}
          </button>
        </div>

        {/* Progress area */}
        {progress && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium">執行進度</span>
              <span>
                {progress.done} / {progress.total}
                {progress.status === "done" && " ✅ 完成"}
                {progress.status === "error" && " ❌ 錯誤"}
                {progress.status === "running" && " ⏳ 執行中"}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  progress.status === "done"
                    ? "bg-emerald-500"
                    : progress.status === "error"
                    ? "bg-rose-500"
                    : "bg-violet-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Current target */}
            {progress.current && progress.status === "running" && (
              <div className="text-xs text-zinc-400">
                正在處理：<span className="text-zinc-200">{progress.current}</span>
              </div>
            )}

            {/* Done summary */}
            {progress.status === "done" && (
              <div className="text-sm text-emerald-400 font-medium">
                🎉 已產生 {progress.createdProposals} 條提案，請到「學習佇列」批准
              </div>
            )}

            {/* Failed list */}
            {progress.failed && progress.failed.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-rose-400 font-medium">失敗項目：</div>
                {progress.failed.map((f, i) => (
                  <div key={i} className="text-xs text-zinc-500 pl-2">
                    <span className="text-rose-400">{f.target}</span>
                    {f.error && <span className="ml-2">— {f.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
