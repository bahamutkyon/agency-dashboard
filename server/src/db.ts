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
import { setupSchema } from "./dbSchema.js";

const DATA_DIR = path.join(process.cwd(), "data");
// 測試（vitest）一律用獨立的記憶體資料庫，絕不碰正式 store.db。
// 否則測試裡的 DELETE/INSERT 會直接改到使用者真實對話資料（曾因此清空 sessions）。
const IS_TEST = !!process.env.VITEST;
const DB_PATH = IS_TEST ? ":memory:" : path.join(DATA_DIR, "store.db");
const LEGACY_STORE = path.join(DATA_DIR, "store.json");
const LEGACY_USAGE = path.join(DATA_DIR, "usage.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Schema 與 migration 邏輯已抽出到 dbSchema.ts 以便單元測試。
// setupSchema 會先跑 migration（舊 schema → v2），再 applyBaseSchema 建任何缺失。
setupSchema(db);


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
