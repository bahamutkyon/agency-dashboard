import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("server/data/store.db");

console.log("=== workspace memory 大小 ===");
const ws = db.prepare("SELECT id, name, LENGTH(memory) memlen, LENGTH(standing_context) ctxlen FROM workspaces").all();
console.log(ws);

console.log("\n=== agent_memory 大小（agent × workspace 同事記憶）===");
const am = db.prepare("SELECT workspace_id, agent_id, LENGTH(content) len FROM agent_memory ORDER BY len DESC").all();
console.log(am);

console.log("\n=== craft 各 agent 大小 top 10 ===");
const ct = db.prepare("SELECT agent_id, LENGTH(content) len FROM agent_craft_memory ORDER BY len DESC LIMIT 10").all();
console.log(ct);

console.log("\n=== 對 agents-orchestrator 模擬 system prompt 大小 ===");
const agent = "agents-orchestrator";
const wsId = "ws_mpo1zubg_dd8mlj"; // LP audio
const craft = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id = ? AND (workspace_id = '' OR workspace_id = ?)").all(agent, wsId);
const cat = db.prepare("SELECT content FROM category_capability_memory WHERE category = ? AND (workspace_id = '' OR workspace_id = ?)").all("agents", wsId); // 不確定 category id，先試
const wsMem = db.prepare("SELECT memory FROM workspaces WHERE id = ?").get(wsId);
const aMem = db.prepare("SELECT content FROM agent_memory WHERE workspace_id = ? AND agent_id = ?").get(wsId, agent);
const totalCraft = craft.reduce((s, r) => s + r.content.length, 0);
const totalCat = cat.reduce((s, r) => s + r.content.length, 0);
console.log("craft 條目數:", craft.length, "總字數:", totalCraft);
console.log("category 條目數:", cat.length, "總字數:", totalCat);
console.log("workspace memory 字數:", wsMem?.memory?.length || 0);
console.log("agent_memory 字數:", aMem?.content?.length || 0);
console.log("加總:", totalCraft + totalCat + (wsMem?.memory?.length || 0) + (aMem?.content?.length || 0));

console.log("\n=== 嘗試 category=orchestration 與其他可能 ===");
for (const c of ["orchestration", "agents", "agents-orchestrator"]) {
  const r = db.prepare("SELECT content FROM category_capability_memory WHERE category = ?").all(c);
  console.log(`  category='${c}': ${r.length} 條`);
}
