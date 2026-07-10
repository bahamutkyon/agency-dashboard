export interface AutonomyRun {
  id: string;
  sessionId: string;
  workspaceId: string;
  goal: string;
  status: string;
  stepCount: number;
  maxSteps: number;
  startedAt: number;
  deadlineAt: number;
  policy?: string;
  pendingInjection?: string;
}

export interface DispatchItem {
  agentId: string;
  mode: "consult" | "execute";
  task: string;
  context?: string;
  deliverable?: string;
  accept?: string[];
}

export interface PendingAction {
  id: string;
  runId?: string;
  sessionId: string;
  kind: string;
  risk: string;
  summary: string;
  detail?: string;
  status: string;
  parsedItems?: DispatchItem[];
}

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

export interface BriefingItem {
  title: string;
  body: string;
  workspaceId?: string;
  discussSeed?: string;
  action?: { type: "approve" | "reject"; proposalIds: string[] };
}

export interface BriefingSection {
  kind: "decisions" | "new_items" | "status" | "learning";
  title: string;
  items: BriefingItem[];
}

export interface Briefing {
  date: string;
  generatedAt: number;
  sections: BriefingSection[];
}

export interface BriefingRow {
  id: string;
  date: string;
  content: Briefing | null;
  raw: string;
  status: "ok" | "parse_failed" | "error";
  createdAt: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  memory: string;
  createdAt: number;
  updatedAt: number;
}

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
  projectId?: string;
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

/** Structured API error that includes the HTTP status code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Registered callbacks invoked whenever a 401 response is received. */
const unauthorizedCallbacks = new Set<() => void>();

