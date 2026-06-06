#!/usr/bin/env node
// 把 21 個 awesome-* skill 加進 agent-skill-map.json 對應 agent 的 skills 陣列
// 一次性執行,可重跑(會 skip 已存在的)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "..", "agent-skill-map.json");

// skill → 適合的 agent(s) + 理由
const MAPPING = [
  { skill: "awesome-canvas-design", why: "需要做海報、藝術品、視覺設計時用此技能產出 .png/.pdf 美術作品", agents: ["design-ui-designer", "design-visual-storyteller", "design-inclusive-visuals-specialist"] },
  { skill: "awesome-theme-factory",  why: "替投影片/文件/HTML 套用 10 套預設主題,快速統一視覺風格", agents: ["design-ui-designer", "specialized-document-generator", "design-visual-storyteller"] },
  { skill: "awesome-brand-guidelines", why: "套用 Anthropic 官方品牌色與字型規範到設計素材", agents: ["design-brand-guardian"] },
  { skill: "awesome-image-enhancer",   why: "強化圖片解析度、銳利度、清晰度,簡報/社群圖適用", agents: ["design-ui-designer", "marketing-short-video-editing-coach"] },
  { skill: "awesome-content-research-writer", why: "寫作搭檔——做研究、加引用、改 hook、迭代大綱,把單打獨鬥變協作打磨", agents: ["marketing-content-creator", "marketing-linkedin-content-creator", "marketing-wechat-official-account"] },
  { skill: "awesome-internal-comms", why: "撰寫公司內部溝通文件(狀態回報、高層更新、3P 週報、FAQ、事故報告等)", agents: ["specialized-chief-of-staff", "support-executive-summary-generator"] },
  { skill: "awesome-competitive-ads-extractor", why: "從 FB/LinkedIn 廣告庫撈競品分析,理解對手訊息與素材手法", agents: ["paid-media-creative-strategist", "marketing-china-market-localization-strategist", "paid-media-paid-social-strategist"] },
  { skill: "awesome-twitter-algorithm-optimizer", why: "用 Twitter 開源演算法優化推文,提升觸及與互動", agents: ["marketing-twitter-engager"] },
  { skill: "awesome-changelog-generator", why: "從 git commit 自動產生使用者看得懂的 release notes", agents: ["engineering-senior-developer", "specialized-developer-advocate", "specialized-workflow-architect"] },
  { skill: "awesome-mcp-builder", why: "打造高品質 MCP server 的完整指引(含 Python FastMCP / Node MCP SDK 範本)", agents: ["specialized-mcp-builder", "engineering-ai-engineer", "engineering-software-architect"] },
  { skill: "awesome-skill-creator", why: "製作高品質 skill 的指南——新增/更新 skill 時用此 skill 確保品質", agents: ["prompt-engineer", "specialized-workflow-architect"] },
  { skill: "awesome-webapp-testing", why: "用 Playwright 操作測試本機 web app,驗證 UI 行為、截圖、看 console log", agents: ["engineering-frontend-developer", "testing-api-tester"] },
  { skill: "awesome-artifacts-builder", why: "用 React + Tailwind + shadcn/ui 打造複雜 claude.ai HTML artifact", agents: ["engineering-frontend-developer", "engineering-senior-developer"] },
  { skill: "awesome-meeting-insights-analyzer", why: "分析會議逐字稿/錄音,挖出贅詞、霸佔話語權、迴避衝突等溝通模式", agents: ["specialized-meeting-assistant", "sales-coach"] },
  { skill: "awesome-lead-research-assistant", why: "找高品質潛客 + 提供可執行的接觸策略", agents: ["sales-outbound-strategist", "sales-coach", "sales-account-strategist"] },
  { skill: "awesome-invoice-organizer", why: "自動整理發票收據以利報稅——讀亂檔案、擷取資訊、統一檔名分類", agents: ["finance-invoice-manager"] },
  { skill: "awesome-domain-name-brainstormer", why: "幫專案發想域名 + 跨 TLD 註冊查詢,品牌相關場景適用", agents: ["design-brand-guardian", "design-whimsy-injector"] },
  { skill: "awesome-tailored-resume-generator", why: "依職缺描述產出客製化履歷——招聘端可反向用來理解求職者敘事", agents: ["hr-recruiter", "recruitment-specialist"] },
  { skill: "awesome-developer-growth-analysis", why: "分析 Claude Code 對話紀錄找出開發者的技術缺口與成長方向", agents: ["academic-study-planner"] },
  { skill: "awesome-video-downloader", why: "下載 YouTube 影片(多畫質格式),也可只抓音訊轉 MP3", agents: ["marketing-short-video-editing-coach", "marketing-video-optimization-specialist"] },
  { skill: "awesome-raffle-winner-picker", why: "從名單/Sheets 隨機抽出贈獎得主,適用社群活動抽獎情境", agents: ["marketing-wechat-official-account"] },
];

// 載入現有 map
if (!fs.existsSync(MAP_PATH)) {
  console.error(`✗ 找不到 ${MAP_PATH}`);
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

// 備份
const backupPath = MAP_PATH + ".pre-awesome.bak";
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(MAP_PATH, backupPath);
  console.log(`✓ 備份至 ${path.basename(backupPath)}`);
}

let added = 0;
let skipped = 0;
let missingAgents = [];

for (const { skill, why, agents } of MAPPING) {
  for (const agentId of agents) {
    if (!map.agents[agentId]) {
      missingAgents.push(`${skill} → ${agentId}`);
      continue;
    }
    const entry = map.agents[agentId];
    if (!entry.skills) entry.skills = [];
    const exists = entry.skills.some((s) => s.id === skill);
    if (exists) {
      skipped++;
      continue;
    }
    entry.skills.push({ id: skill, why });
    added++;
  }
}

// 更新 metadata
map.skill_count = (map.skill_count || 0) + new Set(MAPPING.map((m) => m.skill)).size;
map.generated_at = new Date().toISOString();

// 寫回
fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

console.log(`\n=== 結果 ===`);
console.log(`  加入: ${added} 個 (skill, agent) 對應`);
console.log(`  已存在跳過: ${skipped}`);
console.log(`  涵蓋 agent 數: ${new Set(MAPPING.flatMap((m) => m.agents)).size}`);
console.log(`  覆寫了 ${map.skill_count} 個 skill 引用 (含原有 21 個)`);
if (missingAgents.length > 0) {
  console.log(`\n⚠ 找不到的 agent (${missingAgents.length} 個):`);
  missingAgents.forEach((m) => console.log(`    ${m}`));
}
console.log(`\n${MAP_PATH} 已更新`);
