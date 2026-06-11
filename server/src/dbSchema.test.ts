import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema, applyMigrations, setupSchema } from "./dbSchema.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  setupSchema(db);
  return db;
}

/** 模擬「v1 舊 schema」——pre-workspace_id 時代的 craft / category 表，只有 PK = agent_id / category。 */
function seedLegacyV1Schema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE agent_craft_memory (
      agent_id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE category_capability_memory (
      category TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
}

function colNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe("Phase 1: agent_craft_memory v1 → v2 migration", () => {
  it("空 DB 套用 base schema 後 craft 表已含 workspace_id / scope 欄位", () => {
    const db = new DatabaseSync(":memory:");
    applyBaseSchema(db);
    const cols = colNames(db, "agent_craft_memory");
    expect(cols).toContain("agent_id");
    expect(cols).toContain("workspace_id");
    expect(cols).toContain("scope");
    expect(cols).toContain("content");
  });

  it("舊 v1 schema 帶資料時，migration 把資料搬到新表並標 scope='legacy-global', workspace_id=''", () => {
    const db = new DatabaseSync(":memory:");
    // 建舊 schema 並塞模擬資料
    seedLegacyV1Schema(db);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, content, updated_at) VALUES (?, ?, ?)")
      .run("engineering-embedded-firmware-engineer", "- [2026-05-24] 看門狗三件套是出貨底線。", 1716000000000);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, content, updated_at) VALUES (?, ?, ?)")
      .run("marketing-content-creator", "- [2026-05-23] 內容服務於單一目標動作。", 1716100000000);
    db.prepare("INSERT INTO category_capability_memory (category, content, updated_at) VALUES (?, ?, ?)")
      .run("marketing", "- [2026-05-23] 70/20/10 配比", 1716200000000);

    // 跑 migration
    applyMigrations(db);

    // 新表 schema 正確
    const craftCols = colNames(db, "agent_craft_memory");
    expect(craftCols).toContain("workspace_id");
    expect(craftCols).toContain("scope");
    const catCols = colNames(db, "category_capability_memory");
    expect(catCols).toContain("workspace_id");
    expect(catCols).toContain("scope");

    // craft 資料完整遷移
    const craftRows = db.prepare("SELECT agent_id, workspace_id, scope, content FROM agent_craft_memory ORDER BY agent_id").all() as any[];
    expect(craftRows).toHaveLength(2);
    expect(craftRows[0]).toMatchObject({
      agent_id: "engineering-embedded-firmware-engineer",
      workspace_id: "",
      scope: "legacy-global",
    });
    expect(craftRows[0].content).toContain("看門狗三件套");
    expect(craftRows[1]).toMatchObject({
      agent_id: "marketing-content-creator",
      workspace_id: "",
      scope: "legacy-global",
    });

    // category 資料遷移
    const catRows = db.prepare("SELECT category, workspace_id, scope, content FROM category_capability_memory").all() as any[];
    expect(catRows).toHaveLength(1);
    expect(catRows[0]).toMatchObject({
      category: "marketing",
      workspace_id: "",
      scope: "legacy-global",
    });

    // 舊表已刪
    const legacyExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_craft_memory_legacy_v1'").get();
    expect(legacyExists).toBeUndefined();
  });

  it("空字串內容不被遷移", () => {
    const db = new DatabaseSync(":memory:");
    seedLegacyV1Schema(db);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, content, updated_at) VALUES (?, ?, ?)")
      .run("agent-with-empty", "   ", 1716000000000);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, content, updated_at) VALUES (?, ?, ?)")
      .run("agent-with-content", "真實內容", 1716000000000);

    applyMigrations(db);

    const rows = db.prepare("SELECT agent_id FROM agent_craft_memory").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_id).toBe("agent-with-content");
  });

  it("idempotent：對已是 v2 的 schema 重跑 migration 不會壞掉", () => {
    const db = new DatabaseSync(":memory:");
    applyBaseSchema(db);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("agent-x", "ws-1", "workspace", "工作區內容", Date.now());

    expect(() => applyMigrations(db)).not.toThrow();

    // 重跑後資料還在
    const rows = db.prepare("SELECT * FROM agent_craft_memory").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("workspace");
  });

  it("UNIQUE(agent_id, workspace_id, scope) 約束：同 (agent, workspace, scope) 三元組只能有一條", () => {
    const db = new DatabaseSync(":memory:");
    applyBaseSchema(db);
    db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("agent-x", "ws-1", "workspace", "第一次寫入", Date.now());

    expect(() => {
      db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("agent-x", "ws-1", "workspace", "重複寫入", Date.now());
    }).toThrow(/UNIQUE/i);

    // 同 agent 不同 workspace 可共存
    expect(() => {
      db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("agent-x", "ws-2", "workspace", "另一個工作區", Date.now());
    }).not.toThrow();

    // 全域 'global' 與 legacy-global 都用 workspace_id='' 但 scope 不同 → 可共存
    db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("agent-x", "", "global", "全域方法論", Date.now());
    db.prepare("INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("agent-x", "", "legacy-global", "遷移前累積", Date.now());

    const all = db.prepare("SELECT workspace_id, scope FROM agent_craft_memory WHERE agent_id='agent-x' ORDER BY workspace_id, scope").all() as any[];
    expect(all).toHaveLength(4);
  });
});

describe("workspaces schema", () => {
  it("workspaces 有 working_dir 欄", () => {
    const db = freshDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('workspaces')").all().map((c: any) => c.name);
    expect(cols).toContain("working_dir");
  });
});

describe("autonomy-loop schema", () => {
  it("autonomy_runs 與 pending_actions 表建立成功", () => {
    const db = new DatabaseSync(":memory:");
    setupSchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain("autonomy_runs");
    expect(tables).toContain("pending_actions");
    const runCols = db.prepare("PRAGMA table_info(autonomy_runs)").all().map((c: any) => c.name);
    expect(runCols).toEqual(expect.arrayContaining(["id", "session_id", "goal", "status", "step_count", "max_steps", "deadline_at"]));
    const paCols = db.prepare("PRAGMA table_info(pending_actions)").all().map((c: any) => c.name);
    expect(paCols).toEqual(expect.arrayContaining(["id", "run_id", "session_id", "kind", "risk", "summary", "status"]));
  });
});

describe("observability schema", () => {
  it("activity_log 表建立成功", () => {
    const db = new DatabaseSync(":memory:");
    setupSchema(db);
    const cols = db.prepare("PRAGMA table_info(activity_log)").all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "ts", "workspace_id", "session_id", "run_id", "kind", "summary", "detail", "status", "total_len", "created_at"]));
  });
});

describe("autonomous-study schema", () => {
  it("建立 agent_study_prefs / agent_capability_reports / agent_study_schedules", () => {
    const db = freshDb();
    for (const t of ["agent_study_prefs", "agent_capability_reports", "agent_study_schedules"]) {
      const r = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
      expect(r, `表 ${t} 應存在`).toBeTruthy();
    }
  });
  it("learning_runs 有 run_kind 欄", () => {
    const db = freshDb();
    const cols = db.prepare("SELECT name FROM pragma_table_info('learning_runs')").all().map((c: any) => c.name);
    expect(cols).toContain("run_kind");
  });
  it("種子 hot/cold 兩列排程，預設關閉", () => {
    const db = freshDb();
    const rows = db.prepare("SELECT tier, enabled FROM agent_study_schedules ORDER BY tier").all() as any[];
    expect(rows.map((r) => r.tier)).toEqual(["cold", "hot"]);
    expect(rows.every((r) => r.enabled === 0)).toBe(true);
  });
});
