export interface AgentMeta {
  id: string;
  name: string;
  description: string;
  color?: string;
  category: string;
}

export interface CategoryMeta {
  id: string;
  label: string;
  count: number;
}

export type Provider = "claude" | "codex" | "gemini";

export interface SessionRecord {
  id: string;
  agentId: string;
  title: string;
  status?: string;
  provider?: Provider;
  createdAt: number;
  updatedAt: number;
  messages: { role: "user" | "assistant" | "system"; content: string; ts: number }[];
  tags?: string[];
}

export interface RoutingDecision {
  provider: Provider;
  reason: string;
  source: "rule" | "llm" | "default" | "fallback";
  confidence?: number;
}

export interface ProviderAvailability {
  available: { claude: boolean; codex: boolean; gemini: boolean };
}

export interface TagInfo {
  name: string;
  count: number;
}

import { getActiveWorkspace } from "./workspace";

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

function withWorkspace(url: string): string {
  const ws = getActiveWorkspace();
  if (!ws) return url;
  return url + (url.includes("?") ? "&" : "?") + "workspace=" + encodeURIComponent(ws);
}

export const api = {
  // global (no workspace filter)
  agents: () => fetch("/api/agents").then(j<{ agents: AgentMeta[]; categories: CategoryMeta[] }>),
  workspaces: () => fetch("/api/workspaces").then(j<Workspace[]>),
  createWorkspace: (w: { name: string; description?: string; standingContext?: string }) =>
    fetch("/api/workspaces", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(w),
    }).then(j<Workspace>),
  updateWorkspace: (id: string, patch: Partial<Workspace>) =>
    fetch(`/api/workspaces/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Workspace>),
  deleteWorkspace: (id: string) => fetch(`/api/workspaces/${id}`, { method: "DELETE" }).then(j),
  launchWorkspaceChrome: (id: string) =>
    fetch(`/api/workspaces/${id}/launch-chrome`, { method: "POST" })
      .then(j<{ ok: boolean; alreadyRunning?: boolean; port: number; profileDir?: string; error?: string; warning?: string; playwrightEnabled?: boolean }>),
  stopWorkspaceChrome: (id: string) =>
    fetch(`/api/workspaces/${id}/stop-chrome`, { method: "POST" })
      .then(j<{ ok: boolean; port: number; killed: boolean; error?: string }>),
  dispatch: (sessionId: string, items: { agentId: string; mode: "consult" | "execute"; task: string }[]) =>
    fetch(`/api/orchestrator/${sessionId}/dispatch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).then(j<{ consulted: { agentId: string; task: string; output: string; status: "ok" | "timeout" | "error"; subSessionId: string }[]; executing?: { subSessionId: string; agentId: string }[] }>),
  exportWorkspaceUrl: (id: string) => `/api/workspaces/${id}/export`,
  importWorkspace: (bundle: any) =>
    fetch("/api/workspaces/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    }).then(j<{ workspaceId: string; imported: { notes: number; templates: number; schedules: number } }>),

  // workspace-scoped
  sessions: () => fetch(withWorkspace("/api/sessions")).then(j<SessionRecord[]>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<SessionRecord>),
  startSession: (agentId: string, title?: string, provider?: Provider) =>
    fetch(withWorkspace("/api/sessions"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, title, provider }),
    }).then(j<{ id: string; provider: Provider }>),
  routePrompt: (prompt: string, defaultProvider?: Provider) =>
    fetch("/api/route", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, defaultProvider }),
    }).then(j<RoutingDecision>),
  providers: () => fetch("/api/providers").then(j<ProviderAvailability>),
  startOrchestrator: () =>
    fetch(withWorkspace("/api/orchestrator"), { method: "POST" }).then(j<{ id: string }>),
  startOnboarding: () =>
    fetch(withWorkspace("/api/onboarding"), { method: "POST" }).then(j<{ id: string }>),
  applyOnboarding: (sessionId: string, workspaceId: string, memo: string) =>
    fetch("/api/onboarding/apply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, workspaceId, memo }),
    }).then(j<Workspace>),
  uploadFile: (name: string, content: string, encoding: "base64" | "utf8") =>
    fetch("/api/upload", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, encoding }),
    }).then(j<{ path: string; name: string; size: number }>),
  startBatch: (agentIds: string[], label?: string) =>
    fetch(withWorkspace("/api/batch"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentIds, label }),
    }).then(j<{ sessions: { sessionId: string; agentId: string }[] }>),
  mergeBatch: (prompt: string, answers: { agentId: string; agentName: string; text: string }[]) =>
    fetch("/api/batch/merge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, answers }),
    }).then(j<{ merged: string }>),
  summarize: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}/summarize`, { method: "POST" }).then(j<{ summary: string }>),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }).then(j),
  search: (q: string) =>
    fetch(withWorkspace(`/api/search?q=${encodeURIComponent(q)}`)).then(j<SearchHit[]>),
  updateSession: (id: string, patch: { title?: string; tags?: string[] }) =>
    fetch(`/api/sessions/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<SessionRecord>),
  tags: () => fetch(withWorkspace("/api/tags")).then(j<TagInfo[]>),
  schedules: () => fetch(withWorkspace("/api/schedules")).then(j<Schedule[]>),
  createSchedule: (s: Omit<Schedule, "id" | "createdAt">) =>
    fetch(withWorkspace("/api/schedules"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).then(j<Schedule>),
  updateSchedule: (id: string, patch: Partial<Schedule>) =>
    fetch(`/api/schedules/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Schedule>),
  deleteSchedule: (id: string) => fetch(`/api/schedules/${id}`, { method: "DELETE" }).then(j),
  templates: () => fetch(withWorkspace("/api/templates")).then(j<PromptTemplate[]>),
  createTemplate: (t: { name: string; body: string; agentId?: string; tags?: string[] }) =>
    fetch(withWorkspace("/api/templates"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    }).then(j<PromptTemplate>),
  updateTemplate: (id: string, patch: Partial<PromptTemplate>) =>
    fetch(`/api/templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<PromptTemplate>),
  deleteTemplate: (id: string) => fetch(`/api/templates/${id}`, { method: "DELETE" }).then(j),
  notes: () => fetch(withWorkspace("/api/notes")).then(j<Note[]>),
  createNote: (n: { title: string; body: string; pinned?: boolean }) =>
    fetch(withWorkspace("/api/notes"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(n),
    }).then(j<Note>),
  updateNote: (id: string, patch: Partial<Note>) =>
    fetch(`/api/notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Note>),
  deleteNote: (id: string) => fetch(`/api/notes/${id}`, { method: "DELETE" }).then(j),
  workflows: () => fetch(withWorkspace("/api/workflows")).then(j<Workflow[]>),
  getWorkflow: (id: string) => fetch(`/api/workflows/${id}`).then(j<Workflow>),
  createWorkflow: (w: { name: string; description?: string; steps: WorkflowStep[] }) =>
    fetch(withWorkspace("/api/workflows"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(w),
    }).then(j<Workflow>),
  updateWorkflow: (id: string, patch: Partial<Workflow>) =>
    fetch(`/api/workflows/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<Workflow>),
  deleteWorkflowApi: (id: string) => fetch(`/api/workflows/${id}`, { method: "DELETE" }).then(j),
  runWorkflow: (id: string, opts: { initialInput?: string; resumeRunId?: string; fromStepId?: string } = {}) =>
    fetch(`/api/workflows/${id}/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    }).then(j<WorkflowRun>),
  validateWorkflow: (id: string) =>
    fetch(`/api/workflows/${id}/validate`, { method: "POST" }).then(j<{ ok: boolean; error?: string; steps?: WorkflowStep[] }>),
  exportWorkflowYamlUrl: (id: string) => `/api/workflows/${id}/yaml`,
  importWorkflowYaml: (yamlText: string) =>
    fetch(withWorkspace("/api/workflows/import-yaml"), {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: yamlText,
    }).then(j<{ workflowId: string; stepCount: number; unknownAgents: string[] }>),
  cancelRun: (id: string) => fetch(`/api/runs/${id}/cancel`, { method: "POST" }).then(j),
  approveRun: (id: string) => fetch(`/api/runs/${id}/approve`, { method: "POST" }).then(j),
  loopBackRun: (id: string, stepId: string) =>
    fetch(`/api/runs/${id}/loop-back`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId }),
    }).then(j),
  mcpServers: () => fetch("/api/mcp/servers").then(j<MCPServerInfo[]>),
  workflowRuns: (id: string) => fetch(`/api/workflows/${id}/runs`).then(j<WorkflowRun[]>),
  startWorkflowDraft: () =>
    fetch(withWorkspace("/api/workflow/draft"), { method: "POST" }).then(j<{ id: string }>),
  applyWorkflowDraft: (sessionId: string, workspaceId: string, workflow: any) =>
    fetch("/api/workflow/draft/apply", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, workspaceId, workflow }),
    }).then(j<Workflow>),
  learningProposals: () => fetch(withWorkspace("/api/learning/proposals")).then(j<LearningProposal[]>),
  approveLearning: (id: string, override?: "global" | "workspace") =>
    fetch(`/api/learning/proposals/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(override ? { asScope: override } : {}),
    }).then(j),
  rejectLearning: (id: string) =>
    fetch(`/api/learning/proposals/${id}/reject`, { method: "POST" }).then(j),

  // === 自主進修 ===
  studyTiers: () =>
    fetch("/api/learning/study/tiers").then(j<{ hot: AgentUsage[]; cold: AgentUsage[]; dormant: AgentUsage[]; excluded: AgentUsage[] }>),
  studyOverride: (agentId: string, override: "hot" | "cold" | "exclude" | null) =>
    fetch("/api/learning/study/override", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, override }),
    }).then(j),
  studyRun: (agentId: string) =>
    fetch("/api/learning/study/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    }).then(j<{ runId: string }>),
  studyReport: (agentId: string) =>
    fetch(`/api/learning/study/report/${agentId}`).then(j<any>),
  studySchedules: () =>
    fetch("/api/learning/study/schedules").then(j<StudySchedule[]>),
  studyPatchSchedule: (tier: string, patch: { enabled?: boolean; cron?: string; perRunCap?: number }) =>
    fetch(`/api/learning/study/schedules/${tier}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j),

  // === Legacy 重審 ===
  legacyCraft: () => fetch("/api/learning/legacy/craft").then(j<LegacyMemoryEntry[]>),
  legacyCategory: () => fetch("/api/learning/legacy/category").then(j<LegacyMemoryEntry[]>),
  promoteLegacyCraft: (agentId: string, toScope: "global" | "workspace", toWorkspaceId?: string) =>
    fetch(`/api/learning/legacy/craft/${encodeURIComponent(agentId)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toScope, toWorkspaceId: toWorkspaceId || "" }),
    }).then(j),
  promoteLegacyCategory: (category: string, toScope: "global" | "workspace", toWorkspaceId?: string) =>
    fetch(`/api/learning/legacy/category/${encodeURIComponent(category)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toScope, toWorkspaceId: toWorkspaceId || "" }),
    }).then(j),
  deleteLegacyCraft: (agentId: string) =>
    fetch(`/api/learning/legacy/craft/${encodeURIComponent(agentId)}`, { method: "DELETE" }).then(j),
  deleteLegacyCategory: (category: string) =>
    fetch(`/api/learning/legacy/category/${encodeURIComponent(category)}`, { method: "DELETE" }).then(j),
};

export interface AgentUsage {
  agentId: string;
  name: string;
  sessions30d: number;
  sessions90d: number;
  lastResearchedAt: number | null;
  override: "hot" | "cold" | "exclude" | null;
}

export interface StudySchedule {
  tier: "hot" | "cold";
  cron: string;
  enabled: boolean;
  perRunCap: number;
  lastRunAt?: number;
}

export interface LegacyMemoryEntry {
  // craft: agentId + workspaceId='' + scope='legacy-global'
  // category: category + workspaceId='' + scope='legacy-global'
  agentId?: string;
  category?: string;
  workspaceId: string;
  scope: "legacy-global";
  content: string;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  standingContext: string;
  memory: string;
  enabledMcps: string[];
  chromeCdpPort?: number;
  createdAt: number;
}

export interface MCPServerInfo {
  name: string;
  type?: string;
  command?: string;
  url?: string;
  hasAuth?: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Schedule {
  id: string;
  name: string;
  agentId: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface SearchHit {
  sessionId: string;
  title: string;
  agentId: string;
  updatedAt: number;
  titleHit: boolean;
  matchCount: number;
  matches: { ts: number; role: string; snippet: string }[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
  agentId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStep {
  id?: string;
  agentId: string;
  prompt: string;
  dependsOn?: string[];
  dependsOnMode?: "all" | "any";
  pauseBefore?: boolean;
  skipIfMatch?: string;
  retries?: number;
  provider?: Provider | "auto";
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workspaceId: string;
  status: "running" | "paused" | "done" | "error" | "cancelled";
  currentStep: number;
  sessionIds: string[];
  stepOutputs?: Record<string, string>;
  iterations?: Record<string, number>;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface LearningProposal {
  id: string;
  agentId: string;
  workspaceId: string;
  kind: "fact" | "craft" | "domain" | "calibration";
  scope: "workspace" | "agent-global" | "category";
  content: string;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}
