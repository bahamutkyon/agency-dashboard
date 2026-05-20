#!/usr/bin/env node
// 驗證 skill priming 對特定 agent 是否正確注入
// 模擬 server 的 skillPriming.ts 邏輯,印出 4 個代表性 agent 會看到的 priming 區塊

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "..", "agent-skill-map.json");

const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

// 從 4 個分類各挑一個代表性 agent 來看 priming 結果
const samples = [
  { id: "design-ui-designer",        category: "🎨 視覺/設計" },
  { id: "specialized-mcp-builder",   category: "💻 開發/工程" },
  { id: "sales-coach",               category: "📊 商務/銷售" },
  { id: "finance-invoice-manager",   category: "💰 財務" },
  { id: "marketing-content-creator", category: "✍️ 內容/行銷" },
];

console.log(`\n=== Skill Priming 驗證 ===`);
console.log(`Map 生成時間: ${map.generated_at}`);
console.log(`涵蓋 agent 數: ${Object.keys(map.agents).length}\n`);

for (const sample of samples) {
  const entry = map.agents[sample.id];
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${sample.category}] agent: ${sample.id}`);
  console.log("─".repeat(60));

  if (!entry || !entry.skills || entry.skills.length === 0) {
    console.log("  ✗ 此 agent 沒有 priming 條目");
    continue;
  }

  const awesome = entry.skills.filter((s) => s.id.startsWith("awesome-"));
  const original = entry.skills.filter((s) => !s.id.startsWith("awesome-"));

  console.log(`  共 ${entry.skills.length} 個 skill 被點名 (原有 ${original.length} + 新加 awesome ${awesome.length})`);
  console.log();

  if (awesome.length > 0) {
    console.log("  ⭐ 新加入的 awesome-* skill:");
    awesome.forEach((s) => {
      console.log(`    • ${s.id}`);
      console.log(`      理由: ${s.why}`);
    });
  }

  console.log();
  console.log("  原有的 skill:");
  original.forEach((s) => console.log(`    • ${s.id}`));
}

// 統計
console.log(`\n${"─".repeat(60)}`);
console.log(`全域統計`);
console.log("─".repeat(60));
const allAgents = Object.entries(map.agents);
const withAwesome = allAgents.filter(([_, v]) => v.skills?.some((s) => s.id.startsWith("awesome-")));
const withoutAwesome = allAgents.length - withAwesome.length;

console.log(`  有 awesome-* priming 的 agent: ${withAwesome.length} 個 (符合「特定 agent 才推薦」設計)`);
console.log(`  保持原樣的 agent: ${withoutAwesome} 個 (不會被特別推薦新 skill)`);
console.log();

// 看看哪些 awesome-* skill 被點名最多次
const skillCounts = {};
for (const [_, v] of allAgents) {
  for (const s of v.skills || []) {
    if (s.id.startsWith("awesome-")) {
      skillCounts[s.id] = (skillCounts[s.id] || 0) + 1;
    }
  }
}
const sorted = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]);
console.log("  awesome-* skill 被點名次數 (Top 10):");
sorted.slice(0, 10).forEach(([id, n]) => console.log(`    ${n}× ${id}`));
