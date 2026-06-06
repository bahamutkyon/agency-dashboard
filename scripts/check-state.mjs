import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("server/data/store.db");

console.log("=== 表清單 ===");
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all());

console.log("\n=== 工作區 ===");
const ws = db.prepare("SELECT id, name FROM workspaces").all();
console.log(`筆數: ${ws.length}`);
console.log(ws);

console.log("\n=== sessions ===");
const sess = db.prepare("SELECT COUNT(*) c FROM sessions").get();
console.log("筆數:", sess.c);
const sessByWs = db.prepare("SELECT workspace_id, COUNT(*) c FROM sessions GROUP BY workspace_id").all();
console.log("各工作區 session 數:", sessByWs);

console.log("\n=== craft / category memory ===");
console.log("craft:", db.prepare("SELECT scope, COUNT(*) c FROM agent_craft_memory GROUP BY scope").all());
console.log("category:", db.prepare("SELECT scope, COUNT(*) c FROM category_capability_memory GROUP BY scope").all());
console.log("agent_memory:", db.prepare("SELECT COUNT(*) c FROM agent_memory").get());
