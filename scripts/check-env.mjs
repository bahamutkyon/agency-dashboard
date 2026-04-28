#!/usr/bin/env node
// 首次執行環境檢查 — 確認 claude CLI、agents、Node 版本都到位
// 對開發者友善:每個錯誤都告訴他下一步該做什麼

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

let problems = 0;

function ok(label, detail) { console.log(`  ${C.green("✓")} ${label}${detail ? C.dim(" — " + detail) : ""}`); }
function bad(label, hint) {
  console.log(`  ${C.red("✗")} ${label}`);
  if (hint) console.log(`    ${C.yellow("→")} ${hint}`);
  problems++;
}

console.log(C.bold("\n專家團隊儀表板 — 環境檢查\n"));

// 1. Node version
const nodeVer = process.versions.node;
const major = Number(nodeVer.split(".")[0]);
if (major >= 22) {
  ok(`Node.js ${nodeVer}`, "支援內建 SQLite");
} else {
  bad(
    `Node.js ${nodeVer} 太舊(需要 22+)`,
    "前往 https://nodejs.org/ 下載最新 LTS"
  );
}

// 2. claude CLI
try {
  const ver = execSync("claude --version", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  ok(`Claude CLI ${ver}`);
} catch {
  bad(
    "Claude CLI 未安裝或不在 PATH",
    "請先安裝 Claude Code:https://claude.com/claude-code"
  );
}

// 3. claude logged in
try {
  const status = execSync("claude auth status", { stdio: ["ignore", "pipe", "ignore"] }).toString();
  const j = JSON.parse(status);
  if (j.loggedIn) {
    const sub = j.subscriptionType ? ` · ${j.subscriptionType} 訂閱` : "";
    ok(`Claude 已登入(${j.email}${sub})`);
  } else {
    bad("Claude CLI 尚未登入", "執行 `claude /login`(或設定 ANTHROPIC_API_KEY)");
  }
} catch {
  bad("無法取得 Claude 認證狀態", "執行 `claude auth status` 看看哪裡有問題");
}

// 4. Agents installed
const agentsDir = path.join(os.homedir(), ".claude", "agents");
if (fs.existsSync(agentsDir)) {
  const count = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).length;
  if (count > 0) {
    ok(`Agents 已安裝`, `${count} 位 in ${agentsDir}`);
  } else {
    bad(
      `Agents 目錄為空(${agentsDir})`,
      "git clone https://github.com/jnMetaCode/agency-agents-zh 後執行其 install.sh --tool claude-code"
    );
  }
} else {
  bad(
    `Agents 目錄不存在(${agentsDir})`,
    "git clone https://github.com/jnMetaCode/agency-agents-zh 後執行其 install.sh --tool claude-code"
  );
}

// 5. Server / client deps installed
const serverNm = path.join(process.cwd(), "server", "node_modules");
const clientNm = path.join(process.cwd(), "client", "node_modules");
if (fs.existsSync(serverNm) && fs.existsSync(clientNm)) {
  ok("前後端依賴已安裝");
} else {
  bad(
    "缺少 node_modules",
    "在專案根目錄執行 `npm run install:all`"
  );
}

if (problems === 0) {
  console.log(C.green(C.bold("\n✓ 一切就緒,執行 `npm run dev` 啟動儀表板\n")));
  process.exit(0);
} else {
  console.log(C.red(C.bold(`\n✗ ${problems} 個問題待修復,修好後再跑一次 \`npm run check\`\n`)));
  process.exit(1);
}
