import { useEffect, useMemo, useState } from "react";
import { AgentSidebar } from "./components/AgentSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { SchedulePanel } from "./components/SchedulePanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { TemplatesPanel } from "./components/TemplatesPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { UsageBar } from "./components/UsageBar";
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
  | { kind: "workflows" };

interface Tab {
  sessionId: string;
  agentId: string;
  agentName: string;
  status: string;
  onboardingTargetWorkspaceId?: string;
}

export default function App() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    localStorage.getItem("agency:sidebar") !== "closed"
  );

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

  const openAgent = async (agent: AgentMeta) => {
    const existing = tabs.find((t) => t.agentId === agent.id);
    if (existing) {
      setView({ kind: "chat", sessionId: existing.sessionId });
      return;
    }
    const { id } = await api.startSession(agent.id, agent.name);
    setTabs((prev) => [...prev, { sessionId: id, agentId: agent.id, agentName: agent.name, status: "idle" }]);
    setView({ kind: "chat", sessionId: id });
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
    setTabs((prev) => [...prev, { sessionId, agentId, agentName: title, status: "idle" }]);
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
        <AgentSidebar
          agents={agents}
          categories={categories}
          liveAgentIds={liveAgentIds}
          onPick={openAgent}
          onAskOrchestrator={askOrchestrator}
          onOpenSchedules={openSchedules}
          onOpenHistory={openHistory}
          onOpenTemplates={openTemplates}
          onOpenSettings={openSettings}
          onOpenBatch={openBatch}
          onOpenNotes={openNotes}
          onOpenWorkflows={openWorkflows}
        />
      )}

      <main className="flex-1 flex flex-col">
        <div className="h-10 bg-panel border-b border-zinc-800 flex items-center pr-2 gap-1">
          <button
            onClick={toggleSidebar}
            className="px-2 h-full hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            title={sidebarOpen ? "收合側欄 (Ctrl+B)" : "展開側欄 (Ctrl+B)"}
          >
            {sidebarOpen ? "◀" : "▶"}
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
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  t.status === "busy" ? "bg-amber-400 animate-pulse" :
                  t.status === "error" ? "bg-rose-500" : "bg-emerald-400"
                }`}
              />
              <span>{t.agentName}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(t.sessionId); }}
                className="text-zinc-500 hover:text-zinc-200 px-1"
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
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {isView("schedules") && <SchedulePanel key={`s-${reloadKey}`} agents={agents} />}
          {isView("history") && <HistoryPanel key={`h-${reloadKey}`} agents={agents} onOpen={openHistorySession} />}
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
