#!/usr/bin/env node
/**
 * Setup Full — 互動式一鍵安裝(會改檔,但每步先問)
 *
 * 流程:
 *   1. 讀 capabilities.manifest.json
 *   2. 比對你機器上有什麼
 *   3. 對缺項一個一個問你要不要裝(Y/n)
 *   4. 自動跑安裝指令 + patch ~/.claude.json
 *
 * 安全機制:
 *   - 任何修改 ~/.claude.json 之前先備份成 .bak-pre-setup
 *   - 受保護的 skill(本 repo bundled 的)用本地版本,不從外部 clone 覆蓋
 *   - 需 API key 的 MCP(google-workspace、gemini-image)只給說明,不替你設 env
 *
 * 用法:npm run setup:full
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "capabilities.manifest.json");
const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, ".claude", "skills");
const AGENTS_DIR = path.join(HOME, ".claude", "agents");
const CLAUDE_CONFIG = path.join(HOME, ".claude.json");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m",
};
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const warn = (s) => `${C.yellow}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
const yes = async (q, def = "Y") => {
  const a = (await ask(`${q} [${def === "Y" ? "Y/n" : "y/N"}]: `)).toLowerCase();
  if (!a) return def === "Y";
  return a === "y" || a === "yes";
};

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function readClaudeConfig() {
  if (!fs.existsSync(CLAUDE_CONFIG)) return { mcpServers: {} };
  return JSON.parse(fs.readFileSync(CLAUDE_CONFIG, "utf8"));
}

function backupClaudeConfig() {
  if (!fs.existsSync(CLAUDE_CONFIG)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = `${CLAUDE_CONFIG}.bak-setup-${ts}`;
  fs.copyFileSync(CLAUDE_CONFIG, dest);
  return dest;
}

function writeClaudeConfig(cfg) {
  fs.writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2));
}

function exec(cmd, opts = {}) {
  console.log(dim(`   $ ${cmd}`));
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return true;
  } catch (e) {
    console.log(bad(`   ✗ 失敗:${e.message}`));
    return false;
  }
}

function commandExists(cmd) {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function listSkillsOnDisk() {
  if (!fs.existsSync(SKILLS_DIR)) return new Set();
  return new Set(fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name));
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ============== Step 1: Skills ==============

async function setupSkills(manifest) {
  console.log();
  console.log(bold("📚 Step 1/4: Skills"));
  console.log(dim(`   Skills 是 dashboard agent 的協作流程規範,影響每位 agent 的行為。`));

  const installed = listSkillsOnDisk();
  const missing = manifest.skills.expected.filter((s) => !installed.has(s.name));

  if (missing.length === 0) {
    console.log(ok(`   ✅ 21 個 skill 全部就位,跳過`));
    return;
  }

  console.log(`   ${warn(`缺 ${missing.length} 個`)}: ${missing.map((m) => m.name).join(", ")}`);
  if (!await yes("   要安裝嗎?")) {
    console.log(dim("   跳過"));
    return;
  }

  // 處理本 repo bundled 的 protected skills(優先用本地版本)
  const bundledSkills = missing.filter((s) => s.bundled);
  for (const s of bundledSkills) {
    const localSrc = path.join(PROJECT_ROOT, s.bundled);
    const dest = path.join(SKILLS_DIR, s.name);
    if (fs.existsSync(localSrc)) {
      console.log(`   ${ok("→")} 從本 repo 複製 ${bold(s.name)}`);
      copyDirSync(localSrc, dest);
    } else {
      console.log(warn(`   ⚠️ 找不到本地 bundled 來源 ${localSrc}`));
    }
  }

  // 其他 skills 從 superpowers-zh 來源 clone + 複製
  const fromUpstream = missing.filter((s) => !s.bundled);
  if (fromUpstream.length > 0) {
    if (!commandExists("git")) {
      console.log(bad("   ✗ 沒裝 git,無法 clone 上游 skills"));
      console.log(dim(`     請手動裝 git 或 clone ${manifest.skills.source}`));
      return;
    }
    const tmpDir = path.join(os.tmpdir(), `superpowers-zh-${Date.now()}`);
    console.log(`   ${dim("→ clone superpowers-zh 到")} ${tmpDir}`);
    if (!exec(`git clone --depth 1 ${manifest.skills.source} "${tmpDir}"`)) return;

    // superpowers-zh 通常 skills 在 skills/ 子目錄
    const srcSkillsDir = fs.existsSync(path.join(tmpDir, "skills"))
      ? path.join(tmpDir, "skills")
      : tmpDir;

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    let copied = 0;
    for (const s of fromUpstream) {
      const src = path.join(srcSkillsDir, s.name);
      const dest = path.join(SKILLS_DIR, s.name);
      if (fs.existsSync(src) && fs.existsSync(path.join(src, "SKILL.md"))) {
        if (fs.existsSync(dest)) {
          console.log(dim(`   ⊘ ${s.name} 已存在,跳過(不覆寫)`));
          continue;
        }
        copyDirSync(src, dest);
        copied++;
        console.log(`   ${ok("✓")} ${s.name}`);
      } else {
        console.log(warn(`   ⚠️ 上游沒有 ${s.name},跳過`));
      }
    }
    console.log(`   ${ok(`已複製 ${copied} 個 skill`)}`);
    // 清掉 tmp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ============== Step 2: Agents ==============

async function setupAgents(manifest) {
  console.log();
  console.log(bold("👥 Step 2/4: Agents"));
  console.log(dim(`   211 位中文 agent — 來自 agency-agents-zh,是 dashboard 的核心。`));

  const expected = manifest.agents.expected_count;
  const have = fs.existsSync(AGENTS_DIR)
    ? fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).length
    : 0;

  if (have >= expected - 5) {
    console.log(ok(`   ✅ ${have}/${expected} 已就位,跳過`));
    return;
  }

  console.log(`   ${warn(`目前 ${have}/${expected}`)}`);
  if (!await yes("   要 clone agency-agents-zh 並執行 install 嗎?")) {
    console.log(dim("   跳過"));
    return;
  }
  if (!commandExists("git")) {
    console.log(bad("   ✗ 沒裝 git"));
    return;
  }
  if (!commandExists("bash")) {
    console.log(warn("   ⚠️ 沒偵測到 bash,Windows 用戶請改用 Git Bash 跑"));
  }

  const target = path.join(HOME, "Desktop", "claude", "agency-agents-zh");
  console.log(`   ${dim("→ clone 到")} ${target}`);

  if (fs.existsSync(target)) {
    console.log(dim(`   目錄已存在,跳過 clone(若想重來請手動刪除)`));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!exec(`git clone ${manifest.agents.install.repo} "${target}"`)) return;
  }

  console.log(`   ${dim("→ 跑 install.sh")}`);
  exec(`bash scripts/install.sh --tool claude-code`, { cwd: target });
}

// ============== Step 3: MCPs ==============

async function setupMcps(manifest) {
  console.log();
  console.log(bold("🔌 Step 3/4: MCP Servers"));
  console.log(dim(`   MCPs 是 dashboard agent 能呼叫的外部工具(瀏覽器 / Office / 安全防護等)`));

  const cfg = readClaudeConfig();
  cfg.mcpServers = cfg.mcpServers || {};
  let backupCreated = null;
  let configChanged = false;

  for (const m of manifest.mcps) {
    const installed = !!cfg.mcpServers[m.name];
    const tag = m.tier === "baseline" ? `${C.green}[baseline]${C.reset}`
      : m.tier === "recommended" ? `${C.blue}[recommended]${C.reset}`
      : dim("[optional]");

    if (installed) {
      console.log(`   ${ok("✅")} ${m.name.padEnd(20)} ${tag}  ${dim("已就位")}`);
      continue;
    }

    console.log();
    console.log(`   ${warn("✗")} ${m.name.padEnd(20)} ${tag}`);
    console.log(`     ${dim(m.description)}`);
    if (m.manual_setup_note) {
      console.log(`     ${warn("⚠️ ")}${m.manual_setup_note}`);
    }

    const defAns = m.tier === "baseline" || m.tier === "recommended" ? "Y" : "N";
    if (!await yes(`     要安裝嗎?`, defAns)) {
      console.log(dim("     跳過"));
      continue;
    }

    // 跑 install
    let installCmd, cmdName;
    if (m.install.method === "npm-global") {
      installCmd = `npm install -g ${m.install.package}`;
      cmdName = m.command;
    } else if (m.install.method === "pip") {
      const py = process.platform === "win32" ? "py -3.11 -m pip" : "pip3";
      installCmd = `${py} install ${m.install.package}`;
      cmdName = m.command_hint || m.command;
    } else {
      console.log(warn("     不支援的 install method,跳過"));
      continue;
    }

    if (!exec(installCmd)) {
      console.log(bad(`     安裝 ${m.name} 失敗,跳過`));
      continue;
    }

    // 解析 command 路徑
    let resolvedCmd = m.command;
    if (m.install.method === "pip" && process.platform === "win32") {
      // 找 ppt_mcp_server.exe 之類的
      try {
        const out = execSync(`where ${m.command || "ppt_mcp_server"}`, { encoding: "utf8" });
        resolvedCmd = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s.endsWith(".exe")) || m.command;
      } catch { /* fall through */ }
    }

    // patch ~/.claude.json
    if (!backupCreated) {
      backupCreated = backupClaudeConfig();
      if (backupCreated) console.log(dim(`     (備份 ~/.claude.json → ${path.basename(backupCreated)})`));
    }

    const entry = {
      type: "stdio",
      command: resolvedCmd,
      args: [],
      env: m.env_recommended || {},
    };
    cfg.mcpServers[m.name] = entry;
    configChanged = true;
    console.log(ok(`     ✓ 已加入 ~/.claude.json`));

    if (m.env_required && m.env_required.length > 0) {
      console.log(warn(`     ⚠️ 別忘了設環境變數:${m.env_required.join(", ")}`));
    }
  }

  if (configChanged) {
    writeClaudeConfig(cfg);
    console.log();
    console.log(ok(`   ✅ ~/.claude.json 已更新`));
  }
}

