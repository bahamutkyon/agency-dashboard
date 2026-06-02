// 對真實 store.db 跑 Phase 1 migration。
// 跑前必須確認：
//   1. 已備份（store.db.bak.2026-06-01 存在）
//   2. dashboard server 已停（沒有 process 在寫 DB）
//
// 從 server/ 目錄跑：
//   npx tsx scripts/run-migration.ts
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { setupSchema } from "../src/dbSchema.js";

const DB = "data/store.db";
const BAK = `${DB}.bak.2026-06-01`;

if (!existsSync(BAK)) {
  console.error(`X 找不到備份 ${BAK}，請先備份`);
  process.exit(1);
}
console.log(`OK 備份存在：${BAK} (${statSync(BAK).size} bytes)`);

const db = new DatabaseSync(DB);
db.exec("PRAGMA journal_mode = WAL;");

console.log("\n--- migration 前狀態 ---");
const craftBefore = db.prepare("SELECT COUNT(*) c FROM agent_craft_memory").get() as { c: number };
const catBefore = db.prepare("SELECT COUNT(*) c FROM category_capability_memory").get() as { c: number };
console.log("agent_craft_memory rows:", craftBefore.c);
console.log("category_capability_memory rows:", catBefore.c);
const craftColsBefore = (db.prepare("PRAGMA table_info(agent_craft_memory)").all() as { name: string }[]).map((c) => c.name);
console.log("craft 表欄位:", craftColsBefore);

console.log("\n--- 套用 setupSchema (migrations 先跑 → base schema) ---");
setupSchema(db);

console.log("\n--- migration 後狀態 ---");
const craftAfter = db.prepare("SELECT COUNT(*) c FROM agent_craft_memory").get() as { c: number };
const catAfter = db.prepare("SELECT COUNT(*) c FROM category_capability_memory").get() as { c: number };
console.log("agent_craft_memory rows:", craftAfter.c);
console.log("category_capability_memory rows:", catAfter.c);
const craftColsAfter = (db.prepare("PRAGMA table_info(agent_craft_memory)").all() as { name: string }[]).map((c) => c.name);
console.log("craft 表欄位:", craftColsAfter);

console.log("\n--- scope 分佈 ---");
console.log("craft by scope:", db.prepare("SELECT scope, COUNT(*) c FROM agent_craft_memory GROUP BY scope").all());
console.log("category by scope:", db.prepare("SELECT scope, COUNT(*) c FROM category_capability_memory GROUP BY scope").all());

console.log("\n--- 完整性檢查（樣本）---");
const sample = db.prepare("SELECT agent_id, workspace_id, scope, LENGTH(content) len FROM agent_craft_memory LIMIT 3").all();
console.log("craft 樣本:", sample);

// 驗證：rows 數沒掉
const expectedCraft = craftColsBefore.includes("workspace_id") ? craftBefore.c : craftBefore.c;
if (craftAfter.c < expectedCraft) {
  console.error(`X craft rows 從 ${craftBefore.c} 掉到 ${craftAfter.c}!`);
  process.exit(2);
}

db.close();
console.log("\nOK Migration 完成");
