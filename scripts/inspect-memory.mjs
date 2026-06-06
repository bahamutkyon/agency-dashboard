import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("server/data/store.db");

console.log("=== 工作區 ===");
console.log(db.prepare("SELECT id, name FROM workspaces").all());

console.log("\n=== craft memory（agent-global 個人手藝） ===");
const craft = db.prepare("SELECT COUNT(*) c, SUM(LENGTH(content)) total_chars FROM agent_craft_memory WHERE LENGTH(TRIM(content))>0").get();
console.log(craft);
console.log("樣本（前 3 條，每條取前 200 字）:");
console.log(db.prepare("SELECT agent_id, SUBSTR(content, 1, 200) AS preview, LENGTH(content) len FROM agent_craft_memory WHERE LENGTH(TRIM(content))>0 ORDER BY updated_at DESC LIMIT 3").all());

console.log("\n=== category memory（類能力） ===");
const cat = db.prepare("SELECT COUNT(*) c FROM category_capability_memory WHERE LENGTH(TRIM(content))>0").get();
console.log(cat);
console.log("樣本（前 3 條）:");
console.log(db.prepare("SELECT category, SUBSTR(content, 1, 200) preview, LENGTH(content) len FROM category_capability_memory WHERE LENGTH(TRIM(content))>0 ORDER BY updated_at DESC LIMIT 3").all());

console.log("\n=== learning_proposals ===");
console.log("by status:", db.prepare("SELECT status, COUNT(*) c FROM learning_proposals GROUP BY status").all());
console.log("approved by scope:", db.prepare("SELECT scope, COUNT(*) c FROM learning_proposals WHERE status='approved' GROUP BY scope").all());
console.log("approved by kind:", db.prepare("SELECT kind, COUNT(*) c FROM learning_proposals WHERE status='approved' GROUP BY kind").all());
console.log("approved by workspace:", db.prepare("SELECT workspace_id, COUNT(*) c FROM learning_proposals WHERE status='approved' GROUP BY workspace_id").all());

console.log("\n=== agent 跨工作區情況 ===");
console.log("approved 提議涉及 >1 工作區的 agent 數:", db.prepare("SELECT COUNT(*) c FROM (SELECT agent_id FROM learning_proposals WHERE status='approved' GROUP BY agent_id HAVING COUNT(DISTINCT workspace_id) > 1)").get());
console.log("top 10 跨工作區 agent:", db.prepare("SELECT agent_id, COUNT(DISTINCT workspace_id) ws_count, COUNT(*) total FROM learning_proposals WHERE status='approved' GROUP BY agent_id HAVING ws_count > 1 ORDER BY ws_count DESC, total DESC LIMIT 10").all());
