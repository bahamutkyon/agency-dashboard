#!/usr/bin/env node
/**
 * 把 ~/.claude/agents/ 裡的所有簡體中文 agent 轉成繁體中文(台灣用語)。
 *
 * - 用 opencc-js(`cn` → `tw`)做高品質簡繁轉換
 * - 跳過大陸特定平台的 agent(小紅書、微信、微博、抖音、快手、百度、知乎、
 *   B站、釘釘、飛書、高考、政務、中國電商等)— 這些角色針對 CN 平台,
 *   保留簡體更貼近原意
 * - 第一次執行會把原檔備份成 `<filename>.simplified.bak`,可還原
 *
 * 用法:
 *   node scripts/traditionalize-agents.mjs           # 轉換
 *   node scripts/traditionalize-agents.mjs --revert  # 還原為原本的簡體
 *   node scripts/traditionalize-agents.mjs --dry     # 試跑(不寫檔)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Converter } from "opencc-js";

const AGENTS_DIR = path.join(os.homedir(), ".claude", "agents");

const SKIP_PATTERNS = [
  /xiaohongshu/i,         // 小紅書
  /wechat/i,              // 微信
  /weixin/i,
  /weibo/i,               // 微博
  /douyin/i,              // 抖音
  /kuaishou/i,            // 快手
  /baidu/i,               // 百度
  /zhihu/i,               // 知乎
  /bilibili/i,            // B站
  /B-?zhan/i,
  /dingtalk/i,            // 釘釘
  /dingding/i,
  /feishu/i,              // 飛書
  /^lark/i,
  /gaokao/i,              // 高考(中國大學入學考)
  /government-digital/i,  // 大陸政務
  /china-(localization|ecommerce|market|consumer|streaming)/i,
];

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

if (!fs.existsSync(AGENTS_DIR)) {
  console.error(C.red(`✗ Agents 目錄不存在:${AGENTS_DIR}`));
  process.exit(1);
}

const args = process.argv.slice(2);
const isRevert = args.includes("--revert");
const isDry = args.includes("--dry");

const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

if (isRevert) {
  let restored = 0;
  for (const f of files) {
    const fp = path.join(AGENTS_DIR, f);
    const bak = fp + ".simplified.bak";
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, fp);
      fs.unlinkSync(bak);
      restored++;
    }
  }
  console.log(C.green(`✓ 已還原 ${restored} 個 agent 為原始簡體`));
  process.exit(0);
}

const converter = Converter({ from: "cn", to: "tw" });

console.log(C.bold(`\n${isDry ? "🧪 試跑模式 — " : ""}簡轉繁:${AGENTS_DIR}\n`));

let converted = 0, skipped = 0, unchanged = 0;
const samples = [];

for (const f of files) {
  if (SKIP_PATTERNS.some((p) => p.test(f))) {
    skipped++;
    continue;
  }
  const fp = path.join(AGENTS_DIR, f);
  const original = fs.readFileSync(fp, "utf8");
  const traditional = converter(original);

  if (traditional === original) {
    unchanged++;
    continue;
  }

  // sample first 3 changes for confirmation
  if (samples.length < 3) {
    const oldName = (original.match(/^name:\s*(.+)$/m) || [])[1];
    const newName = (traditional.match(/^name:\s*(.+)$/m) || [])[1];
    if (oldName && newName && oldName !== newName) {
      samples.push({ file: f, old: oldName, new: newName });
    }
  }

  if (!isDry) {
    if (!fs.existsSync(fp + ".simplified.bak")) {
      fs.writeFileSync(fp + ".simplified.bak", original);
    }
    fs.writeFileSync(fp, traditional);
  }
  converted++;
}

console.log(C.green(`✓ ${isDry ? "將會轉換" : "已轉換"}: ${converted} 個`));
console.log(C.yellow(`⊘ 跳過 (CN 平台特定):  ${skipped} 個`));
console.log(C.dim(`◌ 無需更動 (純英文/數字): ${unchanged} 個`));

if (samples.length > 0) {
  console.log(`\n${C.bold("範例變更")}:`);
  for (const s of samples) {
    console.log(`  ${C.dim(s.file.padEnd(50))} ${s.old} → ${C.green(s.new)}`);
  }
}

if (!isDry) {
  console.log(`\n${C.dim("備份檔: <filename>.simplified.bak  · 還原: node scripts/traditionalize-agents.mjs --revert")}\n`);
} else {
  console.log(`\n${C.dim("這只是試跑,沒有實際寫檔。確認沒問題後執行 `node scripts/traditionalize-agents.mjs`")}\n`);
}
