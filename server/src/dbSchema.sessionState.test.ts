import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { setupSchema } from "./dbSchema.js";

describe("sessions 狀態欄位 migration", () => {
  it("舊 DB（sessions 沒有狀態欄）升級後補齊，舊資料保留", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      title TEXT NOT NULL, claude_session_id TEXT, tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO sessions VALUES ('s1','w','a','舊對話',NULL,'[]',1,1);`);
    setupSchema(db);
    const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["state", "state_source", "state_at", "stopped_at", "digest_at", "handoff_from"]) expect(cols).toContain(c);
    expect((db.prepare("SELECT title FROM sessions WHERE id='s1'").get() as any).title).toBe("舊對話");
  });
});
