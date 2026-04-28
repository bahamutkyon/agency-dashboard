import { useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "../lib/socket";
import { api, type Note, type PromptTemplate, type SessionRecord } from "../lib/api";
import { notify } from "../lib/notifications";
import { MarkdownView } from "./MarkdownView";

interface Props {
  sessionId: string;
  agentId: string;
  agentName: string;
  onStatusChange?: (status: string) => void;
  onOpenAgentById?: (agentId: string) => void;
  onHandoff?: (toAgentId: string, message: string, fromAgentName: string) => void;
  knownAgentIds?: Set<string>;
  agents?: { id: string; name: string; category: string }[];
  // When provided, this chat is in onboarding mode — the window watches for
  // MEMO blocks and shows an "apply to workspace" CTA targeting this id.
  onboardingTargetWorkspaceId?: string;
  onMemoApplied?: () => void;
  // Auto-fork: when agent suggests a fork via marker, this callback opens
  // the target agent in a new tab with the suggested message as first input.
  onAcceptFork?: (toAgentId: string, message: string, fromAgentName: string) => void;
}

interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  partial?: boolean;
}

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
  agents?: { id: string; name: string; category: string }[];
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
  agents: { id: string; name: string; category: string }[];
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
                onClick={() => {
                  onHandoff(a.id, content, fromAgentName);
                  setOpen(false);
                }}
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
  sessionId, agentId, agentName, onStatusChange, onOpenAgentById, onHandoff,
  knownAgentIds, agents, onboardingTargetWorkspaceId, onMemoApplied, onAcceptFork,
}: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const streamingRef = useRef<string>("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // load templates once (refresh on focus to pick up changes from templates panel)
  useEffect(() => {
    const fetch = () => api.templates().then(setTemplates).catch(() => {});
    fetch();
    window.addEventListener("focus", fetch);
    return () => window.removeEventListener("focus", fetch);
  }, []);

  const visibleTemplates = useMemo(() => {
    return templates.filter((t) => {
      // show templates bound to this agent or unbound
      if (t.agentId && t.agentId !== agentId) return false;
      if (!pickerFilter.trim()) return true;
      const q = pickerFilter.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    });
  }, [templates, agentId, pickerFilter]);

  const insertTemplate = (t: PromptTemplate) => {
    // replace the leading "/..." trigger with the template body
    setInput((cur) => {
      const m = cur.match(/^\/[^\s]*/);
      const rest = m ? cur.slice(m[0].length) : cur;
      return t.body + rest;
    });
    setShowPicker(false);
    setPickerFilter("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [dismissedForks, setDismissedForks] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [autoInjectedNotes, setAutoInjectedNotes] = useState<{ title: string }[]>([]);

  useEffect(() => {
    const fetch = () => api.notes().then(setNotes).catch(() => {});
    fetch();
    window.addEventListener("focus", fetch);
    return () => window.removeEventListener("focus", fetch);
  }, []);

  const attachNote = (n: Note) => {
    const wrapped = `<context source="${n.title}">\n${n.body}\n</context>\n\n`;
    setInput((cur) => wrapped + cur);
    setShowNotePicker(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // load history
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

  const saveTags = async (next: string[]) => {
    setTags(next);
    try { await api.updateSession(sessionId, { tags: next }); } catch {}
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    saveTags([...tags, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => saveTags(tags.filter((x) => x !== t));

  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    setSummary(null);
    try {
      const r = await api.summarize(sessionId);
      setSummary(r.summary);
    } catch (e: any) {
      setSummary(`摘要失敗:${e.message || "未知錯誤"}`);
    } finally {
      setSummarizing(false);
    }
  };

  // socket subscription
  useEffect(() => {
    const sock = getSocket();
    sock.emit("session:join", sessionId);

    const handler = (evt: any) => {
      if (evt.sessionId !== sessionId) return;
      switch (evt.type) {
        case "delta": {
          streamingRef.current += evt.payload;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.partial) {
              return [...prev.slice(0, -1), { ...last, content: streamingRef.current }];
            }
            return [...prev, { role: "assistant", content: streamingRef.current, ts: Date.now(), partial: true }];
          });
          break;
        }
        case "message": {
          streamingRef.current = "";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const finalMsg: Msg = { role: "assistant", content: evt.payload.content, ts: Date.now() };
            if (last && last.partial) return [...prev.slice(0, -1), finalMsg];
            return [...prev, finalMsg];
          });
          break;
        }
        case "status": {
          setStatus(evt.payload);
          onStatusChange?.(evt.payload);
          break;
        }
        case "result": {
          setStatus("idle");
          onStatusChange?.("idle");
          notify(`${agentName} 回應完畢`, "切回儀表板查看結果", { tag: sessionId });
          break;
        }
        case "error": {
          setMessages((prev) => [...prev, { role: "system", content: `[錯誤] ${evt.payload}`, ts: Date.now() }]);
          break;
        }
        case "notes-injected": {
          setAutoInjectedNotes(evt.payload || []);
          // clear after 8s
          setTimeout(() => setAutoInjectedNotes([]), 8000);
          break;
        }
      }
    };
    sock.on("session:event", handler);
    return () => { sock.off("session:event", handler); };
  }, [sessionId, onStatusChange]);

  // autoscroll
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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

  // detect MEMO block in latest assistant message (onboarding mode)
  const detectedMemo = useMemo(() => {
    if (!onboardingTargetWorkspaceId) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.partial) continue;
      const match = m.content.match(/=== MEMO START ===([\s\S]*?)=== MEMO END ===/);
      if (match) return match[1].trim();
    }
    return null;
  }, [messages, onboardingTargetWorkspaceId]);

  // detect ```workflow JSON block (any chat — orchestrator drafts these)
  const detectedWorkflow = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.partial) continue;
      const match = m.content.match(/```workflow\s*\n([\s\S]*?)\n```/);
      if (!match) continue;
      try {
        const wf = JSON.parse(match[1]);
        if (wf?.name && Array.isArray(wf?.steps)) return wf;
      } catch { /* keep scanning earlier */ }
    }
    return null;
  }, [messages]);

  const [applyingWf, setApplyingWf] = useState(false);
  const [appliedWf, setAppliedWf] = useState(false);

  const applyWorkflow = async () => {
    if (!detectedWorkflow) return;
    // assume current workspace = the one we're chatting in. backend uses
    // workspace from query string, which the api client already adds.
    const wsId = (await import("../lib/workspace")).getActiveWorkspace();
    setApplyingWf(true);
    try {
      await api.applyWorkflowDraft(sessionId, wsId, detectedWorkflow);
      setAppliedWf(true);
    } catch (e: any) {
      alert("套用失敗:" + e.message);
    } finally {
      setApplyingWf(false);
    }
  };

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const applyMemo = async () => {
    if (!detectedMemo || !onboardingTargetWorkspaceId) return;
    setApplying(true);
    try {
      await api.applyOnboarding(sessionId, onboardingTargetWorkspaceId, detectedMemo);
      setApplied(true);
      onMemoApplied?.();
    } catch (e) {
      alert("套用失敗:" + (e as any).message);
    } finally {
      setApplying(false);
    }
  };

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

  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const TEXT_EXT = /\.(md|txt|json|csv|tsv|log|ya?ml|html?|xml|tsx?|jsx?|py|rb|go|rs|sh|bat|sql|css|scss|toml|ini|env)$/i;

  const handleFiles = async (files: FileList | File[]) => {
    setUploading(true);
    const additions: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const isImage = file.type.startsWith("image/");
        const isText = file.type.startsWith("text/") || TEXT_EXT.test(file.name);
        const tooBig = file.size > 10 * 1024 * 1024; // 10MB cap

        if (tooBig) {
          additions.push(`[檔案太大,跳過:${file.name} (${Math.round(file.size / 1024)} KB)]`);
          continue;
        }

        if (isText && file.size < 200_000) {
          // small text: inline directly
          const text = await file.text();
          additions.push(`<file name="${file.name}">\n${text}\n</file>`);
        } else {
          // upload binary / large file
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
          });
          const base64 = dataUrl.split(",")[1];
          const { path } = await api.uploadFile(file.name, base64, "base64");
          if (isImage) {
            additions.push(`請看這張圖片:${path}`);
          } else {
            additions.push(`請用 Read 工具讀取這個檔案:${path}`);
          }
        }
      }
      if (additions.length > 0) {
        setInput((cur) => (cur ? cur + "\n\n" : "") + additions.join("\n\n") + "\n\n");
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (e: any) {
      alert("上傳失敗:" + (e.message || e));
    } finally {
      setUploading(false);
    }
  };

  return (
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
          <div className="text-sm font-medium">{agentName}</div>
          <div className="text-xs text-zinc-500">session: {sessionId.slice(0, 8)}</div>
        </div>
        <div className="flex items-center gap-3">
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
      {recommendedAgents.length > 0 && onOpenAgentById && (
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
      {autoInjectedNotes.length > 0 && (
        <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-700/30 text-xs text-emerald-300">
          📚 已自動參考筆記:{autoInjectedNotes.map((n) => n.title).join(" · ")}
        </div>
      )}
      {summary && (
        <div className="px-4 py-3 bg-amber-950/30 border-b border-amber-800/30 relative">
          <button
            onClick={() => setSummary(null)}
            className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-200 text-sm"
            title="關閉"
          >×</button>
          <div className="text-xs text-amber-300 mb-1">✨ 對話摘要</div>
          <MarkdownView className="text-zinc-200">{summary}</MarkdownView>
        </div>
      )}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 text-sm mt-12">
            開始對話 — 第一句通常 5–10 秒會回應(載入 agent 角色)
          </div>
        )}
        {messages.map((m, i) => {
          const fork = m.role === "assistant" && !m.partial ? parseFork(m.content) : null;
          const cleanContent = fork ? m.content.replace(fork.raw, "").trim() : m.content;
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
              {m.role === "assistant" ? <MarkdownView>{cleanContent || " "}</MarkdownView> : m.content}
            </div>
            {fork && (
              <ForkBanner
                fork={fork}
                agents={agents}
                fromAgentName={agentName}
                onAccept={onAcceptFork}
                dismissed={dismissedForks.has(i)}
                onDismiss={() => setDismissedForks((prev) => new Set([...prev, i]))}
              />
            )}

            {/* per-message actions */}
            {m.role !== "system" && !m.partial && (
              <div className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition ${
                m.role === "user" ? "justify-end" : ""
              }`}>
                <button
                  onClick={() => copy(m.content)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
                  title="複製"
                >📋 複製</button>
                {m.role === "user" && status !== "busy" && status !== "starting" && (
                  <button
                    onClick={() => editAndResend(i)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
                    title="把這條 prompt 載回輸入框,可編輯後再送(會清掉後面所有訊息)"
                  >✏️ 編輯重送</button>
                )}
                {m.role === "assistant" && status !== "busy" && status !== "starting" && (
                  <button
                    onClick={() => regenerate(i)}
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

      <div className="p-3 border-t border-zinc-800 bg-panel relative">
        {showNotePicker && notes.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10">
            <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800 flex items-center justify-between">
              <span>📎 選擇筆記附加到下一條訊息</span>
              <button onClick={() => setShowNotePicker(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
            </div>
            {notes.map((n) => (
              <button key={n.id} onClick={() => attachNote(n)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0">
                <div className="text-sm font-medium flex items-center gap-1">
                  {n.pinned && "📌"}
                  {n.title}
                </div>
                <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{n.body.slice(0, 80)}</div>
              </button>
            ))}
          </div>
        )}
        {showPicker && visibleTemplates.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg z-10">
            <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-800">
              📋 模板({visibleTemplates.length})— ↑↓ 選擇 · Enter 插入 · Esc 取消
            </div>
            {visibleTemplates.slice(0, 10).map((t) => (
              <button
                key={t.id}
                onClick={() => insertTemplate(t)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0"
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-zinc-500 mt-1 line-clamp-1">{t.body.slice(0, 80)}</div>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 bg-zinc-900 px-3 py-2 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent"
            rows={2}
            placeholder="跟這位員工說話… (Enter 送出 / Shift+Enter 換行 / 「/」叫出模板)"
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              const m = v.match(/^\/([^\s\n]*)$/);
              if (m) {
                setShowPicker(true);
                setPickerFilter(m[1]);
              } else {
                setShowPicker(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && showPicker) {
                setShowPicker(false);
                e.preventDefault();
                return;
              }
              if (e.key === "Enter" && showPicker && visibleTemplates.length > 0) {
                e.preventDefault();
                insertTemplate(visibleTemplates[0]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={status === "busy" || status === "starting"}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setShowNotePicker(!showNotePicker)}
              disabled={notes.length === 0}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded text-zinc-300 text-xs"
              title={notes.length === 0 ? "先去「筆記」面板建立筆記" : "附加筆記到下一條訊息"}
            >
              📎 筆記
            </button>
            <button
              onClick={send}
              disabled={status === "busy" || status === "starting" || !input.trim()}
              className="px-4 py-1 bg-accent hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm flex-1"
            >
              送出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