// ============== Step 4: CLI ==============

async function setupCli(manifest) {
  console.log();
  console.log(bold("⌨️  Step 4/4: CLI Tools"));
  console.log(dim(`   底層 LLM provider — Claude 必裝,Codex / Gemini 是備胎。`));

  for (const t of manifest.cli_tools) {
    if (commandExists(t.name)) {
      console.log(`   ${ok("✅")} ${t.name}`);
      continue;
    }
    console.log(`   ${bad("✗")} ${t.name}  ${dim(t.description)}`);
    if (t.install.method === "external") {
      console.log(`     ${dim("→ 請手動裝:")} ${bold(t.install.url)}`);
      continue;
    }
    if (t.install.method === "npm-global") {
      const def = t.tier === "required" ? "Y" : "N";
      if (await yes(`     要安裝嗎?`, def)) {
        exec(`npm install -g ${t.install.package}`);
      }
    }
  }
}

// ============== Main ==============

async function main() {
  console.log();
  console.log(bold("🚀 Agency Dashboard 完整安裝精靈"));
  console.log(dim(`   依照 capabilities.manifest.json 自動補齊缺項。`));
  console.log(dim(`   ${C.reset}${warn("每一步都會先問,絕不偷偷動你的家目錄。")}`));
  console.log();

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log(bad("找不到 capabilities.manifest.json,確認你在專案根目錄"));
    rl.close();
    process.exit(1);
  }

  const manifest = loadManifest();

  if (!await yes("確定要開始?")) {
    console.log(dim("已取消"));
    rl.close();
    return;
  }

  await setupSkills(manifest);
  await setupAgents(manifest);
  await setupMcps(manifest);
  await setupCli(manifest);

  console.log();
  console.log(bold("─".repeat(60)));
  console.log(ok("✨ 安裝精靈完成"));
  console.log(dim("執行 npm run doctor 檢查最終狀態"));
  console.log();
  rl.close();
}

main().catch((e) => {
  console.error(bad("錯誤:"), e);
  rl.close();
  process.exit(1);
});
