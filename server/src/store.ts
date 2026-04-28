/**
 * SQLite-backed store. Replaces the old JSON-file storage with no API
 * surface change for callers — just much faster lookups, real workspace
 * isolation, and full-text search via SQL LIKE on message contents.
 */
import { db, DEFAULT_WORKSPACE_ID } from "./db.js";

// --- Types ---

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
}

export interface SessionRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  title: string;
  claudeSessionId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  tags?: string[];
}

export interface Schedule {
  id: string;
  workspaceId: string;
  name: string;
  agentId: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface PromptTemplate {
  id: string;
  workspaceId: string;
  name: string;
  body: string;
  agentId?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  standingContext: string;
  memory: string;
  enabledMcps: string[];   // names of MCP servers enabled for this workspace
  createdAt: number;
}

export interface WorkflowStep {
  agentId: string;
  prompt: string;            // can include {{out}} for previous step's output
  pauseBefore?: boolean;     // pause + wait for user approval before this step
  skipIfMatch?: string;      // regex on previous {{out}}; match → skip this step
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
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
  error?: string;
  startedAt: number;
  endedAt?: number;
}

// --- Helpers ---

function parseTags(s: string | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

function rowToSession(r: any, messages: Message[]): SessionRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    agentId: r.agent_id,
    title: r.title,
    claudeSessionId: r.claude_session_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: parseTags(r.tags),
    messages,
  };
}

function rowToSchedule(r: any): Schedule {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    agentId: r.agent_id,
    prompt: r.prompt,
    cron: r.cron,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at || undefined,
  };
}

function rowToTemplate(r: any): PromptTemplate {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    body: r.body,
    agentId: r.agent_id || undefined,
    tags: parseTags(r.tags),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToNote(r: any): Note {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    body: r.body,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    standingContext: r.standing_context || "",
    memory: r.memory || "",
    enabledMcps: parseTags(r.enabled_mcps),
    createdAt: r.created_at,
  };
}

// --- Workspaces ---