/**
 * Subscribe to 401 Unauthorized responses from any API call.
 * Returns an unsubscribe function.
 *
 * @example
 * const unsub = onUnauthorized(() => setBannerVisible(true));
 * // later: unsub();
 */
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedCallbacks.add(cb);
  return () => unauthorizedCallbacks.delete(cb);
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text();
    if (r.status === 401) {
      for (const cb of unauthorizedCallbacks) cb();
    }
    throw new ApiError(r.status, text);
  }
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
  approveRun: (id: string) => fetch(`/api/runs/${id}/approve`, { method: "POST" }).then(j<{ ok: boolean; newRunId?: string }>),
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

  // === 自主迴圈 ===
  autonomyStart: (sessionId: string, goal: string, opts?: { policy?: string; maxSteps?: number; maxWallMs?: number }) =>
    fetch("/api/autonomy/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, goal, ...opts }),
    }).then(j<{ runId: string }>),
  autonomyRun: (sid: string) =>
    fetch(`/api/autonomy/sessions/${sid}/run`).then(j<{ run: AutonomyRun | null }>),
  autonomyPending: (sid: string) =>
    fetch(`/api/autonomy/sessions/${sid}/pending`).then(j<{ pending: PendingAction[] }>),
  autonomyApprovePlan: (runId: string) =>
    fetch(`/api/autonomy/runs/${runId}/approve-plan`, { method: "POST" }).then(j),
  autonomyStop: (runId: string) =>
    fetch(`/api/autonomy/runs/${runId}/stop`, { method: "POST" }).then(j),
  autonomyResume: (runId: string) =>
    fetch(`/api/autonomy/runs/${runId}/resume`, { method: "POST" }).then(j),
  autonomyInput: (runId: string, text: string) =>
    fetch(`/api/autonomy/runs/${runId}/input`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(j),
  autonomyInject: (runId: string, text: string) =>
    fetch(`/api/autonomy/runs/${runId}/inject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(j<{ ok: boolean }>),
  actionApprove: (id: string, payload?: { items?: DispatchItem[] }) =>
    fetch(`/api/autonomy/actions/${id}/approve`, {
      method: "POST",
      ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
    }).then(j),
  actionReject: (id: string) =>
    fetch(`/api/autonomy/actions/${id}/reject`, { method: "POST" }).then(j),
  cancelDelegation: (id: string) =>
    fetch(`/api/delegations/${id}/cancel`, { method: "POST" }).then(j<{ ok: boolean }>),
  listDelegations: (opts: { workspace?: string; inFlight?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.workspace) p.set("workspace", opts.workspace);
    if (opts.inFlight) p.set("inFlight", "1");
    return fetch(`/api/delegations?${p}`).then(j<DelegationWithProgress[]>);
  },

  // === 目標帳本 ===
  goals: (opts: { workspace?: string; status?: "active" | "done" | "archived" } = {}) => {
    const p = new URLSearchParams();
    if (opts.workspace) p.set("workspace", opts.workspace);
    if (opts.status) p.set("status", opts.status);
    return fetch(`/api/goals?${p}`).then(j<WorkspaceGoal[]>);
  },
  createGoal: (workspace: string, body: {
    title: string;
    metric?: string;
    currentValue?: string;
    targetValue?: string;
    deadline?: string;
    note?: string;
  }) =>
    fetch(`/api/goals?workspace=${encodeURIComponent(workspace)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<WorkspaceGoal>),
  updateGoal: (id: string, patch: Partial<Omit<WorkspaceGoal, "id" | "workspaceId" | "createdAt" | "updatedAt">>) =>
    fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<WorkspaceGoal>),
  deleteGoal: (id: string) => fetch(`/api/goals/${id}`, { method: "DELETE" }).then(j<{ ok: boolean }>),

  // === 成效回訪 ===
  outcomes: (opts: { workspace?: string; status?: OutcomeStatus } = {}) => {
    const p = new URLSearchParams();
    if (opts.workspace) p.set("workspace", opts.workspace);
    if (opts.status) p.set("status", opts.status);
    return fetch(`/api/outcomes?${p}`).then(j<OutcomeCheck[]>);
  },
  createOutcome: (workspace: string, body: {
    description: string;
    dueInDays?: number;
    dueAt?: number;
    delegationId?: string;
    goalId?: string;
  }) =>
    fetch(`/api/outcomes?workspace=${encodeURIComponent(workspace)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<OutcomeCheck>),
  recordOutcomeResult: (id: string, workspace: string, result: string) =>
    fetch(`/api/outcomes/${id}/result?workspace=${encodeURIComponent(workspace)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
    }).then(j<OutcomeCheck>),
  cancelOutcome: (id: string, workspace: string) =>
    fetch(`/api/outcomes/${id}/cancel?workspace=${encodeURIComponent(workspace)}`, {
      method: "PATCH",
    }).then(j<OutcomeCheck>),
  deleteOutcome: (id: string, workspace: string) =>
    fetch(`/api/outcomes/${id}?workspace=${encodeURIComponent(workspace)}`, {
      method: "DELETE",
    }).then(j<{ ok: boolean }>),

  // === 專案管理 ===
  listProjects: (workspace: string) =>
    fetch(`/api/projects?workspace=${encodeURIComponent(workspace)}`).then(j<{ projects: Project[] }>),
  createProject: (workspace: string, name: string) =>
    fetch(`/api/projects?workspace=${encodeURIComponent(workspace)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(j<{ project: Project }>),
  updateProject: (id: string, patch: { name?: string; memory?: string }) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<{ project: Project }>),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then(j),
  setSessionProject: (sessionId: string, projectId: string | null) =>
    fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).then(j<SessionRecord>),

  // === 活動時間軸 ===
  listActivity: (q: { sessionId?: string; kind?: string; before?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.sessionId) p.set("sessionId", q.sessionId);
    if (q.kind) p.set("kind", q.kind);
    if (q.before != null) p.set("before", String(q.before));
    return fetch(`/api/activity?${p}`).then(j<{ items: ActivityRow[]; nextBefore?: number }>);
  },

  // === 駕駛艙簡報 ===
  cockpit: () => fetch("/api/cockpit").then(j<{ briefing: BriefingRow | null; lastError?: { status: string; raw: string; at: number } }>),
  cockpitRefresh: () =>
    fetch("/api/cockpit/refresh", { method: "POST" }).then(j<{ ok: boolean; throttled?: boolean; briefing: BriefingRow }>),

  // === Telegram 推播 ===
  notifierStatus: () => fetch("/api/system/notifier").then(j<NotifierStatus>),
  saveNotifierConfig: (patch: { botToken?: string; chatId?: string }) =>
    fetch("/api/system/notifier/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<NotifierStatus>),
  discoverNotifierChat: () =>
    fetch("/api/system/notifier/discover-chat", { method: "POST" })
      .then(j<{ ok: boolean; chatId?: string; from?: string; error?: string }>),
  testNotifier: () =>
    fetch("/api/system/notifier/test", { method: "POST" })
      .then(j<{ ok: boolean }>),

  // === 主題研究 harness ===
  /** 啟動一趟主題研究，立即回 runId，背景執行；進度透過 socket research:progress 事件推送。 */
  startResearch: (question: string, workspaceId: string) =>
    fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, workspaceId }),
    }).then(j<{ runId: string }>),

  /** 查詢研究 run 狀態（可用於 fallback polling；一般靠 socket）。 */
  getResearchRun: (id: string) => fetch(`/api/research/${id}`).then(j<ResearchRunInfo>),

  // === 常駐看守 (Watchtower) ===
  watchtowerTasks: (workspace: string) =>
    fetch(`/api/watchtower/tasks?workspace=${encodeURIComponent(workspace)}`).then(j<{ tasks: WatchtowerTask[] }>),
  createWatchtowerTask: (workspace: string, body: { name: string; cron: string; quietHours?: string; dailyQuota?: number; enabled?: boolean }) =>
    fetch(`/api/watchtower/tasks?workspace=${encodeURIComponent(workspace)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(j<{ task: WatchtowerTask }>),
  updateWatchtowerTask: (id: string, workspace: string, patch: Partial<{ name: string; cron: string; quietHours: string; dailyQuota: number; enabled: boolean }>) =>
    fetch(`/api/watchtower/tasks/${id}?workspace=${encodeURIComponent(workspace)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(j<{ task: WatchtowerTask }>),
  deleteWatchtowerTask: (id: string, workspace: string) =>
    fetch(`/api/watchtower/tasks/${id}?workspace=${encodeURIComponent(workspace)}`, {
      method: "DELETE",
    }).then(j<{ ok: boolean }>),
  watchtowerLogs: (taskId: string, workspace: string, limit = 50) =>
    fetch(`/api/watchtower/logs?taskId=${encodeURIComponent(taskId)}&workspace=${encodeURIComponent(workspace)}&limit=${limit}`).then(j<{ logs: WatchtowerLog[] }>),
  watchtowerRunNow: (id: string, workspace: string, force = false) =>
    fetch(`/api/watchtower/tasks/${id}/run-now?workspace=${encodeURIComponent(workspace)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).then(j<{ decision: string; reason?: string }>),
};

// === 常駐看守型別 ===
export type WatchtowerDecision = "act" | "skip" | "quiet" | "quota" | "overlap" | "error";

export interface WatchtowerTask {
  id: string;
  workspaceId: string;
  name: string;
  cron: string;
  enabled: number; // 1=啟用, 0=停用
  quietHours: string;
  dailyQuota: number;
  lastFiredAt: number | null;
  lastConclusion: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WatchtowerLog {
  id: string;
  taskId: string;
  workspaceId: string;
  firedAt: number;
  decision: WatchtowerDecision;
  reason: string;
  runId: string | null;
  createdAt: number;
}

export interface ActivityRow {
  id: string;
  ts: number;
  workspaceId: string;
  sessionId?: string;
  runId?: string;
  kind: string;
  summary: string;
  detail?: string;
  status?: string;
  totalLen?: number;
}

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
  workingDir?: string;
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

export interface ResearchRunInfo {
  id: string;
  workspaceId: string;
  question: string;
  status: "running" | "done" | "error";
  stage: string;
  total: number;
  done: number;
}

export interface NotifierStatus {
  configured: boolean;
  source: "env" | "file" | "none";
  botTokenMasked: string | null;
  chatId: string | null;
  envLocked: boolean;
  lastResult: { ok: boolean; at: number; error?: string } | null;
}

export interface WorkspaceGoal {
  id: string;
  workspaceId: string;
  title: string;
  metric: string;
  currentValue: string;
  targetValue: string;
  deadline: string;
  status: "active" | "done" | "archived";
  note: string;
  createdAt: number;
  updatedAt: number;
}

export type OutcomeStatus = "pending" | "notified" | "done" | "cancelled";

export interface OutcomeCheck {
  id: string;
  workspaceId: string;
  delegationId: string;
  goalId: string;
  description: string;
  dueAt: number;
  status: OutcomeStatus;
  result: string;
  createdAt: number;
  updatedAt: number;
}

export interface DelegationWithProgress {
  id: string;
  pmSessionId: string;
  workspaceId: string;
  agentId: string;
  mode: "consult" | "execute";
  task: string;
  status: "queued" | "running" | "done" | "failed" | "orphaned";
  subSessionId?: string;
  resultExcerpt?: string;
  createdAt: number;
  endedAt?: number;
  progress?: {
    toolCalls: number;
    lastActivityAt: number | null;
    lastAction: string | null;
  };
}
