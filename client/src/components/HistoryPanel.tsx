import { useEffect, useState } from "react";
import { api, type AgentMeta, type SearchHit, type SessionRecord, type TagInfo } from "../lib/api";

interface Props {
  agents: AgentMeta[];
  onOpen: (sessionId: string, agentId: string, title: string) => void;
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-TW");
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i} className="bg-amber-300/30 text-amber-200 px-0.5 rounded">{p}</mark> : <span key={i}>{p}</span>
  );
}

type ViewMode = "timeline" | "by-agent";

export function HistoryPanel({ agents, onOpen }: Props) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem("agency:historyView") as ViewMode) || "timeline"
  );
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());

  const setMode = (m: ViewMode) => {
    setViewMode(m);
    localStorage.setItem("agency:historyView", m);
  };

  const toggleAgent = (id: string) => {
    setCollapsedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const reload = () => {
    api.sessions().then(setSessions).catch(() => {});
    api.tags().then(setAllTags).catch(() => {});
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);

  // debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    setSearching(true);
    const handle = setTimeout(() => {
      api.search(q).then(setHits).catch(() => setHits([])).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  const remove = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (!confirm(`刪除「${title}」?此對話將永久消失`)) return;
    await api.deleteSession(id);
    reload();
    if (query) api.search(query).then(setHits);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold">📚 歷史對話</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {hits === null
                ? `所有過往對話(${sessions.length} 筆)`
                : `搜尋結果(${hits.length} 筆${searching ? " 搜尋中…" : ""})`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-zinc-900 rounded text-xs overflow-hidden">
              <button
                onClick={() => setMode("timeline")}
                className={`px-3 py-2 ${viewMode === "timeline" ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                title="按時間排序所有對話"
              >🕐 時間軸</button>
              <button
                onClick={() => setMode("by-agent")}
                className={`px-3 py-2 ${viewMode === "by-agent" ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                title="按專家分組,看跟每位 agent 的所有對話"
              >👥 按專家</button>
            </div>
            <input
              className="bg-zinc-900 px-3 py-2 rounded text-sm w-48 md:w-72 focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="搜尋對話內容(全文)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            <button
              onClick={() => setActiveTag(null)}
              className={`text-xs px-2 py-1 rounded ${
                activeTag === null ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              全部
            </button>
            {allTags.map((t) => (
              <button
                key={t.name}
                onClick={() => setActiveTag(t.name)}
                className={`text-xs px-2 py-1 rounded ${
                  activeTag === t.name ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                #{t.name} ({t.count})
              </button>
            ))}
          </div>
        )}

        {/* search results */}
        {hits !== null && (
          <div className="space-y-2">
            {hits.length === 0 && !searching && (
              <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
                <div className="text-4xl mb-2">🔍</div>
                <div className="text-sm">沒有對話包含「{query}」</div>
              </div>
            )}
            {hits.map((h) => (
              <div
                key={h.sessionId}
                onClick={() => onOpen(h.sessionId, h.agentId, h.title)}
                className="bg-panel border border-zinc-800 hover:border-accent/50 rounded-lg p-4 cursor-pointer transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{highlight(h.title, query)}</span>
                      <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">
                        {agentName(h.agentId)}
                      </span>
                      <span className="text-xs text-zinc-500">{h.matchCount} 處命中</span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">{fmtRelative(h.updatedAt)}</div>
                    {h.matches.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {h.matches.map((m, i) => (
                          <div key={i} className="text-xs bg-zinc-900 rounded p-2 text-zinc-300">
                            <span className="text-zinc-500 mr-2">
                              [{m.role === "user" ? "我" : "agent"}]
                            </span>
                            {highlight(m.snippet, query)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => remove(e, h.sessionId, h.title)}
                    className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* full list */}
        {hits === null && (() => {
          const filtered = activeTag ? sessions.filter((s) => (s.tags || []).includes(activeTag)) : sessions;

          const renderCard = (s: SessionRecord) => (
            <div
              key={s.id}
              onClick={() => onOpen(s.id, s.agentId, s.title)}
              className="bg-panel border border-zinc-800 hover:border-accent/50 rounded-lg p-4 cursor-pointer transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      s.status === "busy" ? "bg-amber-400 animate-pulse" :
                      s.status === "error" ? "bg-rose-500" : "bg-zinc-600"
                    }`} />
                    <span className="font-medium truncate">{s.title}</span>
                    {(s.tags || []).map((t) => (
                      <span key={t} className="text-[11px] px-1.5 py-0.5 bg-accent/20 text-accent rounded">#{t}</span>
                    ))}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                    {viewMode === "timeline" && <><span>{agentName(s.agentId)}</span><span>·</span></>}
                    <span>{fmtRelative(s.updatedAt)}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => remove(e, s.id, s.title)}
                  className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white"
                >
                  刪除
                </button>
              </div>
            </div>
          );

          if (filtered.length === 0) {
            return (
              <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
                <div className="text-4xl mb-2">💭</div>
                <div className="text-sm">{sessions.length === 0 ? "還沒有任何對話紀錄" : `沒有標籤為 #${activeTag} 的對話`}</div>
              </div>
            );
          }

          // ==== Timeline view (default) ====
          if (viewMode === "timeline") {
            return <div className="space-y-2">{filtered.map(renderCard)}</div>;
          }

          // ==== By-agent grouped view ====
          const groups = new Map<string, SessionRecord[]>();
          for (const s of filtered) {
            if (!groups.has(s.agentId)) groups.set(s.agentId, []);
            groups.get(s.agentId)!.push(s);
          }
          // sort groups by most-recent session in each
          const sortedGroups = Array.from(groups.entries())
            .sort((a, b) => b[1][0].updatedAt - a[1][0].updatedAt);

          return (
            <div className="space-y-3">
              {sortedGroups.map(([agentId, list]) => {
                const collapsed = collapsedAgents.has(agentId);
                return (
                  <div key={agentId} className="bg-panel/40 border border-zinc-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleAgent(agentId)}
                      className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-zinc-800/40 text-left"
                    >
                      <span className="font-medium text-zinc-100 flex items-center gap-2">
                        <span className="text-zinc-500 text-xs w-3">{collapsed ? "▶" : "▼"}</span>
                        {agentName(agentId)}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">
                        💬 {list.length}
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="px-3 pb-3 pt-1 space-y-2">
                        {list.map(renderCard)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
