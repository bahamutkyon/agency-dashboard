#!/usr/bin/env node
// 把 design-system-picker 加到 design / UI / content / 行銷 相關 agent 的 priming

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "..", "agent-skill-map.json");

// 給哪些 agent 點名這個 skill
const TARGETS = [
  // 設計類
  "design-ui-designer",
  "design-visual-storyteller",
  "design-brand-guardian",
  "design-ux-architect",
  "design-ux-researcher",
  "design-image-prompt-engineer",
  "design-whimsy-injector",
  "design-inclusive-visuals-specialist",
  // 前端開發類（會做 UI）
  "engineering-frontend-developer",
  "engineering-senior-developer",
  // 文檔/簡報類
  "specialized-document-generator",
  "support-executive-summary-generator",
  // 內容類
  "marketing-content-creator",
  "marketing-linkedin-content-creator",
];

const WHY = "從 23 套精選 design system（Linear/Stripe/Notion/Vercel/Apple/Spotify 等）挑對品牌風格,讀其 DESIGN.md 規範,確保產出視覺一致而非自行編色編字";

const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

let added = 0;
let skipped = 0;
const missing = [];

for (const agentId of TARGETS) {
  if (!map.agents[agentId]) {
    missing.push(agentId);
    continue;
  }
  const entry = map.agents[agentId];
  if (!entry.skills) entry.skills = [];
  if (entry.skills.some((s) => s.id === "design-system-picker")) {
    skipped++;
    continue;
  }
  entry.skills.push({ id: "design-system-picker", why: WHY });
  added++;
}

map.skill_count = (map.skill_count || 0) + 1;
map.generated_at = new Date().toISOString();

fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

console.log(`\n=== 結果 ===`);
console.log(`  加入: ${added}`);
console.log(`  跳過: ${skipped}`);
if (missing.length > 0) console.log(`  找不到的 agent: ${missing.join(", ")}`);
