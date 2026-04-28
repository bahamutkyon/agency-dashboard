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

export interface SessionRecord {
  id: string;
  agentId: string;
  title: string;
  status?: string;
  createdAt: number;
  updatedAt: number;
  messages: { role: "user" | "assistant" | "system"; content: string; ts: number }[];
  tags?: string[];
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

  // workspace-scoped
  sessions: () => fetch(withWorkspace("/api/sessions")).then(j<SessionRecord[]>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<SessionRecord>),
  startSession: (agentId: string, title?: string) =>
    fetch(withWorkspace("/api/sessions"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, title }),
    }).then(j<{ id: string }>),
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
};

export interface Workspace {
  id: string;
  name: string;
  description: string;
  standingContext: string;
  createdAt: number;
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
