import { useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../lib/socket";
import { api, type SessionRecord } from "../lib/api";
import { MarkdownView } from "./MarkdownView";
import { AgentMemoryModal } from "./AgentMemoryModal";
import { ActionApprovalCard } from "./ActionApprovalCard";
import { AutonomyPanel } from "./AutonomyPanel";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { useAutonomy } from "../hooks/useAutonomy";
import { useWorkflowDetection } from "../hooks/useWorkflowDetection";
import { useMemoDetection } from "../hooks/useMemoDetection";
import { useFileUpload } from "../hooks/useFileUpload";
import { useChatSession, type Msg } from "../hooks/useChatSession";
import { useTemplates } from "../hooks/useTemplates";
import { useNotes } from "../hooks/useNotes";
import { useTags } from "../hooks/useTags";
import { useSessionSummary } from "../hooks/useSessionSummary";

interface Props {
  sessionId: string;
  agentId: string;
  agentName: string;
  provider?: "claude" | "codex" | "gemini";
  onStatusChange?: (status: string) => void;
  onOpenAgentById?: (agentId: string) => void;
  onHandoff?: (toAgentId: string, message: string, fromAgentName: string) => void;
  knownAgentIds?: Set<string>;
  agents?: { id: string; name: string; category: string }[];
  onboardingTargetWorkspaceId?: string;
  onMemoApplied?: () => void;
  onAcceptFork?: (toAgentId: string, message: string, fromAgentName: string) => void;
  onOpenSession?: (sessionId: string, agentId: string, title: string) => void;
}

function exportMarkdown(agentName: string, sessionId: string, messages: Msg[]) {
  const fmt = (ts: number) => new Date(ts).toLocaleString("zh-TW", { hour12: false });
  const lines = [
    `# ${agentName} 對話紀錄`,
    ``,
    `- Session: \`${sessionId}\``,
    `- 匯出時間: ${fmt(Date.now())}`,
    `- 訊息數: ${messages.length}`,
    ``,
    `---`,
    ``,
  ];
  for (const m of messages) {
    if (m.tool) continue; // 工具 chip 為暫態，不寫入匯出
    const who = m.role === "user" ? "🧑 我" : m.role === "assistant" ? `🤖 ${agentName}` : "⚙️ 系統";
    lines.push(`## ${who} · ${fmt(m.ts)}`);
    lines.push("");
    lines.push(m.content);
    lines.push("");
  }
  const md = lines.join("\n");
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `${agentName}-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ChatWindow({
  sessionId, agentId, agentName, provider, onStatusChange, onOpenAgentById, onHandoff,
  knownAgentIds, agents, onboardingTargetWorkspaceId, onMemoApplied, onAcceptFork, onOpenSession,
}: Props) {
  const [input, setInput] = useState("");
  const [showMemory, setShowMemory] = useState(false);
  const [dismissedForks, setDismissedForks] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 對話核心狀態與 socket 串流抽到 useChatSession。
  const { messages, setMessages, status, setStatus, autoInjectedNotes, scrollerRef } =
    useChatSession(sessionId, agentName, onStatusChange);
  // 範本 / 筆記 / 標籤 / 摘要 各自的 hook。
  const { showPicker, setShowPicker, pickerFilter, setPickerFilter, visibleTemplates, insertTemplate } =
    useTemplates(agentId, setInput, inputRef);
  const { notes, showNotePicker, setShowNotePicker, attachNote } = useNotes(setInput, inputRef);
  const { tags, setTags, tagInput, setTagInput, addTag, removeTag } = useTags(sessionId);
  const { summary, summarizing, summarize, clearSummary } = useSessionSummary(sessionId);

  // 載入歷史：一次 hydrate 訊息、標籤、狀態（橫跨 useChatSession + useTags）。
  useEffect(() => {
    let cancelled = false;
    api.session(sessionId).then((rec: SessionRecord) => {
      if (cancelled) return;
      setMessages(rec.messages || []);
      setTags(rec.tags || []);
      if (rec.status) setStatus(rec.status);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  // detect agent IDs the orchestrator (or anyone) recommends — anything in
  // backticks that matches a known agent id. Only shown for orchestrator chats
  // because that's the only place this UX makes sense.
  const recommendedAgents = useMemo(() => {
    if (agentId !== "agents-orchestrator" || !knownAgentIds) return [];
    const seen = new Set<string>();
    const re = /`([a-z0-9][a-z0-9-_]+)`/gi;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      let match;
      while ((match = re.exec(m.content)) !== null) {
        const id = match[1];
        if (knownAgentIds.has(id)) seen.add(id);
      }
    }
    return Array.from(seen);
  }, [messages, agentId, knownAgentIds]);

  const openAll = () => {
    if (!onOpenAgentById) return;
    recommendedAgents.forEach((id) => onOpenAgentById(id));
  };

  // detect MEMO block in latest assistant message — works in any session
  // (originally tied to onboarding mode, but we also want to recover memos
  // when user reopens an old session from history).
  // 偵測類功能抽成 custom hooks（各自包偵測邏輯 + 動作狀態 + handler）。
  const { detectedMemo, applying, applied, applyMemo } =
    useMemoDetection(messages, sessionId, onboardingTargetWorkspaceId, onMemoApplied);
  const { detectedWorkflow, applyingWf, appliedWf, applyWorkflow } =
    useWorkflowDetection(messages, sessionId);
  const { run: autonomyRun, pending: autonomyPending, busy: autonomyBusy, start: autonomyStart, approvePlan: autonomyApprovePlan, stop: autonomyStop, resume: autonomyResume, sendInput: autonomySendInput, inject: autonomyInject, approveAction, rejectAction } =
    useAutonomy(sessionId);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    getSocket().emit("session:send", { sessionId, text });
    setInput("");
  };

  // Edit & resend: trim everything from the chosen user message onwards,
  // load it back into the input, ready to edit + send.
  const editAndResend = (idx: number) => {
    const m = messages[idx];
    if (m.role !== "user") return;
    setMessages((prev) => prev.slice(0, idx));
    setInput(m.content);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Regenerate: drop the assistant message at idx, find the preceding user
  // message, and resend it.
  const regenerate = (idx: number) => {
    const m = messages[idx];
    if (m.role !== "assistant" || m.partial) return;
    // find previous user message
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userText = messages[userIdx].content;
    setMessages((prev) => prev.slice(0, idx));
    getSocket().emit("session:send", { sessionId, text: userText });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const { dragActive, setDragActive, uploading, handleFiles, handlePaste } = useFileUpload(setInput, inputRef);

  return (
    <>
      {showMemory && (
        <AgentMemoryModal
          sessionId={sessionId}
          agentId={agentId}
          agentName={agentName}
          onClose={() => setShowMemory(false)}
        />
      )}
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={(e) => {
        // only reset when leaving the container, not bubbling from children
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
      }}
      onPaste={handlePaste}
    >
      {dragActive && (
        <div className="absolute inset-0 z-40 bg-accent/20 border-4 border-dashed border-accent flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-5xl mb-2">📎</div>
            <div className="text-lg font-medium text-white">放開上傳檔案</div>
            <div className="text-xs text-zinc-300 mt-1">圖片 / 文件 / 程式碼 都可以(上限 10MB)</div>
          </div>
        </div>
      )}
      {uploading && (
        <div className="absolute top-2 right-2 z-30 bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-xs text-zinc-300">
          上傳中…
        </div>
      )}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between bg-panel">
        <div>
          <div className="text-sm font-medium flex items-center gap-2">
            {agentName}
            {provider && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                provider === "codex" ? "bg-emerald-900/60 text-emerald-300" :
                provider === "gemini" ? "bg-sky-900/60 text-sky-300" :
                "bg-violet-900/60 text-violet-300"
              }`}>
                {provider === "codex" ? "🤖 Codex" : provider === "gemini" ? "✨ Gemini" : "🧠 Claude"}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500">session: {sessionId.slice(0, 8)}</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowMemory(true)}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            title={`看/編輯 ${agentName} 對你的記憶(跨對話注入給 TA)`}
          >
            📝 記憶
          </button>
          <button
            onClick={summarize}
            disabled={summarizing || messages.length < 2}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-300"
            title="產生對話摘要"
          >
            {summarizing ? "✨ 摘要中…" : "✨ 摘要"}
          </button>
          <button
            onClick={() => exportMarkdown(agentName, sessionId, messages)}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            title="下載對話為 Markdown 檔"
          >
            匯出 .md
          </button>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                status === "busy" ? "bg-amber-400 animate-pulse" :
                status === "starting" ? "bg-sky-400 animate-pulse" :
                status === "error" ? "bg-rose-500" :
                status === "closed" ? "bg-zinc-600" :
                "bg-emerald-400"
              }`}
            />
            <span className="text-zinc-400">{status}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-1.5 border-b border-zinc-800 bg-panel/50 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-zinc-500">標籤:</span>
        {tags.map((t) => (
          <span key={t} className="text-[11px] bg-zinc-800 text-zinc-300 rounded-full pl-2 pr-1 py-0.5 flex items-center gap-1">
            #{t}
            <button onClick={() => removeTag(t)} className="text-zinc-500 hover:text-rose-400 px-1">×</button>
          </span>
        ))}
        <input
          className="text-[11px] bg-zinc-900 px-2 py-0.5 rounded w-32 focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="+ 新增標籤"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addTag(); }
            if (e.key === "Escape") setTagInput("");
          }}
          onBlur={addTag}
        />
      </div>
      {recommendedAgents.length > 0 && onOpenAgentById && !detectedWorkflow && (
        <div className="px-4 py-2 bg-gradient-to-r from-accent/20 to-violet-500/20 border-b border-accent/30 flex items-center justify-between gap-3">
          <div className="text-xs">
            <span className="text-zinc-300">專案經理推薦團隊({recommendedAgents.length} 位):</span>
            <span className="ml-2 text-zinc-400 text-[11px] font-mono">
              {recommendedAgents.slice(0, 4).join(", ")}{recommendedAgents.length > 4 ? "…" : ""}
            </span>
          </div>
          <button
            onClick={openAll}
            className="text-xs px-3 py-1 rounded bg-accent hover:bg-violet-500 text-white whitespace-nowrap"
          >
            一鍵全部開啟
          </button>
        </div>
      )}
      {detectedWorkflow && (
        <div className="px-4 py-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-amber-500/30 flex items-center justify-between gap-3">
          <div className="text-xs">
            <span className="text-zinc-200 font-medium">🔗 偵測到 Workflow 草稿</span>
            <span className="ml-2 text-zinc-400">
              「{detectedWorkflow.name}」· {detectedWorkflow.steps.length} 個步驟
            </span>
          </div>
          <button
            onClick={applyWorkflow}
            disabled={applyingWf || appliedWf}
            className="text-xs px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white whitespace-nowrap"
          >
            {appliedWf ? "✓ 已套用 — 去 🔗 自動接力 看" : applyingWf ? "套用中…" : "套用為 Workflow"}
          </button>
        </div>
      )}
      {detectedMemo && (
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-b border-emerald-500/30 flex items-center justify-between gap-3">
          <div className="text-xs">
            <span className="text-zinc-200 font-medium">✨ 偵測到備忘錄草稿</span>
            <span className="ml-2 text-zinc-400">
              ({detectedMemo.length} 字 · 預覽:{detectedMemo.slice(0, 60).replace(/\n/g, " ")}…)
            </span>
          </div>
          <button
            onClick={applyMemo}
            disabled={applying || applied}
            className="text-xs px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white whitespace-nowrap"
          >
            {applied ? "✓ 已套用" : applying ? "套用中…" : "套用到工作區"}
          </button>
        </div>
      )}
      <div className="px-4 py-2 border-b border-zinc-800">
        <AutonomyPanel
          run={autonomyRun}
          busy={autonomyBusy}
          onStart={(goal) => autonomyStart(goal, { policy: "balanced", maxSteps: 12, maxWallMs: 15 * 60 * 1000 })}
          onApprovePlan={autonomyApprovePlan}
          onStop={autonomyStop}
          onResume={autonomyResume}
          onInput={autonomySendInput}
          onInject={autonomyInject}
        />
      </div>
      {autonomyPending.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-700/30">
          {autonomyPending.map((p) => (
            <ActionApprovalCard
              key={p.id}
              action={p}
              busy={autonomyBusy}
              onApprove={() => approveAction(p.id)}
              onReject={() => rejectAction(p.id)}
            />
          ))}
        </div>
      )}
      {autoInjectedNotes.length > 0 && (
        <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-700/30 text-xs text-emerald-300">
          📚 已自動參考筆記:{autoInjectedNotes.map((n) => n.title).join(" · ")}
        </div>
      )}
      {summary && (
        <div className="px-4 py-3 bg-amber-950/30 border-b border-amber-800/30 relative">
          <button
            onClick={clearSummary}
            className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-200 text-sm"
            title="關閉"
          >×</button>
          <div className="text-xs text-amber-300 mb-1">✨ 對話摘要</div>
          <MarkdownView className="text-zinc-200">{summary}</MarkdownView>
        </div>
      )}
      <MessageList
        scrollerRef={scrollerRef}
        messages={messages}
        agentName={agentName}
        agents={agents}
        status={status}
        dismissedForks={dismissedForks}
        onDismissFork={(i) => setDismissedForks((prev) => new Set([...prev, i]))}
        onAcceptFork={onAcceptFork}
        onHandoff={onHandoff}
        onCopy={copy}
        onEditResend={editAndResend}
        onRegenerate={regenerate}
      />

      {autonomyRun && !["done", "stopped", "budget_exhausted", "error"].includes(autonomyRun.status) && (
        <div className="px-4 py-2 border-t border-emerald-700/30 bg-emerald-950/20 text-xs text-emerald-300">
          🎯 自走中…請用上方插話框跟它說話，或按「喊停」
        </div>
      )}
      <Composer
        input={input}
        setInput={setInput}
        inputRef={inputRef}
        status={status}
        onSend={send}
        showPicker={showPicker}
        setShowPicker={setShowPicker}
        setPickerFilter={setPickerFilter}
        visibleTemplates={visibleTemplates}
        insertTemplate={insertTemplate}
        notes={notes}
        showNotePicker={showNotePicker}
        setShowNotePicker={setShowNotePicker}
        attachNote={attachNote}
      />
    </div>
    </>
  );
}
