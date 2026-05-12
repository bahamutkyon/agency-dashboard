#!/usr/bin/env node
/**
 * Build agent to relevant-skills map.
 *
 * 讀 ~/.claude/agents/ (213 個 agent) + ~/.claude/skills/ (21 個 skill),
 * 對每個 agent 用 Haiku 4.5 蒸餾出他應該特別善用的 3-5 個 skill + 一句話原因。
 *
 * 結果寫到 agent-skill-map.json(repo 根目錄),供 agentSession.start() 讀取
 * 並注入到 system prompt。
 *
 * 用法:
 *   node scripts/build-agent-skill-map.mjs              # 跑全部 agent
 *   node scripts/build-agent-skill-map.mjs --resume     # 跳過已處理的
 *   node scripts/build-agent-skill-map.mjs --agent foo  # 只重跑某 agent
 *   node scripts/build-agent-skill-map.mjs --limit 10   # 試跑前 10 個(預估成本用)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MAP_PATH = path.join(PROJECT_ROOT, "agent-skill-map.json");
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const AGENTS_DIR = path.join(os.homedir(), ".claude", "agents");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const log = {
  ok: (s) => console.log(`${C.green}✓${C.reset} ${s}`),
  err: (s) => console.log(`${C.red}✗${C.reset} ${s}`),
  warn: (s) => console.log(`${C.yellow}!${C.reset} ${s}`),
  info: (s) => console.log(`${C.dim}·${C.reset} ${s}`),
};

const args = process.argv.slice(2);
const resume = args.includes("--resume");
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
const onlyAgent = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : null;

// ===== Read skills =====
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function readSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const text = fs.readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(text);
    skills.push({
      id: entry.name,
      name: fm.name || entry.name,
      description: fm.description || "",
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

function readAgents() {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const agents = [];
  for (const f of fs.readdirSync(AGENTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const text = fs.readFileSync(path.join(AGENTS_DIR, f), "utf8");
    const fm = parseFrontmatter(text);
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    agents.push({
      id,
      name: fm.name || id,
      description: fm.description || "",
      // Truncate body to keep prompts cheap
      excerpt: body.slice(0, 1500),
    });
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

// ===== Call Haiku via claude CLI =====
function callHaiku(prompt) {
  return new Promise((resolve, reject) => {
    const claudePath = process.platform === "win32" ? "claude" : "claude";
    const child = spawn(claudePath, [
      "-p", "--output-format", "json",
      "--model", "claude-haiku-4-5-20251001",
      "--no-session-persistence",
      "--disable-slash-commands",
    ], { shell: process.platform === "win32" });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.stdin.write(Buffer.from(prompt, "utf8"));
    child.stdin.end();
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 200)}`));
      try {
        const j = JSON.parse(out);
        resolve(String(j.result || ""));
      } catch (e) {
        reject(new Error("parse failed: " + e.message));
      }
    });
  });
}

function buildPrompt(agent, skills) {
  const catalog = skills
    .map((s) => `- **${s.id}** — ${s.description}`)
    .join("\n");
  return `你正在幫一個多 agent 協作系統做 skill priming。

# 任務
以下這位 agent,從 21 個全域 skill 中挑出他**最該特別善用**的 3-5 個(他做工作時這些 skill 最容易被觸發 / 最能提升品質)。

# 規則
- 不是所有 skill 都要選,只選最相關的 3-5 個
- 用 agent 領域 / 職責去推斷,不要只看名稱字面對應
- "using-superpowers" 是 meta skill,所有 agent 都會自動拿到,**不要**選它
- 嚴格輸出 JSON,不要解釋:
\`\`\`json
{"skills": [{"id": "skill-id", "why": "一句話為什麼這位 agent 該特別用這個 skill"}]}
\`\`\`

---

# Agent
**id**: ${agent.id}
**name**: ${agent.name}
**description**: ${agent.description}

**persona excerpt**:
${agent.excerpt}

---

# 可選 Skills(21 個)
${catalog}

請挑 3-5 個最相關的,輸出 JSON。`;
}

// ===== Load existing map for resume =====
let existing = {};
if (fs.existsSync(MAP_PATH) && resume) {
  try {
    const j = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
    existing = j.agents || {};
    log.info(`resume mode: ${Object.keys(existing).length} agents already mapped`);
  } catch {}
}

// ===== Main =====
async function main() {
  console.log(`${C.bold}🧠 Agent → Skill priming mapper${C.reset}\n`);
  const skills = readSkills();
  const allAgents = readAgents();
  log.info(`loaded ${skills.length} skills, ${allAgents.length} agents`);

  let agents = allAgents;
  if (onlyAgent) {
    agents = agents.filter((a) => a.id === onlyAgent);
    if (agents.length === 0) {
      log.err(`agent not found: ${onlyAgent}`);
      process.exit(1);
    }
  }

  const skipped = resume ? agents.filter((a) => existing[a.id]).length : 0;
  if (skipped > 0) log.info(`skipping ${skipped} already-mapped agents (resume mode)`);
  agents = resume ? agents.filter((a) => !existing[a.id]) : agents;
  agents = agents.slice(0, limit);

  log.info(`processing ${agents.length} agents…\n`);

  const map = { ...existing };
  let okCount = 0;
  let failCount = 0;
  const start = Date.now();

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const pct = (((i + 1) / agents.length) * 100).toFixed(0);
    process.stdout.write(`${C.dim}[${i + 1}/${agents.length} ${pct}%]${C.reset} ${a.id.padEnd(50)} `);
    try {
      const prompt = buildPrompt(a, skills);
      const raw = await callHaiku(prompt);
      // Strip code fences if present
      const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed.skills || !Array.isArray(parsed.skills)) {
        throw new Error("missing skills array");
      }
      // Validate skill ids exist
      const validSkillIds = new Set(skills.map((s) => s.id));
      const filtered = parsed.skills.filter((s) => s.id && validSkillIds.has(s.id));
      if (filtered.length === 0) throw new Error("no valid skill ids");
      map[a.id] = { skills: filtered };
      okCount++;
      console.log(`${C.green}→ ${filtered.map((s) => s.id).join(", ")}${C.reset}`);

      // Save progress every 5 agents
      if ((i + 1) % 5 === 0) {
        fs.writeFileSync(MAP_PATH, JSON.stringify({
          generated_at: new Date().toISOString(),
          skill_count: skills.length,
          agent_count: Object.keys(map).length,
          agents: map,
        }, null, 2));
      }
    } catch (e) {
      failCount++;
      console.log(`${C.red}fail: ${e.message.slice(0, 60)}${C.reset}`);
    }
  }

  // Final save
  fs.writeFileSync(MAP_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    skill_count: skills.length,
    agent_count: Object.keys(map).length,
    agents: map,
  }, null, 2));

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log();
  log.ok(`done in ${elapsed}s — ${okCount} ok, ${failCount} failed`);
  log.info(`output: ${MAP_PATH}`);
}

main().catch((e) => {
  log.err(e.message);
  process.exit(1);
});
