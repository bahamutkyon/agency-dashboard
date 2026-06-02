import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("server/data/store.db");
console.log("=== craft scope 分佈 ===");
console.log(db.prepare("SELECT scope, COUNT(*) c, SUM(LENGTH(content)) total FROM agent_craft_memory GROUP BY scope").all());
console.log("\n=== category scope 分佈 ===");
console.log(db.prepare("SELECT scope, COUNT(*) c FROM category_capability_memory GROUP BY scope").all());
console.log("\n=== legacy-global 剩餘 ===");
const leftCraft = db.prepare("SELECT agent_id FROM agent_craft_memory WHERE scope='legacy-global' LIMIT 10").all();
const leftCat = db.prepare("SELECT category FROM category_capability_memory WHERE scope='legacy-global' LIMIT 10").all();
console.log("剩餘 legacy craft:", leftCraft);
console.log("剩餘 legacy category:", leftCat);

console.log("\n=== 隨機抽 3 條 craft 確認資料完整 ===");
const sample = db.prepare("SELECT agent_id, workspace_id, scope, LENGTH(content) len FROM agent_craft_memory WHERE scope='global' ORDER BY RANDOM() LIMIT 3").all();
console.log(sample);

console.log("\n=== agents-orchestrator（需手動編輯的條目）狀態 ===");
const orc = db.prepare("SELECT agent_id, workspace_id, scope, LENGTH(content) len FROM agent_craft_memory WHERE agent_id='agents-orchestrator'").all();
console.log(orc);
