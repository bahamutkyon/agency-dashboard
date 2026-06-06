import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
const db = new DatabaseSync("server/data/store.db");

const craft = db.prepare(`
  SELECT agent_id, content, LENGTH(content) AS len
  FROM agent_craft_memory
  WHERE scope='legacy-global'
  ORDER BY agent_id
`).all();

const cat = db.prepare(`
  SELECT category, content, LENGTH(content) AS len
  FROM category_capability_memory
  WHERE scope='legacy-global'
  ORDER BY category
`).all();

writeFileSync("scripts/legacy-dump.json", JSON.stringify({ craft, category: cat }, null, 2));
console.log(`dumped ${craft.length} craft + ${cat.length} category to scripts/legacy-dump.json`);
console.log("total chars:", craft.reduce((s, r) => s + r.len, 0) + cat.reduce((s, r) => s + r.len, 0));
