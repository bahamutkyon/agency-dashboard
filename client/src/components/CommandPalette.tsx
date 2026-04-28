import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMeta, SearchHit } from "../lib/api";
import { api } from "../lib/api";

interface Action {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  group: "panel" | "agent" | "search" | "tab";
}

interface Props {
  agents: AgentMeta[];
  open: boolean;
  onClose: () => void;
  onPickAgent: (a: AgentMeta) => void;
  onPickSession: (sessionId: string, agentId: string, title: string) => void;
  onOpenView: (view: "history" | "templates" | "schedules" | "notes" | "batch" | "settings") => void;
  onAskOrchestrator: () => void;
}

export function CommandPalette({ agents, open, onClose, onPickAgent, onPickSession, onOpenView, onAskOrchestrator }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setHits([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // global ESC to close
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // debounced full-text search across conversations
  useEffect(() => {
    if (!open || !query.trim()) { setHits([]); return; }
    const handle = setTimeout(() => {
      api.search(query.trim()).then(setHits).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  const actions = useMemo<Action[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (s: string) => !q || s.toLowerCase().includes(q);

    const panelActions: Action[] = [
      { id: "p:orchestrator", group: "panel", label: "👨‍💼 找專案經理討論", hint: "Enter", run: onAskOrchestrator },
      { id: "p:batch", group: "panel", label: "🎯 批次同題", run: () => onOpenView("batch") },
      { id: "p:notes", group: "panel", label: "📒 共享筆記", run: () => onOpenView("notes") },
      { id: "p:templates", group: "panel", label: "📋 Prompt 模板庫", run: () => onOpenView("templates") },
      { id: "p:schedules", group: "panel", label: "⏰ 排程管理", run: () => onOpenView("schedules") },
      { id: "p:history", group: "panel", label: "📚 歷史對話", run: () => onOpenView("history") },
      { id: "p:settings", group: "panel", label: "⚙️ 設定", run: () => onOpenView("settings") },
    ];

    const agentActions: Action[] = agents
      .filter((a) => matches(a.name) || matches(a.id) || matches(a.description))
      .slice(0, 12)
      .map((a) => ({
        id: `a:${a.id}`,
        group: "agent",
        label: a.name,
        hint: a.category,
        run: () => onPickAgent(a),
      }));

    const searchActions: Action[] = hits.slice(0, 8).map((h) => ({
      id: `s:${h.sessionId}`,
      group: "search",
      label: h.title,
      hint: `${h.matchCount} 處命中 · ${agents.find((a) => a.id === h.agentId)?.name || h.agentId}`,
      run: () => onPickSession(h.sessionId, h.agentId, h.title),
    }));

    return [
      ...panelActions.filter((a) => matches(a.label)),
      ...agentActions,
      ...searchActions,
    ];
  }, [query, agents, hits, onAskOrchestrator, onOpenView, onPickAgent, onPickSession]);

  // clamp cursor
  useEffect(() => {
    if (cursor >= actions.length) setCursor(Math.max(0, actions.length - 1));
  }, [actions.length, cursor]);

  if (!open) return null;

  const groups = {
    panel: actions.filter((a) => a.group === "panel"),
    agent: actions.filter((a) => a.group === "agent"),
    search: actions.filter((a) => a.group === "search"),
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92vw] bg-panel border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full bg-zinc-900 px-4 py-3 text-sm focus:outline-none"
          placeholder="搜尋功能 / agent / 對話內容…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(actions.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter" && actions[cursor]) {
              e.preventDefault();
              actions[cursor].run();
              onClose();
            }
          }}
        />
        <div className="max-h-[60vh] overflow-y-auto">
          {actions.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-500 text-sm">沒有匹配項目</div>
          )}
          {groups.panel.length > 0 && (
            <Section title="功能">
              {groups.panel.map((a) => (
                <Row key={a.id} action={a} active={actions.indexOf(a) === cursor}
                  onClick={() => { a.run(); onClose(); }} />
              ))}
            </Section>
          )}
          {groups.agent.length > 0 && (
            <Section title="Agent">
              {groups.agent.map((a) => (
                <Row key={a.id} action={a} active={actions.indexOf(a) === cursor}
                  onClick={() => { a.run(); onClose(); }} />
              ))}
            </Section>
          )}
          {groups.search.length > 0 && (
            <Section title="對話內容命中">
              {groups.search.map((a) => (
                <Row key={a.id} action={a} active={actions.indexOf(a) === cursor}
                  onClick={() => { a.run(); onClose(); }} />
              ))}
            </Section>
          )}
        </div>
        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 flex justify-between">
          <span>↑↓ 移動 · Enter 開啟 · Esc 關閉</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] uppercase text-zinc-500 bg-zinc-900/50 sticky top-0">{title}</div>
      {children}
    </div>
  );
}

function Row({ action, active, onClick }: { action: Action; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 ${
        active ? "bg-accent/30" : "hover:bg-zinc-800"
      }`}
    >
      <span className="text-sm truncate">{action.label}</span>
      {action.hint && <span className="text-[11px] text-zinc-500 flex-shrink-0">{action.hint}</span>}
    </button>
  );
}
