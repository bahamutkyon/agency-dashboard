import { useEffect, useMemo, useState } from "react";
import { AgentSidebar } from "./components/AgentSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { SchedulePanel } from "./components/SchedulePanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { TemplatesPanel } from "./components/TemplatesPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { UsageBar } from "./components/UsageBar";
import { SecurityBadge } from "./components/SecurityBadge";
import { CapabilitiesBadge } from "./components/CapabilitiesBadge";
import { RemoteAccessBadge } from "./components/RemoteAccessBadge";
import { AgentMeetingRoom } from "./components/AgentMeetingRoom";
import { BatchPanel } from "./components/BatchPanel";
import { NotesPanel } from "./components/NotesPanel";
import { WorkflowsPanel } from "./components/WorkflowsPanel";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { CommandPalette } from "./components/CommandPalette";
import { OnboardingTour } from "./components/OnboardingTour";
import { isTourDone } from "./lib/tour";
import { getSocket } from "./lib/socket";
import { applyAll } from "./lib/settings";
import { api, type AgentMeta, type CategoryMeta } from "./lib/api";

type View =
  | { kind: "chat"; sessionId: string }
  | { kind: "schedules" }
  | { kind: "history" }
  | { kind: "templates" }
  | { kind: "settings" }
  | { kind: "batch" }
  | { kind: "notes" }
  | { kind: "workflows" }
  | { kind: "meeting-room"; agentId: string };

interface Tab {
  sessionId: string;
  agentId: string;
  agentName: string;
  /** 對話主題(autoTitler 產或 user 自取)— 跟 agentName 不同時就顯示為 subtitle */
  topic?: string;
  status: string;
  provider?: "claude" | "codex" | "gemini";
  onboardingTargetWorkspaceId?: string;
}