export function listWorkspaces(): Workspace[] {
  const rows = db.prepare("SELECT * FROM workspaces ORDER BY created_at").all() as any[];
  return rows.map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | undefined {
  const r = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
  return r ? rowToWorkspace(r) : undefined;
}

export function createWorkspace(input: { name: string; description?: string; standingContext?: string }): Workspace {
  const id = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO workspaces (id, name, description, standing_context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description || "", input.standingContext || "", Date.now());
  return getWorkspace(id)!;
}

export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "standingContext" | "memory" | "enabledMcps">>): Workspace | undefined {
  const cur = getWorkspace(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workspaces SET name = ?, description = ?, standing_context = ?, memory = ?, enabled_mcps = ?
    WHERE id = ?
  `).run(
    next.name, next.description, next.standingContext, next.memory || "",
    JSON.stringify(next.enabledMcps || []),
    id,
  );
  return getWorkspace(id);
}

export function appendWorkspaceMemory(id: string, entry: string): void {
  const w = getWorkspace(id);
  if (!w) return;
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const next = (w.memory || "").trim();
  const updated = next ? `${next}\n- [${ts}] ${entry.trim()}` : `- [${ts}] ${entry.trim()}`;
  // Cap memory at ~10KB to prevent unbounded growth
  const capped = updated.length > 10000 ? "(舊記憶已壓縮)\n" + updated.slice(-9000) : updated;
  db.prepare("UPDATE workspaces SET memory = ? WHERE id = ?").run(capped, id);
}

export function deleteWorkspace(id: string): boolean {
  if (id === DEFAULT_WORKSPACE_ID) return false; // protect default
  const tx = db.prepare("BEGIN"); tx.run();
  try {
    db.prepare("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE workspace_id = ?)").run(id);
    db.prepare("DELETE FROM sessions WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM schedules WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM templates WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM notes WHERE workspace_id = ?").run(id);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    db.prepare("COMMIT").run();
    return true;
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}

// --- Sessions ---

function loadMessages(sessionId: string): Message[] {
  const rows = db.prepare("SELECT role, content, ts FROM messages WHERE session_id = ? ORDER BY id ASC, ts ASC").all(sessionId) as any[];
  return rows.map((r) => ({ role: r.role, content: r.content, ts: r.ts }));
}

export function getSession(id: string): SessionRecord | undefined {
  const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!r) return undefined;
  return rowToSession(r, loadMessages(id));
}

export function listSessions(workspaceId?: string): SessionRecord[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
  // For list view we don't fetch messages (heavy). Caller can use getSession if needed.
  return (rows as any[]).map((r) => rowToSession(r, []));
}

/**
 * Upsert a session. If messages array is provided, we replace all stored
 * messages with the new array — caller is responsible for being consistent.
 */
export function upsertSession(s: SessionRecord): void {
  const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(s.id);
  if (existing) {
    db.prepare(`
      UPDATE sessions SET workspace_id = ?, agent_id = ?, title = ?,
        claude_session_id = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      s.workspaceId || DEFAULT_WORKSPACE_ID, s.agentId, s.title,
      s.claudeSessionId || null, JSON.stringify(s.tags || []), s.updatedAt,
      s.id,
    );
  } else {
    db.prepare(`
      INSERT INTO sessions (id, workspace_id, agent_id, title, claude_session_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.workspaceId || DEFAULT_WORKSPACE_ID, s.agentId, s.title,
      s.claudeSessionId || null, JSON.stringify(s.tags || []),
      s.createdAt, s.updatedAt,
    );
  }

  // Only replace messages if a non-empty array was passed (preserves existing
  // messages when caller just wants to update title/tags/etc).
  if (s.messages && s.messages.length > 0) {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(s.id);
    const ins = db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)");
    for (const m of s.messages) ins.run(s.id, m.role, m.content, m.ts);
  }
}

export function appendMessage(sessionId: string, m: Message): void {
  db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)").run(
    sessionId, m.role, m.content, m.ts,
  );
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(m.ts, sessionId);
}

export function setSessionClaudeId(sessionId: string, claudeSessionId: string): void {
  db.prepare("UPDATE sessions SET claude_session_id = ? WHERE id = ?").run(claudeSessionId, sessionId);
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// --- Schedules ---

export function listSchedules(workspaceId?: string): Schedule[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM schedules WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM schedules ORDER BY created_at DESC").all();
  return (rows as any[]).map(rowToSchedule);
}

export function getSchedule(id: string): Schedule | undefined {
  const r = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as any;
  return r ? rowToSchedule(r) : undefined;
}

export function upsertSchedule(s: Schedule): void {
  const exists = db.prepare("SELECT id FROM schedules WHERE id = ?").get(s.id);
  if (exists) {
    db.prepare(`
      UPDATE schedules SET workspace_id = ?, name = ?, agent_id = ?, prompt = ?,
        cron = ?, enabled = ?, last_run_at = ?
      WHERE id = ?
    `).run(
      s.workspaceId || DEFAULT_WORKSPACE_ID, s.name, s.agentId, s.prompt,
      s.cron, s.enabled ? 1 : 0, s.lastRunAt || null,
      s.id,
    );
  } else {
    db.prepare(`
      INSERT INTO schedules (id, workspace_id, name, agent_id, prompt, cron, enabled, created_at, last_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      s.id, s.workspaceId || DEFAULT_WORKSPACE_ID, s.name, s.agentId, s.prompt,
      s.cron, s.enabled ? 1 : 0, s.createdAt, s.lastRunAt || null,
    );
  }
}

export function deleteSchedule(id: string): void {
  db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
}

// --- Templates ---

export function listTemplates(workspaceId?: string): PromptTemplate[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM templates WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all();
  return (rows as any[]).map(rowToTemplate);
}

