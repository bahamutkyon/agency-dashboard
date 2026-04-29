/**
 * SQLite database — replaces JSON file store. Uses Node 24's built-in
 * `node:sqlite` so we don't need any native build (no Visual Studio etc).
 *
 * Schema is created on first run; existing JSON store and usage files are
 * automatically migrated to the default workspace, then renamed to *.migrated
 * so we don't re-import them next boot.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "store.db");
const LEGACY_STORE = path.join(DATA_DIR, "store.json");
const LEGACY_USAGE = path.join(DATA_DIR, "usage.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  standing_context TEXT DEFAULT '',
  memory TEXT DEFAULT '',  -- accumulated facts agent learned across sessions
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  claude_session_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_ws ON sessions(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_schedules_ws ON schedules(workspace_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_ws ON notes(workspace_id, pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  agent_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_ws ON templates(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily (
  date TEXT PRIMARY KEY,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT,
  rate_limit_type TEXT,
  resets_at INTEGER,
  captured_at INTEGER
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',  -- JSON array of {agentId, prompt}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_ws ON workflows(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- running / paused / done / error / cancelled
  current_step INTEGER NOT NULL DEFAULT 0,
  session_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array, one per step (sessionId or "" if skipped)
  step_outputs TEXT NOT NULL DEFAULT '{}', -- JSON object: stepId → output text
  error TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON workflow_runs(workflow_id, started_at DESC);
`;

db.exec(SCHEMA);

// Add `memory` column to existing workspaces table for users upgrading from
// older versions. SQLite ALTER TABLE ADD COLUMN is idempotent-friendly via
// PRAGMA introspection.
try {
  const cols = db.prepare("PRAGMA table_info(workspaces)").all() as any[];
  if (!cols.some((c) => c.name === "memory")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN memory TEXT DEFAULT ''");
    console.log("[db] migration: added workspaces.memory column");
  }
  if (!cols.some((c) => c.name === "enabled_mcps")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN enabled_mcps TEXT DEFAULT '[]'");
    console.log("[db] migration: added workspaces.enabled_mcps column");
  }
  // workflow_runs.step_outputs migration
  const runCols = db.prepare("PRAGMA table_info(workflow_runs)").all() as any[];
  if (runCols.length > 0 && !runCols.some((c) => c.name === "step_outputs")) {
    db.exec("ALTER TABLE workflow_runs ADD COLUMN step_outputs TEXT NOT NULL DEFAULT '{}'");
    console.log("[db] migration: added workflow_runs.step_outputs column");
  }
  // sessions.provider — for multi-provider (claude / codex) support
  const sessCols = db.prepare("PRAGMA table_info(sessions)").all() as any[];
  if (sessCols.length > 0 && !sessCols.some((c) => c.name === "provider")) {
    db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'");
    console.log("[db] migration: added sessions.provider column");
  }
  if (sessCols.length > 0 && !sessCols.some((c) => c.name === "codex_thread_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT");
    console.log("[db] migration: added sessions.codex_thread_id column");
  }
  // gemini doesn't have a CLI-managed thread ID at the moment; we just
  // serialize history into the prompt. But reserve the column for future use.
  if (sessCols.length > 0 && !sessCols.some((c) => c.name === "gemini_meta")) {
    db.exec("ALTER TABLE sessions ADD COLUMN gemini_meta TEXT");
    console.log("[db] migration: added sessions.gemini_meta column");
  }
  // workflows.max_concurrency for per-workflow parallelism control
  const wfCols = db.prepare("PRAGMA table_info(workflows)").all() as any[];
  if (wfCols.length > 0 && !wfCols.some((c) => c.name === "max_concurrency")) {
    db.exec("ALTER TABLE workflows ADD COLUMN max_concurrency INTEGER");
    console.log("[db] migration: added workflows.max_concurrency column");
  }
} catch (e) {
  console.warn("[db] migration failed:", e);
}

// Bootstrap default workspace if none exist
function ensureDefaultWorkspace(): string {
  const row = db.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (row) return row.id;
  const id = "default";
  db.prepare(`
    INSERT INTO workspaces (id, name, description, standing_context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, "預設工作區", "尚未分類的對話與資料都會放在這裡", "", Date.now());
  console.log("[db] created default workspace");
  return id;
}

const DEFAULT_WORKSPACE_ID = ensureDefaultWorkspace();

// One-shot migration of legacy JSON store(s) into the default workspace
function migrateLegacyJSON() {
  if (fs.existsSync(LEGACY_STORE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LEGACY_STORE, "utf8"));
      const tx = db.prepare("BEGIN");
      const commit = db.prepare("COMMIT");
      const rollback = db.prepare("ROLLBACK");
      tx.run();
      try {
        const insSession = db.prepare(`
          INSERT OR IGNORE INTO sessions
          (id, workspace_id, agent_id, title, claude_session_id, tags, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insMsg = db.prepare(`
          INSERT INTO messages (session_id, role, content, ts) VALUES (?, ?, ?, ?)
        `);
        const insSched = db.prepare(`
          INSERT OR IGNORE INTO schedules
          (id, workspace_id, name, agent_id, prompt, cron, enabled, created_at, last_run_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insTpl = db.prepare(`
          INSERT OR IGNORE INTO templates
          (id, workspace_id, name, body, agent_id, tags, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insNote = db.prepare(`
          INSERT OR IGNORE INTO notes
          (id, workspace_id, title, body, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        let n = 0;
        for (const s of Object.values<any>(data.sessions || {})) {
          insSession.run(
            s.id, DEFAULT_WORKSPACE_ID, s.agentId, s.title || "",
            s.claudeSessionId || null, JSON.stringify(s.tags || []),
            s.createdAt || Date.now(), s.updatedAt || Date.now(),
          );
          for (const m of s.messages || []) {
            insMsg.run(s.id, m.role, m.content, m.ts || Date.now());
          }
          n++;
        }
        for (const sc of Object.values<any>(data.schedules || {})) {
          insSched.run(
            sc.id, DEFAULT_WORKSPACE_ID, sc.name, sc.agentId,
            sc.prompt, sc.cron, sc.enabled ? 1 : 0,
            sc.createdAt || Date.now(), sc.lastRunAt || null,
          );
        }
        for (const t of Object.values<any>(data.templates || {})) {
          insTpl.run(
            t.id, DEFAULT_WORKSPACE_ID, t.name, t.body,
            t.agentId || null, JSON.stringify(t.tags || []),
            t.createdAt || Date.now(), t.updatedAt || Date.now(),
          );
        }
        for (const note of Object.values<any>(data.notes || {})) {
          insNote.run(
            note.id, DEFAULT_WORKSPACE_ID, note.title, note.body,
            note.pinned ? 1 : 0,
            note.createdAt || Date.now(), note.updatedAt || Date.now(),
          );
        }
        commit.run();
        console.log(`[db] migrated ${n} sessions from legacy store.json`);
      } catch (e) {
        rollback.run();
        throw e;
      }
      fs.renameSync(LEGACY_STORE, LEGACY_STORE + ".migrated");
    } catch (e) {
      console.warn("[db] legacy migration failed:", e);
    }
  }

  if (fs.existsSync(LEGACY_USAGE)) {
    try {
      const u = JSON.parse(fs.readFileSync(LEGACY_USAGE, "utf8"));
      const insDaily = db.prepare(`
        INSERT OR REPLACE INTO usage_daily
        (date, cost_usd, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, turns)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of Object.values<any>(u.daily || {})) {
        insDaily.run(
          d.date, d.costUSD || 0,
          d.inputTokens || 0, d.outputTokens || 0,
          d.cacheCreationTokens || 0, d.cacheReadTokens || 0,
          d.turns || 0,
        );
      }
      if (u.lastRateLimit) {
        db.prepare(`
          INSERT OR REPLACE INTO rate_limit_state
          (id, status, rate_limit_type, resets_at, captured_at)
          VALUES (1, ?, ?, ?, ?)
        `).run(u.lastRateLimit.status, u.lastRateLimit.rateLimitType,
                u.lastRateLimit.resetsAt, u.lastRateLimit.capturedAt);
      }
      fs.renameSync(LEGACY_USAGE, LEGACY_USAGE + ".migrated");
      console.log("[db] migrated legacy usage.json");
    } catch (e) {
      console.warn("[db] usage migration failed:", e);
    }
  }
}

migrateLegacyJSON();

export { DEFAULT_WORKSPACE_ID, uuid };
