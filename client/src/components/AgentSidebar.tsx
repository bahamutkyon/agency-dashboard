import { useMemo, useState } from "react";
import type { AgentMeta, CategoryMeta } from "../lib/api";

interface Props {
  agents: AgentMeta[];
  categories: CategoryMeta[];
  liveAgentIds: Set<string>;
  onPick: (agent: AgentMeta) => void;
  onAskOrchestrator: () => void;
  onOpenSchedules: () => void;
  onOpenHistory: () => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
  onOpenBatch: () => void;
  onOpenNotes: () => void;
}

export function AgentSidebar({
  agents, categories, liveAgentIds,
  onPick, onAskOrchestrator, onOpenSchedules,
  onOpenHistory, onOpenTemplates, onOpenSettings,
  onOpenBatch, onOpenNotes,
}: Props) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (cat && a.category !== cat) return false;
      if (!q) return true;
      return (
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    });
  }, [agents, cat, query]);

  return (
    <aside className="w-96 bg-panel border-r border-zinc-800 flex flex-col">
      <div className="m-3 space-y-2">
        <button
          onClick={onAskOrchestrator}
          className="w-full px-3 py-2 rounded bg-gradient-to-r from-accent to-violet-500 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          title="不知道要找誰?讓專案經理幫你規劃團隊"
        >
          <span>👨‍💼</span>
          <span>找專案經理討論</span>
        </button>
        <button
          onClick={onOpenBatch}
          className="w-full px-3 py-2 rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-medium flex items-center justify-center gap-2"
          title="多位 agent 同時做同一題"
        >
          <span>🎯</span>
          <span>批次同題</span>
        </button>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={onOpenSchedules}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="設定週期任務"
          >
            <span>⏰</span>
            <span>排程</span>
          </button>
          <button
            onClick={onOpenHistory}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="所有過往對話"
          >
            <span>📚</span>
            <span>歷史</span>
          </button>
          <button
            onClick={onOpenNotes}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="共享筆記/知識庫"
          >
            <span>📒</span>
            <span>筆記</span>
          </button>
          <button
            onClick={onOpenTemplates}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="常用 prompt 模板"
          >
            <span>📋</span>
            <span>模板</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="主題、字體、通知設定"
          >
            <span>⚙️</span>
            <span>設定</span>
          </button>
          <div className="px-2 py-2"></div>
        </div>
      </div>

      <div className="px-3 pb-3 border-b border-zinc-800">
        <input
          className="w-full bg-zinc-900 px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="搜尋 agent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="px-2 py-2 flex flex-wrap gap-1 border-b border-zinc-800">
        <button
          onClick={() => setCat(null)}
          className={`text-xs px-2 py-1 rounded ${
            cat === null ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          全部 ({agents.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`text-xs px-2 py-1 rounded ${
              cat === c.id ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((a) => {
          const live = liveAgentIds.has(a.id);
          return (
            <button
              key={a.id}
              onClick={() => onPick(a)}
              className="w-full text-left px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900 group"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    live ? "bg-emerald-400" : "bg-zinc-700"
                  }`}
                />
                <span className="text-sm font-medium">{a.name}</span>
              </div>
              <div className="text-xs text-zinc-400 mt-1 leading-relaxed break-words whitespace-pre-wrap">
                {a.description}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-zinc-500 text-sm p-4 text-center">沒有符合的 agent</div>
        )}
      </div>
    </aside>
  );
}
