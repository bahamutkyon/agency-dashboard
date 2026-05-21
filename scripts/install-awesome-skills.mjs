#!/usr/bin/env node
/**
 * Install Awesome Skills — 從 ComposioHQ/awesome-claude-skills 安裝精選 skill
 *
 * 讀 capabilities.manifest.json 的 awesome_skills 區塊(單一真相源),
 * clone 上游 repo,把每個 skill 複製到 ~/.claude/skills/<name>/,
 * 並把 SKILL.md frontmatter 的 name 改成加前綴的 <name>。
 *
 * 用法:
 *   npm run install:awesome           只裝缺的(既有不覆寫)
 *   npm run install:awesome -- --force 全部重裝(覆寫既有)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "capabilities.manifest.json");
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const FORCE = process.argv.includes("--force");

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const warn = (s) => `${C.yellow}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 把 SKILL.md frontmatter 第一個 name: 行改成指定值 */
function rewriteSkillName(skillMdPath, newName) {
  if (!fs.existsSync(skillMdPath)) return false;
  const text = fs.readFileSync(skillMdPath, "utf8");
  const replaced = text.replace(/^name:[^\r\n]*$/m, `name: ${newName}`);
  if (replaced === text) return false;
  fs.writeFileSync(skillMdPath, replaced);
  return true;
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(bad(`找不到 ${MANIFEST_PATH} — 請在 agency-dashboard 根目錄執行`));
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const cfg = manifest.awesome_skills;
  if (!cfg || !Array.isArray(cfg.list)) {
    console.error(bad("manifest 沒有 awesome_skills.list"));
    process.exit(1);
  }

  console.log(bold("🎨 安裝 Awesome Skills") + dim(` (${cfg.list.length} 個,來源 ${cfg.source})`));

  try {
    execSync("git --version", { stdio: "ignore" });
  } catch {
    console.error(bad("✗ 沒裝 git,無法 clone 上游"));
    process.exit(1);
  }

  const installed = fs.existsSync(SKILLS_DIR)
    ? new Set(fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))
    : new Set();

  const todo = FORCE ? cfg.list : cfg.list.filter((s) => !installed.has(s.name));
  if (todo.length === 0) {
    console.log(ok(`   ✅ ${cfg.list.length} 個全部就位,無需安裝`));
    return;
  }
  console.log(dim(`   待安裝 ${todo.length} 個${FORCE ? "(--force 覆寫)" : ""}`));

  const tmpDir = path.join(os.tmpdir(), `awesome-claude-skills-${Date.now()}`);
  console.log(dim(`   → git clone --depth 1 ...`));
  try {
    execSync(`git clone --depth 1 ${cfg.source} "${tmpDir}"`, { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    console.error(bad("✗ clone 失敗"));
    process.exit(1);
  }

  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  let done = 0, skipped = 0, failed = 0;
  for (const s of todo) {
    const src = path.join(tmpDir, ...s.src.split("/"));
    const dest = path.join(SKILLS_DIR, s.name);
    if (!fs.existsSync(path.join(src, "SKILL.md"))) {
      console.log(warn(`   ⚠ ${s.name}: 上游缺 ${s.src}/SKILL.md,跳過`));
      failed++;
      continue;
    }
    if (fs.existsSync(dest)) {
      if (!FORCE) { console.log(dim(`   ⊘ ${s.name} 已存在,跳過`)); skipped++; continue; }
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDirSync(src, dest);
    rewriteSkillName(path.join(dest, "SKILL.md"), s.name);
    console.log(ok(`   ✓ ${s.name}`) + dim(` ← ${s.src}`));
    done++;
  }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log();
  console.log(`   ${bold("統計")}: 安裝 ${ok(done)} · 跳過 ${dim(skipped)} · 失敗 ${failed ? bad(failed) : 0}`);
}

main();
