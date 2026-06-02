// 自動掃描 213 craft + 12 category 條目，標記具體專案/客戶/品牌的條目供細審
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("scripts/legacy-dump.json", "utf8"));

// 用戶工作區名（從 DB workspaces 表來的）
const WS_PROJECT_NAMES = [
  "LP audio", "LP AUDIO", "世華人才仲介", "世華", "個人IP", "個人 IP",
  "AI自媒體", "AI 自媒體",
];

// 通常意味著「具體案例」而非「通用方法論」的指標詞
// 細分：強訊號（出現基本確定要鎖工作區）vs 弱訊號（需人工判斷）
const STRONG_PROJECT_INDICATORS = [
  // 工作區名
  ...WS_PROJECT_NAMES,
  // 具體公司/客戶名（從 agents-orchestrator 樣本看到的）
  "金田式 DAC", "金田式DAC",
];

const WEAK_PROJECT_INDICATORS = [
  // 用戶提到「使用者已 X」或「老闆要 Y」這種特定情境
  "老闆", "客戶 ABC", "客戶 XYZ",
];

// 強訊號正則：對話現場 timestamp（2026-05-25 之後的，因為批量學習集中在 5-23/24/27）
function hasLateTimestamp(content) {
  // 對話現場時間戳通常是 5/27 之後（批量學習在 5/23-24）
  return /\[2026-0[6-9]|2026-1[0-2]|2026-05-2[5-9]|2026-05-3/.test(content);
}

// 拆解 content 成個別條目（一條 craft 通常含 3-5 個 bullet）
function splitBullets(content) {
  const lines = content.split("\n");
  const bullets = [];
  let cur = "";
  for (const line of lines) {
    if (line.startsWith("- [")) {
      if (cur) bullets.push(cur);
      cur = line;
    } else if (cur) {
      cur += "\n" + line;
    }
  }
  if (cur) bullets.push(cur);
  return bullets;
}

function scanEntry(name, content) {
  const bullets = splitBullets(content);
  const lateTimestamp = hasLateTimestamp(content);
  const hits = { strong: [], weak: [], lateBullets: [] };

  for (const ind of STRONG_PROJECT_INDICATORS) {
    if (content.includes(ind)) hits.strong.push(ind);
  }
  for (const ind of WEAK_PROJECT_INDICATORS) {
    if (content.includes(ind)) hits.weak.push(ind);
  }

  // 對話現場時間戳的 bullets 單獨列
  for (const b of bullets) {
    if (/\[2026-0[6-9]|2026-1[0-2]|2026-05-2[5-9]|2026-05-3/.test(b)) {
      hits.lateBullets.push(b.slice(0, 200));
    }
  }

  return {
    name,
    bullets: bullets.length,
    chars: content.length,
    lateTimestamp,
    strongHits: hits.strong,
    weakHits: hits.weak,
    lateBullets: hits.lateBullets,
    verdict:
      hits.strong.length > 0 ? "REVIEW_NEEDED (含具體專案/客戶)" :
      hits.lateBullets.length > 0 ? "REVIEW_NEEDED (對話現場累積)" :
      hits.weak.length > 0 ? "MAYBE_REVIEW (弱訊號)" :
      "AUTO_KEEP_GLOBAL (純批量學習方法論)",
  };
}

const craftResults = data.craft.map((r) => scanEntry(r.agent_id, r.content));
const catResults = data.category.map((r) => scanEntry(r.category, r.content));

const summary = {
  craft: {
    total: craftResults.length,
    auto_keep_global: craftResults.filter((r) => r.verdict.startsWith("AUTO_KEEP")).length,
    review_needed: craftResults.filter((r) => r.verdict.startsWith("REVIEW")).length,
    maybe_review: craftResults.filter((r) => r.verdict.startsWith("MAYBE")).length,
  },
  category: {
    total: catResults.length,
    auto_keep_global: catResults.filter((r) => r.verdict.startsWith("AUTO_KEEP")).length,
    review_needed: catResults.filter((r) => r.verdict.startsWith("REVIEW")).length,
    maybe_review: catResults.filter((r) => r.verdict.startsWith("MAYBE")).length,
  },
};

console.log("=== Summary ===");
console.log(JSON.stringify(summary, null, 2));

console.log("\n=== Craft 需重審清單（REVIEW_NEEDED）===");
for (const r of craftResults.filter((r) => r.verdict.startsWith("REVIEW"))) {
  console.log(`\n■ ${r.name} (${r.chars} 字, ${r.bullets} bullets)`);
  console.log(`  verdict: ${r.verdict}`);
  if (r.strongHits.length) console.log(`  strong hits: ${r.strongHits.join(", ")}`);
  if (r.lateBullets.length) {
    console.log(`  對話現場累積 bullets:`);
    for (const b of r.lateBullets) console.log(`    » ${b}`);
  }
}

console.log("\n=== Category 需重審清單 ===");
for (const r of catResults.filter((r) => r.verdict.startsWith("REVIEW"))) {
  console.log(`\n■ category=${r.name} (${r.chars} 字, ${r.bullets} bullets)`);
  console.log(`  verdict: ${r.verdict}`);
  if (r.lateBullets.length) {
    for (const b of r.lateBullets) console.log(`    » ${b}`);
  }
}

writeFileSync("scripts/classify-result.json", JSON.stringify({ summary, craftResults, catResults }, null, 2));
console.log("\n寫入 scripts/classify-result.json");
