#!/usr/bin/env node
// 把 4 個 awesome-doc-* skill 加進 agent-skill-map.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "..", "agent-skill-map.json");

const MAPPING = [
  {
    skill: "awesome-doc-docx",
    why: "Word 文件創建/編輯/分析的完整 toolkit,含 tracked changes、註解、格式保留、文字擷取——配合 doc-ops MCP 使用",
    agents: [
      "specialized-document-generator",
      "specialized-chief-of-staff",
      "support-executive-summary-generator",
      "legal-policy-writer",
      "marketing-content-creator",
    ],
  },
  {
    skill: "awesome-doc-pdf",
    why: "PDF 操作完整 toolkit——擷取文字/表格、建立 PDF、合併/拆分、處理 form,配合 doc-ops MCP 使用",
    agents: [
      "specialized-document-generator",
      "legal-contract-reviewer",
      "compliance-auditor",
    ],
  },
  {
    skill: "awesome-doc-pptx",
    why: "PowerPoint 簡報建立/編輯/分析——含 33 個 OOXML schema、html2pptx 等進階技術,配合 powerpoint MCP",
    agents: [
      "specialized-document-generator",
      "design-ui-designer",
      "design-visual-storyteller",
      "support-executive-summary-generator",
    ],
  },
  {
    skill: "awesome-doc-xlsx",
    why: "Excel 試算表創建/編輯/分析,支援公式、格式、資料分析、視覺化,配合 excel MCP",
    agents: [
      "specialized-document-generator",
      "finance-financial-analyst",
      "finance-fpa-analyst",
      "finance-bookkeeper-controller",
      "finance-financial-forecaster",
      "engineering-data-engineer",
      "support-analytics-reporter",
    ],
  },
];

const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

let added = 0;
let skipped = 0;
const missingAgents = [];

for (const { skill, why, agents } of MAPPING) {
  for (const agentId of agents) {
    if (!map.agents[agentId]) {
      missingAgents.push(`${skill} → ${agentId}`);
      continue;
    }
    const entry = map.agents[agentId];
    if (!entry.skills) entry.skills = [];
    if (entry.skills.some((s) => s.id === skill)) {
      skipped++;
      continue;
    }
    entry.skills.push({ id: skill, why });
    added++;
  }
}

map.skill_count = (map.skill_count || 0) + MAPPING.length;
map.generated_at = new Date().toISOString();

fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

console.log(`\n=== 結果 ===`);
console.log(`  加入: ${added} 個 (skill, agent) 對應`);
console.log(`  跳過(已存在): ${skipped}`);
console.log(`  涵蓋 agent: ${new Set(MAPPING.flatMap((m) => m.agents)).size}`);
if (missingAgents.length > 0) {
  console.log(`\n⚠ 找不到的 agent (${missingAgents.length}):`);
  missingAgents.forEach((m) => console.log(`    ${m}`));
}
