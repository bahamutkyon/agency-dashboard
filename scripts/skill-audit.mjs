#!/usr/bin/env node
/**
 * Skill audit — 從 agent-skill-map.json 反向統計每個 skill 被多少 agent 主推。
 *
 * 用法:
 *   node scripts/skill-audit.mjs              # 終端輸出彩色報告
 *   node scripts/skill-audit.mjs --out FILE   # 輸出 markdown 到檔案
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MAP_PATH = path.join(PROJECT_ROOT, "agent-skill-map.json");
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  cyan: "\x1b[36m", magenta: "\x1b[35m",
};

const args = process.argv.slice(2);
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

if (!fs.existsSync(MAP_PATH)) {
  console.error("找不到 agent-skill-map.json — 先跑 npm run build:skill-map");
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));

// === Build stats ===
const skillCount = new Map();      // skillId -> count
const skillReasons = new Map();    // skillId -> [why...] sample
const skillToAgents = new Map();   // skillId -> [agentId...]

for (const [agentId, entry] of Object.entries(map.agents)) {
  for (const s of entry.skills || []) {
    skillCount.set(s.id, (skillCount.get(s.id) || 0) + 1);
    if (!skillReasons.has(s.id)) skillReasons.set(s.id, []);
    if (skillReasons.get(s.id).length < 3) skillReasons.get(s.id).push({ agent: agentId, why: s.why });
    if (!skillToAgents.has(s.id)) skillToAgents.set(s.id, []);
    skillToAgents.get(s.id).push(agentId);
  }
}

// 找所有實際存在的 skill(包含完全沒被 priming 的)
const allSkills = fs.existsSync(SKILLS_DIR)
  ? fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  : [];

for (const id of allSkills) {
  if (!skillCount.has(id)) skillCount.set(id, 0);
}

const sorted = [...skillCount.entries()].sort((a, b) => b[1] - a[1]);
const totalAgents = map.agent_count;
const totalSkills = allSkills.length;

// === Render ===
function renderTerminal() {
  console.log();
  console.log(`${C.bold}🧠 Skill Priming Audit${C.reset}`);
  console.log(`${C.dim}generated ${map.generated_at}${C.reset}`);
  console.log(`${C.dim}${totalAgents} agents mapped, ${totalSkills} skills available${C.reset}`);
  console.log();

  console.log(`${C.bold}Skills by adoption rate${C.reset}`);
  console.log(`${C.dim}skill                              count   bar${C.reset}`);
  const maxCount = sorted[0][1];
  for (const [id, count] of sorted) {
    const barLen = maxCount > 0 ? Math.round((count / maxCount) * 40) : 0;
    const bar = "█".repeat(barLen);
    const pct = ((count / totalAgents) * 100).toFixed(0).padStart(3);
    const color = count === 0 ? C.red
      : count < totalAgents * 0.05 ? C.yellow
      : count > totalAgents * 0.5 ? C.green
      : C.cyan;
    console.log(`${color}${id.padEnd(35)} ${String(count).padStart(4)}  ${pct}%${C.reset} ${C.dim}${bar}${C.reset}`);
  }

  console.log();
  console.log(`${C.bold}Insights${C.reset}`);
  const dead = sorted.filter(([_, c]) => c === 0);
  const rare = sorted.filter(([_, c]) => c > 0 && c < 5);
  const star = sorted.filter(([_, c]) => c >= totalAgents * 0.5);

  if (dead.length > 0) {
    console.log(`${C.red}⚠ ${dead.length} skill 完全沒被任何 agent priming(可考慮移除):${C.reset}`);
    dead.forEach(([id]) => console.log(`   - ${id}`));
  }
  if (rare.length > 0) {
    console.log(`${C.yellow}⚠ ${rare.length} skill 只被 < 5 個 agent 推:${C.reset}`);
    rare.forEach(([id, c]) => console.log(`   - ${id} (${c})`));
  }
  if (star.length > 0) {
    console.log(`${C.green}★ ${star.length} skill 被 ≥ 50% agent 推(明星 skill):${C.reset}`);
    star.forEach(([id, c]) => console.log(`   - ${id} (${c}/${totalAgents})`));
  }

  console.log();
  console.log(`${C.bold}範例:每個 skill 被推薦的理由(前 3 個)${C.reset}`);
  for (const [id] of sorted.filter(([_, c]) => c > 0).slice(0, 5)) {
    console.log(`${C.cyan}● ${id}${C.reset}`);
    for (const r of skillReasons.get(id) || []) {
      console.log(`   ${C.dim}└ ${r.agent}: ${r.why}${C.reset}`);
    }
  }
  console.log();
}

function renderMarkdown() {
  const lines = [];
  lines.push(`# Skill Priming Audit Report`);
  lines.push(``);
  lines.push(`- Generated: ${map.generated_at}`);
  lines.push(`- Agents mapped: ${totalAgents}`);
  lines.push(`- Skills available: ${totalSkills}`);
  lines.push(``);
  lines.push(`## Skills by adoption rate`);
  lines.push(``);
  lines.push(`| Skill | Agents | % of total |`);
  lines.push(`|---|---:|---:|`);
  for (const [id, count] of sorted) {
    const pct = ((count / totalAgents) * 100).toFixed(0);
    lines.push(`| \`${id}\` | ${count} | ${pct}% |`);
  }
  lines.push(``);
  lines.push(`## Insights`);
  const dead = sorted.filter(([_, c]) => c === 0);
  const rare = sorted.filter(([_, c]) => c > 0 && c < 5);
  const star = sorted.filter(([_, c]) => c >= totalAgents * 0.5);
  if (dead.length) {
    lines.push(``, `### ⚠️ Zero-adoption skills`, ``);
    dead.forEach(([id]) => lines.push(`- \`${id}\``));
  }
  if (rare.length) {
    lines.push(``, `### 🟡 Rarely used (<5 agents)`, ``);
    rare.forEach(([id, c]) => lines.push(`- \`${id}\` (${c})`));
  }
  if (star.length) {
    lines.push(``, `### ⭐ Star skills (≥50% adoption)`, ``);
    star.forEach(([id, c]) => lines.push(`- \`${id}\` (${c}/${totalAgents})`));
  }
  lines.push(``, `## Sample reasoning`, ``);
  for (const [id] of sorted.filter(([_, c]) => c > 0).slice(0, 10)) {
    lines.push(`### \`${id}\``);
    for (const r of skillReasons.get(id) || []) {
      lines.push(`- **${r.agent}**: ${r.why}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

if (outFile) {
  fs.writeFileSync(outFile, renderMarkdown());
  console.log(`報告寫入: ${outFile}`);
} else {
  renderTerminal();
}