export function upsertTemplate(t: PromptTemplate): void {
  const exists = db.prepare("SELECT id FROM templates WHERE id = ?").get(t.id);
  if (exists) {
    db.prepare(`
      UPDATE templates SET workspace_id = ?, name = ?, body = ?, agent_id = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(
      t.workspaceId || DEFAULT_WORKSPACE_ID, t.name, t.body,
      t.agentId || null, JSON.stringify(t.tags || []), t.updatedAt,
      t.id,
    );
  } else {
    db.prepare(`
      INSERT INTO templates (id, workspace_id, name, body, agent_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t.id, t.workspaceId || DEFAULT_WORKSPACE_ID, t.name, t.body,
      t.agentId || null, JSON.stringify(t.tags || []),
      t.createdAt, t.updatedAt,
    );
  }
}

export function deleteTemplate(id: string): void {
  db.prepare("DELETE FROM templates WHERE id = ?").run(id);
}

// --- Notes ---

export function listNotes(workspaceId?: string): Note[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM notes WHERE workspace_id = ? ORDER BY pinned DESC, updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC").all();
  return (rows as any[]).map(rowToNote);
}

export function getNote(id: string): Note | undefined {
  const r = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as any;
  return r ? rowToNote(r) : undefined;
}

export function upsertNote(n: Note): void {
  const exists = db.prepare("SELECT id FROM notes WHERE id = ?").get(n.id);
  if (exists) {
    db.prepare(`
      UPDATE notes SET workspace_id = ?, title = ?, body = ?, pinned = ?, updated_at = ?
      WHERE id = ?
    `).run(n.workspaceId || DEFAULT_WORKSPACE_ID, n.title, n.body, n.pinned ? 1 : 0, n.updatedAt, n.id);
  } else {
    db.prepare(`
      INSERT INTO notes (id, workspace_id, title, body, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(n.id, n.workspaceId || DEFAULT_WORKSPACE_ID, n.title, n.body, n.pinned ? 1 : 0, n.createdAt, n.updatedAt);
  }
}

export function deleteNote(id: string): void {
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
}

// --- Workflows ---

function rowToWorkflow(r: any): Workflow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description || "",
    steps: JSON.parse(r.steps || "[]"),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listWorkflows(workspaceId?: string): Workflow[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM workflows WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM workflows ORDER BY updated_at DESC").all();
  return (rows as any[]).map(rowToWorkflow);
}

export function getWorkflow(id: string): Workflow | undefined {
  const r = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as any;
  return r ? rowToWorkflow(r) : undefined;
}

export function upsertWorkflow(w: Workflow): void {
  const exists = db.prepare("SELECT id FROM workflows WHERE id = ?").get(w.id);
  if (exists) {
    db.prepare(`
      UPDATE workflows SET workspace_id = ?, name = ?, description = ?, steps = ?, updated_at = ?
      WHERE id = ?
    `).run(w.workspaceId || DEFAULT_WORKSPACE_ID, w.name, w.description, JSON.stringify(w.steps), w.updatedAt, w.id);
  } else {
    db.prepare(`
      INSERT INTO workflows (id, workspace_id, name, description, steps, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(w.id, w.workspaceId || DEFAULT_WORKSPACE_ID, w.name, w.description, JSON.stringify(w.steps), w.createdAt, w.updatedAt);
  }
}

export function deleteWorkflow(id: string): void {
  db.prepare("DELETE FROM workflow_runs WHERE workflow_id = ?").run(id);
  db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
}

// --- Workflow Runs ---

function rowToRun(r: any): WorkflowRun {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workspaceId: r.workspace_id,
    status: r.status,
    currentStep: r.current_step,
    sessionIds: JSON.parse(r.session_ids || "[]"),
    error: r.error || undefined,
    startedAt: r.started_at,
    endedAt: r.ended_at || undefined,
  };
}

export function createRun(workflowId: string, workspaceId: string): WorkflowRun {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, workspace_id, status, current_step, session_ids, started_at)
    VALUES (?, ?, ?, 'running', 0, '[]', ?)
  `).run(id, workflowId, workspaceId, Date.now());
  return getRun(id)!;
}

export function getRun(id: string): WorkflowRun | undefined {
  const r = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as any;
  return r ? rowToRun(r) : undefined;
}

export function listRuns(workflowId: string): WorkflowRun[] {
  const rows = db.prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20").all(workflowId);
  return (rows as any[]).map(rowToRun);
}

export function updateRun(id: string, patch: Partial<Pick<WorkflowRun, "status" | "currentStep" | "sessionIds" | "error" | "endedAt">>) {
  const cur = getRun(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workflow_runs SET status = ?, current_step = ?, session_ids = ?, error = ?, ended_at = ?
    WHERE id = ?
  `).run(next.status, next.currentStep, JSON.stringify(next.sessionIds), next.error || null, next.endedAt || null, id);
}

// --- Search (much faster than the old JSON scan) ---

export interface SearchHit {
  sessionId: string;
  title: string;
  agentId: string;
  workspaceId: string;
  updatedAt: number;
  titleHit: boolean;
  matchCount: number;
  matches: { ts: number; role: string; snippet: string }[];
}

export function searchSessions(q: string, workspaceId?: string): SearchHit[] {
  if (!q.trim()) return [];
  const like = `%${q}%`;

  // Find session IDs whose title or any message matches.
  const sessRows = (workspaceId
    ? db.prepare(`
        SELECT DISTINCT s.id, s.title, s.agent_id, s.workspace_id, s.updated_at
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.workspace_id = ?
          AND (s.title LIKE ? OR m.content LIKE ?)
        ORDER BY s.updated_at DESC
        LIMIT 50
      `).all(workspaceId, like, like)
    : db.prepare(`
        SELECT DISTINCT s.id, s.title, s.agent_id, s.workspace_id, s.updated_at
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.title LIKE ? OR m.content LIKE ?
        ORDER BY s.updated_at DESC
        LIMIT 50
      `).all(like, like)) as any[];

  const out: SearchHit[] = [];
  for (const row of sessRows) {
    const titleHit = row.title.toLowerCase().includes(q.toLowerCase());
    const matchedRows = db.prepare(`
      SELECT role, content, ts FROM messages WHERE session_id = ? AND content LIKE ?
      ORDER BY ts ASC LIMIT 5
    `).all(row.id, like) as any[];
    const matches = matchedRows.map((m) => {
      const idx = m.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(m.content.length, idx + q.length + 80);
      return {
        ts: m.ts,
        role: m.role,
        snippet: (start > 0 ? "…" : "") + m.content.slice(start, end) + (end < m.content.length ? "…" : ""),
      };
    });
    const matchCount = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND content LIKE ?").get(row.id, like) as any).c;
    out.push({
      sessionId: row.id,
      title: row.title,
      agentId: row.agent_id,
      workspaceId: row.workspace_id,
      updatedAt: row.updated_at,
      titleHit,
      matchCount,
      matches,
    });
  }
  return out;
}

