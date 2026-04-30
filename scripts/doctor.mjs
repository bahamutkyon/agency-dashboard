#!/usr/bin/env node
/**
 * Capability Doctor — 體檢腳本(只讀,不改任何東西)
 *
 * 讀 capabilities.manifest.json,比對你機器上實際有什麼,輸出彩色報告。
 * 缺什麼就直接給你 fix 指令(可複製)。
 *
 * 用法:npm run doctor
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "capabilities.manifest.json");

// ANSI colors — fall back gracefully if terminal doesn't support
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
};
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const warn = (s) => `${C.yellow}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(bad(`找不到 ${MANIFEST_PATH}`));
    console.error(dim("確認你在 agency-dashboard 專案根目錄執行此腳本"));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function hasCommand(cmd) {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readClaudeMcps() {
  const cfg = path.join(os.homedir(), ".claude.json");
  if (!fs.existsSync(cfg)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(cfg, "utf8"));
    return new Set(Object.keys(raw.mcpServers || {}));
  } catch {
    return new Set();
  }
}

function listSkills() {
  const dir = path.join(os.homedir(), ".claude", "skills");
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name));
}

function countAgents() {
  const dir = path.join(os.homedir(), ".claude", "agents");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

function buildInstallCmd(mcp) {
  const i = mcp.install;
  if (i.method === "npm-global") return `npm install -g ${i.package}`;
  if (i.method === "pip") {
    const py = process.platform === "win32" ? "py -3.11 -m pip" : "pip3";
    return `${py} install ${i.package}`;
  }
  return `(see ${mcp.name} docs)`;
}

function main() {
  const manifest = loadManifest();

  console.log();
  console.log(bold("🩺 Agency Dashboard Capability Doctor"));
  console.log(dim(`   manifest version ${manifest.manifest_version} · ${new Date().toLocaleString()}`));
  console.log();

  let missingCount = 0;
  let criticalMissing = 0;
  const fixCommands = [];

  // ===== Skills =====
  const installedSkills = listSkills();
  const expectedSkills = manifest.skills.expected;
  const skillsInstalled = expectedSkills.filter((s) => installedSkills.has(s.name)).length;
  const skillsMissing = expectedSkills.filter((s) => !installedSkills.has(s.name));

  console.log(bold(`📚 Skills`) + dim(` (~/.claude/skills/)`));
  if (skillsMissing.length === 0) {
    console.log(`   ${ok("✅")} ${skillsInstalled}/${expectedSkills.length} 全部就位`);
  } else {
    console.log(`   ${warn("⚠️")} ${skillsInstalled}/${expectedSkills.length}  缺 ${skillsMissing.length} 個:`);
    for (const s of skillsMissing) {
      console.log(`      ${bad("✗")} ${s.name}  ${dim(`(來源: ${s.from})`)}`);
    }
    console.log(`   ${dim("修復:")} 執行 ${bold("npm run setup:full")} 互動式安裝,或手動 git clone ${manifest.skills.source}`);
    missingCount += skillsMissing.length;
  }
  console.log();

  // ===== MCPs =====
  const installedMcps = readClaudeMcps();
  console.log(bold(`🔌 MCPs`) + dim(` (~/.claude.json mcpServers)`));
  let mcpInstalled = 0;
  for (const m of manifest.mcps) {
    const has = installedMcps.has(m.name);
    if (has) {
      mcpInstalled++;
      const tierBadge = m.tier === "baseline" ? ok("[baseline]")
        : m.tier === "recommended" ? `${C.blue}[recommended]${C.reset}`
        : dim("[optional]");
      console.log(`   ${ok("✅")} ${m.name.padEnd(20)} ${tierBadge}`);
    } else {
      const cmd = buildInstallCmd(m);
      const tierBadge = m.tier === "baseline" ? bad("[baseline]")
        : m.tier === "recommended" ? warn("[recommended]")
        : dim("[optional]");
      console.log(`   ${bad("✗")} ${m.name.padEnd(20)} ${tierBadge}`);
      console.log(`      ${dim("→")} ${m.description}`);
      console.log(`      ${dim("→ Fix:")} ${bold(cmd)}`);
      if (m.manual_setup_note) {
        console.log(`      ${dim("→ Note:")} ${warn(m.manual_setup_note)}`);
      }
      fixCommands.push(cmd);
      missingCount++;
      if (m.tier === "baseline") criticalMissing++;
    }
  }
  console.log(`   ${dim("──")} ${mcpInstalled}/${manifest.mcps.length} 已安裝`);
  console.log();

  // ===== Agents =====
  const agentCount = countAgents();
  const expectedAgents = manifest.agents.expected_count;
  console.log(bold(`👥 Agents`) + dim(` (~/.claude/agents/)`));
  if (agentCount >= expectedAgents - 5) {
    console.log(`   ${ok("✅")} ${agentCount}/${expectedAgents} ${dim("(允許 ±5 漂移)")}`);
  } else if (agentCount === 0) {
    console.log(`   ${bad("✗")} 0/${expectedAgents}  ${bad("沒裝任何 agent!")}`);
    console.log(`   ${dim("修復:")}`);
    console.log(`     ${bold(`git clone ${manifest.agents.install.repo}`)}`);
    console.log(`     ${bold(`cd agency-agents-zh && bash scripts/install.sh --tool claude-code`)}`);
    missingCount++;
    criticalMissing++;
  } else {
    console.log(`   ${warn("⚠️")} ${agentCount}/${expectedAgents} ${warn("不完整")}`);
    console.log(`   ${dim("修復:")} 重新跑 agency-agents-zh 的 install.sh`);
    missingCount++;
  }
  console.log();

  // ===== CLI Tools =====
  console.log(bold(`⌨️  CLI Tools`) + dim(` (provider 入口)`));
  for (const t of manifest.cli_tools) {
    const has = hasCommand(t.name);
    if (has) {
      console.log(`   ${ok("✅")} ${t.name.padEnd(10)} ${dim(t.description)}`);
    } else {
      const tag = t.tier === "required" ? bad("[required]") : dim("[optional]");
      console.log(`   ${bad("✗")} ${t.name.padEnd(10)} ${tag}`);
      console.log(`      ${dim("→")} ${t.description}`);
      if (t.install.method === "npm-global") {
        console.log(`      ${dim("→ Fix:")} ${bold(`npm install -g ${t.install.package}`)}`);
      } else if (t.install.method === "external") {
        console.log(`      ${dim("→ See:")} ${bold(t.install.url)}`);
      }
      missingCount++;
      if (t.tier === "required") criticalMissing++;
    }
  }
  console.log();

  // ===== Summary =====
  console.log(bold("─".repeat(60)));
  if (missingCount === 0) {
    console.log(`${ok("✨ 全部就位!")} 你的 dashboard 是一台完整配置的機器。`);
  } else {
    if (criticalMissing > 0) {
      console.log(`${bad(`✗ 缺 ${missingCount} 項,其中 ${criticalMissing} 個關鍵`)} (baseline / required)`);
    } else {
      console.log(`${warn(`⚠ 缺 ${missingCount} 項`)} (都是 recommended 或 optional)`);
    }
    console.log();
    console.log(dim("一鍵補齊:") + bold(" npm run setup:full"));
  }
  console.log();

  process.exit(criticalMissing > 0 ? 2 : 0);
}

main();
