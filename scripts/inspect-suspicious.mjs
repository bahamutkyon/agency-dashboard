import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("scripts/legacy-dump.json", "utf8"));
const classify = JSON.parse(readFileSync("scripts/classify-result.json", "utf8"));

// 列出 REVIEW_NEEDED 與 MAYBE_REVIEW 的完整內容
const suspicious = [
  ...classify.craftResults.filter((r) => r.verdict.startsWith("REVIEW") || r.verdict.startsWith("MAYBE")),
  ...classify.catResults.filter((r) => r.verdict.startsWith("REVIEW") || r.verdict.startsWith("MAYBE"))
    .map((r) => ({ ...r, isCategory: true })),
];

for (const r of suspicious) {
  const isCategory = r.isCategory;
  const source = isCategory ? data.category : data.craft;
  const idField = isCategory ? "category" : "agent_id";
  const row = source.find((x) => x[idField] === r.name);
  if (!row) continue;
  console.log("\n" + "═".repeat(80));
  console.log(`${isCategory ? "📁 [CATEGORY] " : "🤖 [CRAFT] "}${r.name}`);
  console.log(`verdict: ${r.verdict}`);
  if (r.strongHits.length) console.log(`strong hits: ${r.strongHits.join(", ")}`);
  if (r.weakHits.length) console.log(`weak hits: ${r.weakHits.join(", ")}`);
  console.log("─".repeat(80));
  console.log(row.content);
}