// --- Tags aggregation ---

export function aggregateTags(workspaceId?: string): { name: string; count: number }[] {
  const rows = (workspaceId
    ? db.prepare("SELECT tags FROM sessions WHERE workspace_id = ?").all(workspaceId)
    : db.prepare("SELECT tags FROM sessions").all()) as any[];
  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const t of parseTags(r.tags)) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

// --- Usage ---

export interface DailyEntry {
  date: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  turns: number;
}

function rowToDaily(r: any): DailyEntry {
  return {
    date: r.date,
    costUSD: r.cost_usd,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    turns: r.turns,
  };
}

export function recordUsageTurn(date: string, deltas: Partial<Omit<DailyEntry, "date">>) {
  const cur = db.prepare("SELECT * FROM usage_daily WHERE date = ?").get(date) as any;
  if (cur) {
    db.prepare(`
      UPDATE usage_daily SET
        cost_usd = cost_usd + ?,
        input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ?,
        cache_creation_tokens = cache_creation_tokens + ?,
        cache_read_tokens = cache_read_tokens + ?,
        turns = turns + ?
      WHERE date = ?
    `).run(
      deltas.costUSD || 0, deltas.inputTokens || 0, deltas.outputTokens || 0,
      deltas.cacheCreationTokens || 0, deltas.cacheReadTokens || 0, deltas.turns || 1,
      date,
    );
  } else {
    db.prepare(`
      INSERT INTO usage_daily (date, cost_usd, input_tokens, output_tokens,
                                cache_creation_tokens, cache_read_tokens, turns)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      date, deltas.costUSD || 0, deltas.inputTokens || 0, deltas.outputTokens || 0,
      deltas.cacheCreationTokens || 0, deltas.cacheReadTokens || 0, deltas.turns || 1,
    );
  }
}

export function getUsageSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const todayRow = db.prepare("SELECT * FROM usage_daily WHERE date = ?").get(today) as any;
  const totals = db.prepare(`
    SELECT SUM(cost_usd) as cost, SUM(input_tokens) as input, SUM(output_tokens) as output,
           SUM(cache_creation_tokens) as cc, SUM(cache_read_tokens) as cr, SUM(turns) as turns
    FROM usage_daily
  `).get() as any;
  const last7Rows = db.prepare(`
    SELECT * FROM usage_daily WHERE date >= date('now', '-6 days') ORDER BY date ASC
  `).all() as any[];
  const last7Map = new Map<string, DailyEntry>();
  for (const r of last7Rows) last7Map.set(r.date, rowToDaily(r));
  const last7: DailyEntry[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    last7.push(last7Map.get(k) || {
      date: k, costUSD: 0, inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0,
    });
  }
  const rl = db.prepare("SELECT * FROM rate_limit_state WHERE id = 1").get() as any;
  return {
    today: todayRow ? rowToDaily(todayRow) : { date: today, costUSD: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0 },
    total: {
      costUSD: totals.cost || 0,
      inputTokens: totals.input || 0,
      outputTokens: totals.output || 0,
      cacheCreationTokens: totals.cc || 0,
      cacheReadTokens: totals.cr || 0,
      turns: totals.turns || 0,
    },
    rateLimit: rl ? {
      status: rl.status,
      rateLimitType: rl.rate_limit_type,
      resetsAt: rl.resets_at,
      capturedAt: rl.captured_at,
    } : undefined,
    last7,
  };
}

export function recordRateLimitState(info: { status: string; rateLimitType: string; resetsAt: number }) {
  db.prepare(`
    INSERT OR REPLACE INTO rate_limit_state (id, status, rate_limit_type, resets_at, captured_at)
    VALUES (1, ?, ?, ?, ?)
  `).run(info.status, info.rateLimitType, info.resetsAt, Date.now());
}

export { DEFAULT_WORKSPACE_ID };