export default function App() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    // Mobile (<768px): default closed unless user explicitly opened before.
    // Desktop: default open unless user explicitly closed before.
    const stored = localStorage.getItem("agency:sidebar");
    if (stored === "open") return true;
    if (stored === "closed") return false;
    return typeof window !== "undefined" && window.innerWidth >= 768;
  });

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    localStorage.setItem("agency:sidebar", next ? "open" : "closed");
  };

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // first-run: launch tour automatically once agents are loaded
  useEffect(() => {
    if (agents.length > 0 && !isTourDone()) {
      const t = setTimeout(() => setTourOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, [agents.length]);

  // listen for "show tour" signal from Settings panel
  useEffect(() => {
    const h = () => setTourOpen(true);
    window.addEventListener("agency:show-tour", h);
    return () => window.removeEventListener("agency:show-tour", h);
  }, []);

  // global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sidebarOpen]);

  useEffect(() => {
    applyAll();
    api.agents().then(({ agents, categories }) => {
      setAgents(agents);
      setCategories(categories);
    });
  }, []);

  // session counts by agent — for sidebar 「💬 N」 badges. Refetched whenever
  // workspace changes, tabs change, or user comes back to a panel view.
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    api.sessions().then((all) => {
      if (!alive) return;
      const counts: Record<string, number> = {};
      for (const s of all) counts[s.agentId] = (counts[s.agentId] || 0) + 1;
      setSessionCounts(counts);
    }).catch(() => {});
    return () => { alive = false; };
  }, [reloadKey, tabs.length, view?.kind]);

  // When the workspace changes, drop all open tabs (they belong to the old
  // workspace) and force-reload the active panel by bumping reloadKey.
  const onWorkspaceSwitched = () => {
    setTabs([]);
    setView(null);
    setReloadKey((k) => k + 1);
  };

  const liveAgentIds = useMemo(() => new Set(tabs.map((t) => t.agentId)), [tabs]);
  const knownAgentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const openAgentById = async (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (agent) await openAgent(agent);
  };

  const [providersAvail, setProvidersAvail] = useState({ claude: true, codex: false, gemini: false });
  useEffect(() => {
    api.providers().then((p) => setProvidersAvail(p.available)).catch(() => {});
  }, []);

  /**
   * Click an agent in sidebar:
   *   - If there's already an open tab for this agent (current session) → switch to it
   *   - Otherwise open the agent's meeting room (lists past sessions + 「+ 開新會議」)
   *
   * Old behavior of "always start a new session" is now `startNewMeeting()`.
   */
  const openAgent = async (agent: AgentMeta, _provider?: "claude" | "codex" | "gemini") => {
    const existing = tabs.find((t) => t.agentId === agent.id);
    if (existing) {
      setView({ kind: "chat", sessionId: existing.sessionId });
      return;
    }
    setView({ kind: "meeting-room", agentId: agent.id });
  };

  /** Actually create a new session with this agent + custom topic. */
  const startNewMeeting = async (agent: AgentMeta, topic: string, provider?: "claude" | "codex" | "gemini") => {
    const title = topic.trim() ? `${agent.name} · ${topic.trim()}` : undefined;
    const r = await api.startSession(agent.id, title, provider);
    setTabs((prev) => [...prev, {
      sessionId: r.id, agentId: agent.id, agentName: agent.name,
      topic: topic.trim() || undefined,
      status: "idle", provider: r.provider,
    }]);
    setView({ kind: "chat", sessionId: r.id });
  };

  const askOrchestrator = async () => {
    const { id } = await api.startOrchestrator();
    setTabs((prev) => [...prev, { sessionId: id, agentId: "agents-orchestrator", agentName: "👨‍💼 專案經理", status: "idle" }]);
    setView({ kind: "chat", sessionId: id });
  };

  const openSchedules = () => setView({ kind: "schedules" });
  const openHistory = () => setView({ kind: "history" });
  const openTemplates = () => setView({ kind: "templates" });
  const openSettings = () => setView({ kind: "settings" });
  const openBatch = () => setView({ kind: "batch" });
  const openNotes = () => setView({ kind: "notes" });
  const openWorkflows = () => setView({ kind: "workflows" });

  const openOnboarding = (sessionId: string, draftWorkspaceId?: string) => {
    setTabs((prev) => [...prev, {
      sessionId,
      agentId: "agents-orchestrator",
      agentName: "🤖 工作區設定顧問",
      status: "idle",
      onboardingTargetWorkspaceId: draftWorkspaceId,
    }]);
    setView({ kind: "chat", sessionId });
  };

  // handoff: open a new chat with `agentId` and inject the message as the
  // first user input, framed as a handoff from the previous agent.
  const handoff = async (toAgentId: string, message: string, fromAgentName: string) => {
    const agent = agents.find((a) => a.id === toAgentId);
    if (!agent) return;
    const { id } = await api.startSession(agent.id, `${agent.name}(從 ${fromAgentName} 接手)`);
    setTabs((prev) => [...prev, { sessionId: id, agentId: agent.id, agentName: agent.name, status: "idle" }]);
    setView({ kind: "chat", sessionId: id });
    const handoffPrompt = `以下是另一位 agent(${fromAgentName})的產出,請接手繼續處理。請依你的專業判斷:評論、修改、延伸、或拒絕。

\`\`\`
${message}
\`\`\``;
    setTimeout(() => {
      getSocket().emit("session:send", { sessionId: id, text: handoffPrompt });
    }, 500);
  };

  const openHistorySession = (sessionId: string, agentId: string, title: string) => {
    const existing = tabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      setView({ kind: "chat", sessionId });
      return;
    }
    // Resolve agent name from the agents catalog so the tab always shows
    // "who" first; topic (title minus agent prefix) becomes a subtitle.
    const agent = agents.find((a) => a.id === agentId);
    const agentName = agent?.name || agentId;
    const isDefaultTitle =
      title === `${agentId} 對話` ||
      title === agentName ||
      title.endsWith(" 對話");
    // Strip leading "{agentName} · " prefix from auto-titled / meeting-room titles
    let topic: string | undefined;
    if (!isDefaultTitle) {
      const prefix = `${agentName} · `;
      topic = title.startsWith(prefix) ? title.slice(prefix.length) : title;
    }
    setTabs((prev) => [...prev, { sessionId, agentId, agentName, topic, status: "idle" }]);
    setView({ kind: "chat", sessionId });
  };

  const closeTab = async (sessionId: string) => {
    setTabs((prev) => prev.filter((t) => t.sessionId !== sessionId));
    if (view?.kind === "chat" && view.sessionId === sessionId) {
      const remaining = tabs.filter((t) => t.sessionId !== sessionId);
      setView(remaining[0] ? { kind: "chat", sessionId: remaining[0].sessionId } : null);
    }
    try { await api.deleteSession(sessionId); } catch {}
  };

  const updateStatus = (sessionId: string, status: string) => {
    setTabs((prev) => prev.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)));
  };

  // tab drag-to-reorder
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const reorderTabs = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.sessionId === fromId);
      const toIdx = prev.findIndex((t) => t.sessionId === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const isView = (k: View["kind"]) => view?.kind === k;

  return (
    <div className="h-screen flex">
      {tourOpen && <OnboardingTour onClose={() => setTourOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        agents={agents}
        onPickAgent={openAgent}
        onPickSession={openHistorySession}
        onOpenView={(v) => setView({ kind: v })}
        onAskOrchestrator={askOrchestrator}
      />
      {sidebarOpen && (
        <>
          {/* mobile backdrop — tap outside sidebar to close */}
          <div
            onClick={toggleSidebar}
            className="md:hidden fixed inset-0 bg-black/60 z-30"
            aria-hidden="true"
          />
          <div className="fixed md:static inset-y-0 left-0 z-40 md:z-auto h-full">
            <AgentSidebar
              agents={agents}
              categories={categories}
              liveAgentIds={liveAgentIds}
              sessionCounts={sessionCounts}
              onPick={(a, p) => { openAgent(a, p); if (window.innerWidth < 768) toggleSidebar(); }}
              onAskOrchestrator={() => { askOrchestrator(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenSchedules={() => { openSchedules(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenHistory={() => { openHistory(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenTemplates={() => { openTemplates(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenSettings={() => { openSettings(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenBatch={() => { openBatch(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenNotes={() => { openNotes(); if (window.innerWidth < 768) toggleSidebar(); }}
              onOpenWorkflows={() => { openWorkflows(); if (window.innerWidth < 768) toggleSidebar(); }}
              providersAvail={providersAvail}
            />
          </div>
        </>
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-12 md:h-10 bg-panel border-b border-zinc-800 flex items-center pr-2 gap-1 pt-[env(safe-area-inset-top)]">
          <button
            onClick={toggleSidebar}
            className="px-3 md:px-2 h-full hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 text-base md:text-sm"
            title={sidebarOpen ? "收合側欄 (Ctrl+B)" : "展開側欄 (Ctrl+B)"}
            aria-label="切換側欄"
          >
            <span className="md:hidden">☰</span>
            <span className="hidden md:inline">{sidebarOpen ? "◀" : "▶"}</span>
          </button>
          <div className="flex-1 flex items-center px-2 gap-1 overflow-x-auto h-full">
          {tabs.length === 0 && !view && (
            <div className="text-xs text-zinc-500 px-2">點左邊任一 agent 開始對話</div>
          )}
          {tabs.map((t) => (
            <div
              key={t.sessionId}
              draggable
              onDragStart={(e) => {
                setDraggingTab(t.sessionId);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingTab) reorderTabs(draggingTab, t.sessionId);
                setDraggingTab(null);
              }}
              onDragEnd={() => setDraggingTab(null)}
              onClick={() => setView({ kind: "chat", sessionId: t.sessionId })}
              className={`flex items-center gap-2 pl-3 pr-1 py-1 rounded text-xs cursor-pointer ${
                view?.kind === "chat" && view.sessionId === t.sessionId ? "bg-zinc-800" : "hover:bg-zinc-900"
              } ${draggingTab === t.sessionId ? "opacity-40" : ""}`}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  t.status === "busy" ? "bg-amber-400 animate-pulse" :
                  t.status === "error" ? "bg-rose-500" : "bg-emerald-400"
                }`}
              />
              <span className="flex items-baseline gap-1.5 min-w-0" title={t.topic ? `${t.agentName} · ${t.topic}` : t.agentName}>
                <span className="truncate">{t.agentName}</span>
                {t.topic && (
                  <span className="text-zinc-500 text-[10px] truncate hidden sm:inline">· {t.topic}</span>
                )}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(t.sessionId); }}
                className="text-zinc-500 hover:text-zinc-200 px-1 flex-shrink-0"
                title="關閉"
              >×</button>
            </div>
          ))}
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-zinc-800 flex-shrink-0">
            <WorkspaceSwitcher
              onSwitched={onWorkspaceSwitched}
              onOpenOnboarding={openOnboarding}
              hasActiveTabs={tabs.length > 0}
            />
            <UsageBar />
            <SecurityBadge />
            <CapabilitiesBadge />
            <RemoteAccessBadge />
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isView("schedules") && <SchedulePanel key={`s-${reloadKey}`} agents={agents} />}
          {isView("history") && <HistoryPanel key={`h-${reloadKey}`} agents={agents} onOpen={openHistorySession} />}
          {view?.kind === "meeting-room" && (() => {
            const a = agents.find((x) => x.id === view.agentId);
            if (!a) return <div className="p-6 text-zinc-500">找不到 agent: {view.agentId}</div>;
            return (
              <AgentMeetingRoom
                key={`mr-${view.agentId}-${reloadKey}`}
                agent={a}
                onOpen={openHistorySession}
                onStartNew={(agent, topic) => startNewMeeting(agent, topic)}
                onClose={() => setView(null)}
              />
            );
          })()}
          {isView("templates") && <TemplatesPanel key={`t-${reloadKey}`} agents={agents} />}
          {isView("settings") && <SettingsPanel />}
          {isView("batch") && <BatchPanel key={`b-${reloadKey}`} agents={agents} />}
          {isView("notes") && <NotesPanel key={`n-${reloadKey}`} />}
          {isView("workflows") && (
            <WorkflowsPanel
              key={`w-${reloadKey}`}
              agents={agents}
              onOpenSession={openHistorySession}
              onLaunchDraftAssistant={(sid) => {
                setTabs((prev) => [...prev, {
                  sessionId: sid, agentId: "agents-orchestrator",
                  agentName: "🔗 Workflow 設計顧問", status: "idle",
                }]);
                setView({ kind: "chat", sessionId: sid });
              }}
            />
          )}
          {isView("chat") && (() => {
            const tab = tabs.find((t) => view?.kind === "chat" && t.sessionId === view.sessionId);
            return tab ? (
              <ChatWindow
                key={tab.sessionId}
                sessionId={tab.sessionId}
                agentId={tab.agentId}
                agentName={tab.agentName}
                provider={tab.provider}
                onStatusChange={(s) => updateStatus(tab.sessionId, s)}
                onOpenAgentById={openAgentById}
                knownAgentIds={knownAgentIds}
                onHandoff={handoff}
                agents={agents}
                onboardingTargetWorkspaceId={tab.onboardingTargetWorkspaceId}
                onMemoApplied={() => setReloadKey((k) => k + 1)}
                onAcceptFork={handoff}
              />
            ) : null;
          })()}
          {!view && (
            <div className="h-full flex items-center justify-center text-zinc-600">
              <div className="text-center">
                <div className="text-2xl mb-2">🏢 專家團隊儀表板</div>
                <div className="text-sm">211 位專家就緒,左側挑一位開始對話</div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
