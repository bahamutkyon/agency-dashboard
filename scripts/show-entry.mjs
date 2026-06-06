import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("scripts/legacy-dump.json", "utf8"));
const id = process.argv[2];
const isCategory = process.argv[3] === "category";
const source = isCategory ? data.category : data.craft;
const row = source.find((x) => (isCategory ? x.category : x.agent_id) === id);
if (!row) { console.log("not found"); process.exit(1); }
console.log(row.content);
