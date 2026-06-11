import { useMemo, useState, type RefObject } from "react";
import { MarkdownView } from "./MarkdownView";
import type { Msg } from "../hooks/useChatSession";

interface AgentLite { id: string; name: string; category: string }

interface ParsedFork {
  agentId: string;
  reason: string;
  message: string;
  raw: string;
}

function parseFork(content: string): ParsedFork | null {
  const m = content.match(/===\s*FORK:\s*([a-z0-9][a-z0-9_-]+)\s*===\s*\n([\s\S]*?)\n---\n([\s\S]*?)\n===\s*END\s*FORK\s*===/i);
  if (!m) return null;
  return {
    agentId: m[1].trim(),
    reason: m[2].trim().replace(/^原因\s*[::]\s*/, ""),
    message: m[3].trim(),
    raw: m[0],
  };
}

function ForkBanner({
  fork, agents, fromAgentName, onAccept, dismissed, onDismiss,
}: {
  fork: ParsedFork;
  agents?: AgentLite[];
  fromAgentName: string;
  onAccept?: (toAgentId: string, message: string, fromAgentName: string) => void;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  const target = agents?.find((a) => a.id === fork.agentId);
  if (dismissed) return null;
  if (!target) {
    return (
      <div className="mt-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-400 flex items-center justify-between gap-2">
        <span>⚠️ AI 建議分支到 <code className="text-rose-400">{fork.agentId}</code> — 但找不到這位 agent(可能拼錯了)</span>
        <button onClick={onDismiss} className="text-zinc-500 hover:text-zinc-200">×</button>
      </div>
    );
  }
  return (
    <div className="mt-2 px-3 py-2 bg-gradient-to-r from-sky-950/40 to-indigo-950/40 border border-sky-500/40 rounded">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs">
            <span className="text-sky-300">🔀 AI 建議分支到</span>
            <span className="ml-1 font-medium text-zinc-100">{target.name}</span>
            <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{target.category}</span>
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            <span className="text-zinc-500">原因:</span>{fork.reason}
          </div>
          <div className="text-xs text-zinc-500 mt-1 italic line-clamp-2">
            將傳送:「{fork.message.slice(0, 100)}{fork.message.length > 100 ? "…" : ""}」
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            onClick={() => { onAccept?.(fork.agentId, fork.message, fromAgentName); onDismiss(); }}
            className="text-xs px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white whitespace-nowrap"
          >
            接受 →
          </button>
          <button
            onClick={onDismiss}
            className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
          >
            忽略
          </button>
        </div>
      </div>
    </div>
  );
}

function HandoffButton({
  content, fromAgentName, agents, onHandoff,
}: {
  content: string;
  fromAgentName: string;
  agents: AgentLite[];
  onHandoff: (toAgentId: string, message: string, fromAgentName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return agents.slice(0, 12);
    const q = filter.toLowerCase();
    return agents.filter((a) =>
      a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [filter, agents]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
      >
        → 轉交給
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10">
          <div className="p-2 border-b border-zinc-800">
            <input
              autoFocus
              className="w-full bg-zinc-800 px-2 py-1 rounded text-xs"
              placeholder="搜尋 agent…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => { onHandoff(a.id, content, fromAgentName); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs border-b border-zinc-800/50 last:border-0"
              >
                <div className="font-medium">{a.name}</div>
                <div className="text-zinc-500">[{a.category}]</div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-zinc-500 text-xs p-3 text-center">沒有符合的 agent</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  scrollerRef: RefObject<HTMLDivElement>;
  messages: Msg[];
  agentName: string;
  agents?: AgentLite[];
  status: string;
  dismissedForks: Set<number>;
  onDismissFork: (i: number) => void;
  onAcceptFork?: (toAgentId: string, message: string, fromAgentName: string) => void;
  onHandoff?: (toAgentId: string, message: string, fromAgentName: string) => void;
  onCopy: (text: string) => void;
  onEditResend: (i: number) => void;
  onRegenerate: (i: number) => void;
}

/** 訊息列表：氣泡渲染、FORK 分支建議、轉交、複製/編輯重送/再試一次。 */
export function MessageList({
  scrollerRef, messages, agentName, agents, status,
  dismissedForks, onDismissFork, onAcceptFork, onHandoff,
  onCopy, onEditResend, onRegenerate,
}: MessageListProps) {
  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 && (
        <div className="text-center text-zinc-500 text-sm mt-12">
          開始對話 — 第一句通常 5–10 秒會回應(載入 agent 角色)
        </div>
      )}
      {messages.map((m, i) => {
        // 工具 chip：帶 tool 欄位的 system 訊息 → 渲染為緊湊 chip，不走一般泡泡
        if (m.tool) {
          const isCall = m.tool.type === "call";
          const isError = m.tool.status === "error";
          return (
            <div key={i} className="flex items-center gap-1 my-0.5 ml-1">
              {isCall ? (
                <span className="text-[11px] text-zinc-500">
                  <span className="mr-1">🔧</span>{m.tool.name}
                </span>
              ) : (
                <span className={`text-[11px] ${isError ? "text-rose-400" : "text-zinc-500"}`}>
                  ↳ {isError ? "✗" : "✓"} {m.tool.summary}
                </span>
              )}
            </div>
          );
        }
        if (m.role === "user" && (m.content.startsWith("[[CONSULT_RESULTS]]") || m.content.startsWith("[[EXEC_REPORT]]") || m.content.startsWith("[[EXEC_ACK]]"))) {
          const label = m.content.startsWith("[[EXEC_ACK]]") ? "（已交辦背景任務給專案經理）"
            : m.content.startsWith("[[EXEC_REPORT]]") ? "（外包任務回報已交給專案經理）"
            : "（已將同事回覆交給專案經理整合）";
          return <div key={i} className="my-1 text-[11px] text-zinc-600">{label}</div>;
        }
        // 隱藏自主迴圈協議回合（autonomyRunner in-band 注入的 PROTOCOL 提示），避免污染對話歷史顯示
        if (m.role === "user" && m.content.includes("你正在「自主模式」下工作")) {
          return null;
        }
        const fork = m.role === "assistant" && !m.partial ? parseFork(m.content) : null;
        let cleanContent = fork ? m.content.replace(fork.raw, "").trim() : m.content;
        // 隱藏 DISPATCH 標記原文（批准卡已呈現），避免泡泡出現醜的 === DISPATCH === 區塊
        if (m.role === "assistant") cleanContent = cleanContent.replace(/=== DISPATCH ===[\s\S]*?=== END DISPATCH ===/g, "").trim();
        // 移除 ACTION 區塊標記（已由 ActionApprovalCard 呈現），避免泡泡出現結構化協議原文
        if (m.role === "assistant") cleanContent = cleanContent.replace(/=== ACTION ===[\s\S]*?=== END ACTION ===/g, "").trim();
        return (
          <div
            key={i}
            className={`max-w-[85%] group ${
              m.role === "user" ? "ml-auto" : m.role === "system" ? "mx-auto" : ""
            }`}
          >
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent text-white whitespace-pre-wrap"
                  : m.role === "assistant"
                  ? "bg-zinc-800 text-zinc-100"
                  : "bg-zinc-900 text-zinc-500 text-xs italic whitespace-pre-wrap"
              }`}
            >
              {m.role === "assistant"
                ? cleanContent
                  ? <MarkdownView>{cleanContent}</MarkdownView>
                  : <span className="text-zinc-500 text-xs italic">🤖（自主步驟）</span>
                : m.content}
            </div>
            {fork && (
              <ForkBanner
                fork={fork}
                agents={agents}
                fromAgentName={agentName}
                onAccept={onAcceptFork}
                dismissed={dismissedForks.has(i)}
                onDismiss={() => onDismissFork(i)}
              />
            )}

            {/* per-message actions */}
            {m.role !== "system" && !m.partial && (
              <div className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition ${
                m.role === "user" ? "justify-end" : ""
              }`}>
                <button
                  onClick={() => onCopy(m.content)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
                  title="複製"
                >📋 複製</button>
                {m.role === "user" && status !== "busy" && status !== "starting" && (
                  <button
                    onClick={() => onEditResend(i)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
                    title="把這條 prompt 載回輸入框,可編輯後再送(會清掉後面所有訊息)"
                  >✏️ 編輯重送</button>
                )}
                {m.role === "assistant" && status !== "busy" && status !== "starting" && (
                  <button
                    onClick={() => onRegenerate(i)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
                    title="重新跑一次同樣的 prompt"
                  >🔄 再試一次</button>
                )}
                {m.role === "assistant" && onHandoff && agents && (
                  <HandoffButton
                    content={m.content}
                    fromAgentName={agentName}
                    agents={agents}
                    onHandoff={onHandoff}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
