import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentMeta } from "../lib/api";
import { getSocket } from "../lib/socket";
import { MarkdownView } from "./MarkdownView";

interface Props {
  agents: AgentMeta[];
}

interface Pane {
  sessionId: string;
  agentId: string;
  status: "idle" | "starting" | "busy" | "error" | "closed";
  text: string;
  done: boolean;
}

export function BatchPanel({ agents }: Props) {
  const [step, setStep] = useState<"setup" | "running">("setup");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [panes, setPanes] = useState<Pane[]>([]);
  const buffersRef = useRef<Record<string, string>>({});

  const cats = useMemo(() => {
    const set = new Set(agents.map((a) => a.category));
    return Array.from(set);
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (category && a.category !== category) return false;
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [agents, category, filter]);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const launch = async () => {
    if (picked.size === 0 || !prompt.trim()) return;
    const ids = Array.from(picked);
    const label = prompt.slice(0, 24).replace(/\s+/g, " ");
    const { sessions } = await api.startBatch(ids, label);

    const sock = getSocket();
    const initial: Pane[] = sessions.map((s) => ({
      sessionId: s.sessionId,
      agentId: s.agentId,
      status: "starting",
      text: "",
      done: false,
    }));
    setPanes(initial);
    buffersRef.current = {};
    setStep("running");

    // join all sessions, then send the same prompt to each
    for (const s of sessions) {
      sock.emit("session:join", s.sessionId);
    }
    setTimeout(() => {
      for (const s of sessions) {
        sock.emit("session:send", { sessionId: s.sessionId, text: prompt });
      }
    }, 200);
  };

  useEffect(() => {
    if (step !== "running") return;
    const sock = getSocket();
    const handler = (evt: any) => {
      const sid = evt.sessionId;
      setPanes((prev) => prev.map((p) => {
        if (p.sessionId !== sid) return p;
        if (evt.type === "delta") {
          buffersRef.current[sid] = (buffersRef.current[sid] || "") + evt.payload;
          return { ...p, text: buffersRef.current[sid] };
        }
        if (evt.type === "message") {
          buffersRef.current[sid] = evt.payload.content;
          return { ...p, text: evt.payload.content };
        }
        if (evt.type === "status") {
          return { ...p, status: evt.payload };
        }
        if (evt.type === "result") {
          return { ...p, done: true, status: "idle" };
        }
        if (evt.type === "error") {
          return { ...p, status: "error", text: (p.text + "\n[錯誤] " + evt.payload).trim() };
        }
        return p;
      }));
    };
    sock.on("session:event", handler);
    return () => { sock.off("session:event", handler); };
  }, [step]);

  const reset = () => {
    setStep("setup");
    setPanes([]);
    buffersRef.current = {};
    setMerged(null);
  };

  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<string | null>(null);

  const mergeAll = async () => {
    if (merging) return;
    const answers = panes.filter((p) => p.text.trim()).map((p) => ({
      agentId: p.agentId,
      agentName: agents.find((a) => a.id === p.agentId)?.name || p.agentId,
      text: p.text,
    }));
    if (answers.length < 2) {
      alert("至少需要 2 個 agent 完成回答才能合併");
      return;
    }
    setMerging(true);
    try {
      const r = await api.mergeBatch(prompt, answers);
      setMerged(r.merged);
    } catch (e: any) {
      alert("合併失敗:" + e.message);
    } finally {
      setMerging(false);
    }
  };

  const exportAll = () => {
    const lines = [
      `# 批次任務結果`,
      ``,
      `**指令:** ${prompt}`,
      `**時間:** ${new Date().toLocaleString("zh-TW", { hour12: false })}`,
      ``,
      `---`,
      ``,
    ];
    for (const p of panes) {
      const a = agents.find((x) => x.id === p.agentId);
      lines.push(`## ${a?.name || p.agentId}`);
      lines.push("");
      lines.push(p.text || "(無回應)");
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `批次-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (step === "setup") {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">🎯 批次同題</h2>
            <p className="text-xs text-zinc-500 mt-1">
              選多位 agent,丟同一個 prompt,並排比較結果。
              <span className="text-amber-400 ml-2">注意:</span>
              <span>選 N 位 agent ≈ 燒 N 倍 token,小心 5 小時 quota。</span>
            </p>
          </div>

          <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
            <div>
              <label className="text-xs text-zinc-400">指令(每位 agent 都會收到這段)</label>
              <textarea
                className="w-full mt-1 bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                rows={4}
                placeholder="例如:幫我為新產品「AI 工具學習營」寫一篇 IG 主貼文,400 字內,結尾 hashtag"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">選擇 agents · 已選 {picked.size}</div>
              <input
                className="bg-zinc-900 px-3 py-1.5 rounded text-xs w-48"
                placeholder="搜尋…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1 mb-3 text-xs">
              <button onClick={() => setCategory(null)}
                className={`px-2 py-1 rounded ${category === null ? "bg-accent text-white" : "bg-zinc-800 hover:bg-zinc-700"}`}>
                全部
              </button>
              {cats.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-2 py-1 rounded ${category === c ? "bg-accent text-white" : "bg-zinc-800 hover:bg-zinc-700"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
              {filteredAgents.map((a) => {
                const on = picked.has(a.id);
                return (
                  <label key={a.id}
                    className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                      on ? "bg-accent/10 border-accent/50" : "bg-zinc-900 border-zinc-800 hover:border-zinc-600"
                    }`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-zinc-500 line-clamp-2">{a.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <button
            onClick={launch}
            disabled={picked.size === 0 || !prompt.trim()}
            className="w-full py-3 rounded bg-accent hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium"
          >
            🚀 同時派工給 {picked.size} 位 agent
          </button>
        </div>
      </div>
    );
  }

  // running view
  const allDone = panes.every((p) => p.done);
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-zinc-800 bg-panel flex items-center justify-between">
        <div className="text-xs">
          <span className="font-medium">🎯 批次任務</span>
          <span className="text-zinc-500 ml-2">{prompt.slice(0, 80)}{prompt.length > 80 ? "…" : ""}</span>
        </div>
        <div className="flex gap-2">
          {allDone && panes.length >= 2 && (
            <button
              onClick={mergeAll}
              disabled={merging}
              className="text-xs px-3 py-1 bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 disabled:opacity-50 rounded text-white"
            >
              {merging ? "合併中…" : "✨ 合併最佳版本"}
            </button>
          )}
          <button onClick={exportAll} className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
            匯出全部 .md
          </button>
          <button onClick={reset} className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
            {allDone ? "重新發題" : "返回"}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {merged && (
          <div className="mb-3 bg-gradient-to-br from-amber-950/30 to-rose-950/30 border border-amber-500/40 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-amber-300">✨ 整合最佳版本</div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(merged)}
                  className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
                >複製</button>
                <button
                  onClick={() => setMerged(null)}
                  className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
                >關閉</button>
              </div>
            </div>
            <MarkdownView className="text-zinc-100">{merged}</MarkdownView>
          </div>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(320px, 1fr))` }}>
          {panes.map((p) => {
            const a = agents.find((x) => x.id === p.agentId);
            return (
              <div key={p.sessionId} className="bg-panel border border-zinc-800 rounded-lg flex flex-col h-[60vh]">
                <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
                  <div className="text-sm font-medium truncate">{a?.name || p.agentId}</div>
                  <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    p.status === "busy" ? "bg-amber-400 animate-pulse" :
                    p.status === "starting" ? "bg-sky-400 animate-pulse" :
                    p.status === "error" ? "bg-rose-500" :
                    p.done ? "bg-emerald-400" : "bg-zinc-600"
                  }`} />
                </div>
                <div className="flex-1 overflow-y-auto p-3 text-sm whitespace-pre-wrap text-zinc-200">
                  {p.text || (
                    <span className="text-zinc-600 italic">等待回應…</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
