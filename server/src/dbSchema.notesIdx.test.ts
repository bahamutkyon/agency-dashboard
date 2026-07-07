/**
 * dbSchema — notes 複合索引驗證
 *
 * idx_notes_ws_order 對齊 listNotes 查詢形狀（WHERE workspace_id ORDER BY pinned DESC,
 * updated_at DESC）。舊的單欄 idx_notes_ws 會被 DROP 汰換（同名 IF NOT EXISTS 不會升級欄位）。
 */
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { setupSchema } from "./dbSchema.js";

describe("notes 複合索引", () => {
  it("setupSchema 後 idx_notes_ws_order 存在，且涵蓋 workspace_id/pinned/updated_at 三欄", () => {
    const db = new DatabaseSync(":memory:");
    setupSchema(db);
    const rows = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_notes_ws_order'"
    ).all() as { name: string; sql: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].sql).toContain("workspace_id");
    expect(rows[0].sql).toContain("pinned");
    expect(rows[0].sql).toContain("updated_at");
  });

  it("既有 DB 帶舊版單欄 idx_notes_ws → setupSchema 後被汰換成複合索引", () => {
    const db = new DatabaseSync(":memory:");
    // 模擬舊版 DB：先建 notes 表 + 舊單欄索引
    db.exec(`CREATE TABLE notes (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );`);
    db.exec("CREATE INDEX idx_notes_ws ON notes(workspace_id);");
    setupSchema(db);
    const old = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_ws'"
    ).all();
    const neo = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_ws_order'"
    ).all();
    expect(old.length).toBe(0);
    expect(neo.length).toBe(1);
  });

  it("重複 setupSchema（idempotent）不拋錯", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => {
      setupSchema(db);
      setupSchema(db);
    }).not.toThrow();
  });
});
