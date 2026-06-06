// 對真實 store.db 跑 Phase 1 migration。
// 跑前必須確認：
//   1. 已備份（store.db.bak.2026-06-01 存在）
//   2. dashboard server 已停（沒有 process 在寫 DB）
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { applyBaseSchema, applyMigrations } from "../server/dist/dbSchema.js";

const DB = "server/data/store.db";
const BAK = `${DB}.bak.2026-06-01`;

if (!existsSync(BAK)) {
  console.error(`❌ 找不到備份 ${BAK}，請先跑 checkpoint-and-backup.mjs`);
  process.exit(1);
}
console.log(`✅ 備份存在：${BAK} (${statSync(BAK).size} bytes)`);

const db = new DatabaseSync(DB);
db.exec("PRAGMA journal_mode = WAL;");

console.log("\n--- migration 前狀態 ---");
const craftBefore = db.prepare("SELECT COUNT(*) c FROM agent_craft_memory").get();
const catBefore = db.prepare("SELECT COUNT(*) c FROM category_capability_memory").get();
console.log("agent_craft_memory rows:", craftBefore.c);
console.log("category_capability_memory rows:", catBefore.c);
const craftColsBefore = db.prepare("PRAGMA table_info(agent_craft_memory)").all().map((c) => c.name);
console.log("craft 表欄位:", craftColsBefore);

console.log("\n--- 套用 base schema + migrations ---");
applyBaseSchema(db);
applyMigrations(db);

console.log("\n--- migration 後狀態 ---");
const craftAfter = db.prepare("SELECT COUNT(*) c FROM agent_craft_memory").get();
const catAfter = db.prepare("SELECT COUNT(*) c FROM category_capability_memory").get();
console.log("agent_craft_memory rows:", craftAfter.c);
console.log("category_capability_memory rows:", catAfter.c);
const craftColsAfter = db.prepare("PRAGMA table_info(agent_craft_memory)").all().map((c) => c.name);
console.log("craft 表欄位:", craftColsAfter);

console.log("\n--- scope 分佈 ---");
console.log("craft by scope:", db.prepare("SELECT scope, COUNT(*) c FROM agent_craft_memory GROUP BY scope").all());
console.log("category by scope:", db.prepare("SELECT scope, COUNT(*) c FROM category_capability_memory GROUP BY scope").all());

console.log("\n--- 完整性檢查 ---");
const sample = db.prepare("SELECT agent_id, workspace_id, scope, LENGTH(content) len FROM agent_craft_memory LIMIT 3").all();
console.log("craft 樣本:", sample);

db.close();
console.log("\n✅ Migration 完成");
