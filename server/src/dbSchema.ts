/**
 * Schema 定義與 migration 邏輯，從 db.ts 抽出以便單元測試。
 *
 * `applyBaseSchema(db)`：建立所有 CREATE TABLE IF NOT EXISTS。新 DB 直接拿到目標 schema。
 * `applyMigrations(db)`：對舊 schema 做 ALTER / 重建（idempotent）。新 DB 上應該全部 no-op。
 *
 * 重要：所有 migration 必須 idempotent —— 已套用過會偵測到並跳過。
 */
import type { DatabaseSync } from "node:sqlite";

export const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  standing_context TEXT DEFAULT '',
  memory TEXT DEFAULT '',
  enabled_mcps TEXT DEFAULT '[]',
  chrome_cdp_port INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  claude_session_id TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL DEFAULT 'claude',
  codex_thread_id TEXT,
  gemini_meta TEXT,
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

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  rate_limit_type TEXT,
  resets_at INTEGER,
  captured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  spec TEXT NOT NULL,
  max_concurrency INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_memory (
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_outputs TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS learning_proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lp_status ON learning_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_agent ON learning_proposals(agent_id, created_at DESC);

-- 新 schema: workspace-aware craft memory
-- workspace_id = '' 表示全域（跨工作區可見）
-- scope: 'global' = 通用方法論; 'workspace' = 該工作區專屬; 'legacy-global' = 遷移前的全域記憶（待重審）
-- UNIQUE 含 scope：因為 'global' 與 'legacy-global' 都用 workspace_id=''，
-- 必須靠 scope 區分才能共存（讓 legacy 升 global 時兩條短暫並存或永久分隔）。
CREATE TABLE IF NOT EXISTS agent_craft_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'workspace',
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE(agent_id, workspace_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_acm_agent ON agent_craft_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_acm_workspace ON agent_craft_memory(workspace_id);

CREATE TABLE IF NOT EXISTS category_capability_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'workspace',
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE(category, workspace_id, scope)
);
CREATE INDEX IF NOT EXISTS idx_ccm_category ON category_capability_memory(category);
CREATE INDEX IF NOT EXISTS idx_ccm_workspace ON category_capability_memory(workspace_id);

CREATE TABLE IF NOT EXISTS learning_schedules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  targets     TEXT NOT NULL DEFAULT '[]',
  cron        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_runs (
  id                TEXT PRIMARY KEY,
  targets           TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL,
  total             INTEGER NOT NULL,
  done              INTEGER NOT NULL DEFAULT 0,
  current           TEXT,
  failed            TEXT NOT NULL DEFAULT '[]',
  created_proposals INTEGER NOT NULL DEFAULT 0,
  schedule_id       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_runs_status ON learning_runs(status);
`;

export function applyBaseSchema(db: DatabaseSync): void {
  db.exec(BASE_SCHEMA);
}

/**
 * 安全的 schema 套用：先跑 migration 轉換舊 schema，再跑 base schema 建立任何缺失的表/索引。
 * 對舊 DB 與全新 DB 都安全。對全新 DB 來說 applyMigrations 是 no-op（沒有舊表可遷移）。
 */
export function setupSchema(db: DatabaseSync): void {
  applyMigrations(db);
  applyBaseSchema(db);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!r;
}

/**
 * 對舊 schema 套用 migration。所有步驟 idempotent。
 *
 * 主要 migration：
 *   - workspaces.memory / enabled_mcps / chrome_cdp_port 加欄位
 *   - sessions.provider / codex_thread_id / gemini_meta 加欄位
 *   - workflows.max_concurrency 加欄位
 *   - workflow_runs.step_outputs 加欄位
 *   - **agent_craft_memory v1 → v2**：舊 schema(agent_id PK)→新(含 workspace_id, scope)，
 *     既有資料 copy 為 scope='legacy-global', workspace_id=''
 *   - **category_capability_memory v1 → v2**：同上邏輯
 */
export function applyMigrations(db: DatabaseSync): void {
  // workspaces 欄位補丁
  if (tableExists(db, "workspaces")) {
    if (!hasColumn(db, "workspaces", "memory")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN memory TEXT DEFAULT ''");
    }
    if (!hasColumn(db, "workspaces", "enabled_mcps")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN enabled_mcps TEXT DEFAULT '[]'");
    }
    if (!hasColumn(db, "workspaces", "chrome_cdp_port")) {
      db.exec("ALTER TABLE workspaces ADD COLUMN chrome_cdp_port INTEGER");
    }
  }
  // workflow_runs.step_outputs
  if (tableExists(db, "workflow_runs") && !hasColumn(db, "workflow_runs", "step_outputs")) {
    db.exec("ALTER TABLE workflow_runs ADD COLUMN step_outputs TEXT NOT NULL DEFAULT '{}'");
  }
  // sessions multi-provider 欄位
  if (tableExists(db, "sessions")) {
    if (!hasColumn(db, "sessions", "provider")) {
      db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'");
    }
    if (!hasColumn(db, "sessions", "codex_thread_id")) {
      db.exec("ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT");
    }
    if (!hasColumn(db, "sessions", "gemini_meta")) {
      db.exec("ALTER TABLE sessions ADD COLUMN gemini_meta TEXT");
    }
  }
  // workflows.max_concurrency
  if (tableExists(db, "workflows") && !hasColumn(db, "workflows", "max_concurrency")) {
    db.exec("ALTER TABLE workflows ADD COLUMN max_concurrency INTEGER");
  }

  // === agent_craft_memory v1 → v2 ===
  // 偵測舊 schema：表存在但沒有 workspace_id 欄位
  if (tableExists(db, "agent_craft_memory") && !hasColumn(db, "agent_craft_memory", "workspace_id")) {
    db.exec("BEGIN");
    try {
      db.exec("ALTER TABLE agent_craft_memory RENAME TO agent_craft_memory_legacy_v1");
      db.exec(`
        CREATE TABLE agent_craft_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT '',
          scope TEXT NOT NULL DEFAULT 'workspace',
          content TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL,
          UNIQUE(agent_id, workspace_id, scope)
        );
      `);
      db.exec(`
        INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at)
        SELECT agent_id, '', 'legacy-global', content, updated_at
        FROM agent_craft_memory_legacy_v1
        WHERE LENGTH(TRIM(content)) > 0
      `);
      db.exec("DROP TABLE agent_craft_memory_legacy_v1");
      db.exec("CREATE INDEX IF NOT EXISTS idx_acm_agent ON agent_craft_memory(agent_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_acm_workspace ON agent_craft_memory(workspace_id)");
      db.exec("COMMIT");
      console.log("[db] migrated agent_craft_memory v1 → v2 (added workspace_id/scope; existing rows marked legacy-global)");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // === category_capability_memory v1 → v2 ===
  if (tableExists(db, "category_capability_memory") && !hasColumn(db, "category_capability_memory", "workspace_id")) {
    db.exec("BEGIN");
    try {
      db.exec("ALTER TABLE category_capability_memory RENAME TO category_capability_memory_legacy_v1");
      db.exec(`
        CREATE TABLE category_capability_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          workspace_id TEXT NOT NULL DEFAULT '',
          scope TEXT NOT NULL DEFAULT 'workspace',
          content TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL,
          UNIQUE(category, workspace_id, scope)
        );
      `);
      db.exec(`
        INSERT INTO category_capability_memory (category, workspace_id, scope, content, updated_at)
        SELECT category, '', 'legacy-global', content, updated_at
        FROM category_capability_memory_legacy_v1
        WHERE LENGTH(TRIM(content)) > 0
      `);
      db.exec("DROP TABLE category_capability_memory_legacy_v1");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ccm_category ON category_capability_memory(category)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ccm_workspace ON category_capability_memory(workspace_id)");
      db.exec("COMMIT");
      console.log("[db] migrated category_capability_memory v1 → v2 (added workspace_id/scope; existing rows marked legacy-global)");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
