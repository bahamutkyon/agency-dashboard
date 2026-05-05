import { useEffect, useState } from "react";
import type { AgentMeta } from "../lib/api";
import { withWorkspace } from "../lib/workspace";

interface MeetingSession {
  id: string;
  title: string;
  tags: string[];
  provider?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: string;
  lastSnippet: string | null;
  lastRole: "user" | "assistant" | null;
}

interface Props {
  agent: AgentMeta;
  /** 進入既有會議 */
  onOpen: (sessionId: string, agentId: string, title: string) => void;
  /** 開新會議 — 帶主題進去當 title */
  onStartNew: (agent: AgentMeta, topic: string) => void;
  onClose: () => void;
}

function fmtRelative(ts: number): string {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  return `${mo} 個月前`;
}

export function AgentMeetingRoom({ agent, onOpen, onStartNew, onClose }: Props) {
  const [sessions, setSessions] = useState<MeetingSession[] | null>(null);
  const [topic, setTopic] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    fetch(withWorkspace(`/api/agents/${agent.id}/sessions`))
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [agent.id]);

  const startNew = () => {
    const trimmed = topic.trim();
    onStartNew(agent, trimmed);
    setTopic("");
    setShowNewForm(false);
  };

  const isDefaultTitle = (t: string) =>
    t === `${agent.id} 對話` || t === agent.name || t.endsWith(" 對話");

  return (
    <div className="h-full flex flex-col bg-ink">
      {/* header */}
      <div className="px-4 md:px-6 py-3 border-b border-zinc-800 bg-panel flex items-center gap-3">
        <div className="text-2xl">{agent.name.match(/^[\p{Emoji}]/u)?.[0] || "👤"}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-zinc-100">{agent.name} 的會議室</div>
          <div className="text-xs text-zinc-500 line-clamp-1">{agent.description || "—"}</div>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 px-2 py-1"
          title="關閉會議室"
          aria-label="關閉"
        >×</button>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">

        {/* 開新會議 */}
        <div>
          {!showNewForm ? (
            <button
              onClick={() => setShowNewForm(true)}
              className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-accent to-violet-500 hover:from-violet-500 hover:to-fuchsia-500 text-white font-medium shadow-lg shadow-accent/20 flex items-center justify-center gap-2"
            >
              <span className="text-lg">＋</span>
              <span>開新會議</span>
            </button>
          ) : (
            <div className="bg-panel border border-accent/40 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">這次要討論什麼?</label>
                <input
                  type="text"
                  autoFocus
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startNew();
                    if (e.key === "Escape") { setShowNewForm(false); setTopic(""); }
                  }}
                  placeholder="例:自媒體 · Q3 選題大綱  /  B2B · 顧問定價策略"
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="text-[11px] text-zinc-500 mt-1">
                  留空也可以,系統會在第一輪對話後自動命名
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowNewForm(false); setTopic(""); }}
                  className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                >取消</button>
                <button
                  onClick={startNew}
                  className="px-4 py-1.5 bg-accent hover:bg-violet-500 text-white text-sm rounded"
                >開始(Enter)</button>
              </div>
            </div>
          )}
        </div>

        {/* 既有會議列表 */}
        <div>
          <div className="text-xs text-zinc-500 mb-2 px-1">
            {sessions === null ? "載入中…"
              : sessions.length === 0 ? "還沒跟這位同事開過會"
              : `跟 ${agent.name} 的會議(${sessions.length})`}
          </div>

          {sessions && sessions.length > 0 && (
            <div className="space-y-2">
              {sessions.map((s) => {
                const showTitle = !isDefaultTitle(s.title);
                return (
                  <div
                    key={s.id}
                    onClick={() => onOpen(s.id, agent.id, s.title)}
                    className="bg-panel border border-zinc-800 hover:border-accent/50 rounded-lg p-3 md:p-4 cursor-pointer transition group"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`inline-block w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                        s.status === "busy" ? "bg-amber-400 animate-pulse" :
                        s.status === "error" ? "bg-rose-500" : "bg-zinc-600 group-hover:bg-emerald-400"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-zinc-100 truncate">
                          {showTitle ? s.title : <span className="text-zinc-500 italic">未命名會議</span>}
                        </div>
                        {s.lastSnippet && (
                          <div className="text-xs text-zinc-400 mt-1 line-clamp-2">
                            <span className="text-zinc-600 mr-1">
                              [{s.lastRole === "user" ? "你" : "TA"}]
                            </span>
                            {s.lastSnippet}
                          </div>
                        )}
                        <div className="flex gap-2 mt-2 text-[11px] text-zinc-500 items-center flex-wrap">
                          <span>{fmtRelative(s.updatedAt)}</span>
                          {s.messageCount > 0 && (
                            <>
                              <span>·</span>
                              <span>{s.messageCount} 則訊息</span>
                            </>
                          )}
                          {(s.tags || []).map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded">#{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
