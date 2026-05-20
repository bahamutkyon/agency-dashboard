#!/usr/bin/env node
/**
 * Skill usage validator — 掃 agent 輸出,判斷是否真的呼叫了 skill
 *
 * 三種輸入方式:
 *   1. 檔案:           node validate-skill-usage.mjs output.txt
 *   2. Stdin:          cat output.txt | node validate-skill-usage.mjs
 *   3. Dashboard API:  node validate-skill-usage.mjs --session-id <id>
 *
 * 可選 flag:
 *   --expected <list>   逗號分隔,指定要檢查的 skill(例:creative-quality-gate,design-system-picker)
 *                       不指定就掃所有已知 skill
 *   --verbose           列出每個 pattern 的命中位置
 *
 * 輸出三級信號:
 *   ✅ strong   skill 留下明確標記(高度確信用了)
 *   🟡 medium   有部分標記但不齊全
 *   🟠 weak     只有微弱訊號,可能巧合
 *   ❌ none     完全沒看到
 */

import fs from "node:fs";

// 每個 skill 一組 pattern,從強到弱
// 設計原則:強訊號要難「巧合命中」,需要 skill 規定的「特殊輸出格式」才算
const SKILL_PATTERNS = {
  "creative-quality-gate": {
    strong: [
      // 完整自評區塊:五個維度都有評分
      /##\s*自評[\s\S]{0,1500}?(Philosophy|哲學)[\s\S]{0,200}?\d\s*\/\s*5[\s\S]{0,1500}?(Hierarchy|層次)[\s\S]{0,200}?\d\s*\/\s*5[\s\S]{0,1500}?(Detail|細節)[\s\S]{0,200}?\d\s*\/\s*5[\s\S]{0,1500}?(Function|功能)[\s\S]{0,200}?\d\s*\/\s*5[\s\S]{0,1500}?(Innovation|創新)[\s\S]{0,200}?\d\s*\/\s*5/i,
      // 「通過閘門」明確結論
      /(最低分|最低|minimum)[\s\S]{0,30}?(✅|通過|pass).*閘門/i,
    ],
    medium: [
      /五維(自評|評審)/,
      /(Philosophy|Hierarchy|Detail|Function|Innovation).*?\d\s*\/\s*5/,
      /anti-?AI-?slop/i,
      /閘門[一二1-2].*?檢查/,
    ],
    weak: [
      /(品質|quality)\s*閘門/,
      /creative-quality-gate/,
    ],
  },

  "design-system-picker": {
    strong: [
      // 明確點名某個 design system + 引用其特定資產
      /我(用|選|挑|採用|參考)了?.*?(claude|notion|linear-?app|stripe|vercel|figma|miro|airtable|raycast|airbnb|shopify|spotify|meta|apple|cursor|supabase|sentry|posthog|framer|ollama|x-?ai|warm-?editorial)[^。\n]{0,30}(設計系統|design\s*system|風格|的)/i,
      // 提到讀了 DESIGN.md
      /\bDESIGN\.md\b/,
    ],
    medium: [
      /design-system-picker/i,
      /(從|挑|選).*23\s*套/,
      /依?(據|照).*?(設計系統|DESIGN\.md)/,
    ],
    weak: [
      /\b(linear|stripe|notion|vercel|airbnb|figma)\b.*?(風格|style|的)/i,
    ],
  },

  "awesome-doc-pptx": {
    strong: [
      /python-pptx|from\s+pptx|pptx\.Presentation|html2pptx/i,
    ],
    medium: [
      /(生成|產出|製作|create).*?\.pptx/i,
      /OOXML.*?pptx/i,
    ],
  },

  "awesome-doc-xlsx": {
    strong: [
      /openpyxl|xlsxwriter|workbook\.(save|write)|=SUM\(|=VLOOKUP\(/i,
    ],
    medium: [
      /(生成|產出|製作|create).*?\.xlsx/i,
    ],
  },

  "awesome-doc-docx": {
    strong: [
      /python-docx|docx-js|docx\.Document|tracked\s*changes/i,
    ],
    medium: [
      /(生成|產出|製作|create).*?\.docx/i,
    ],
  },

  "awesome-doc-pdf": {
    strong: [
      /PyMuPDF|\bfitz\b|pdfplumber|reportlab|PyPDF2/i,
    ],
    medium: [
      /(生成|產出|建立|create).*?\.pdf/i,
    ],
  },

  "awesome-canvas-design": {
    strong: [
      /from\s+PIL|Pillow|matplotlib\.pyplot|svgwrite/i,
    ],
    medium: [
      /(海報|藝術品|視覺設計).*(\.png|\.pdf)/i,
    ],
  },

  "awesome-mcp-builder": {
    strong: [
      /FastMCP|@modelcontextprotocol\/sdk|McpServer|@mcp\.tool/i,
    ],
    medium: [
      /MCP\s*server.*(構建|建立|實作)/i,
    ],
  },

  "awesome-changelog-generator": {
    strong: [
      /##\s*(✨|🔧|🐛)\s*(New Features|Improvements|Fixes|新功能|改進|修復)/i,
      /git log.*--pretty/,
    ],
    medium: [
      /changelog.*git\s+commit/i,
    ],
  },

  "awesome-theme-factory": {
    strong: [
      /(我|這|本).*(用|套用|採用).*(theme|主題).*(modern|minimal|playful|corporate|editorial|tech|vibrant|dark|light|warm)/i,
    ],
    medium: [
      /theme-factory/i,
    ],
  },
};

const ICONS = { strong: "✅", medium: "🟡", weak: "🟠", none: "❌" };
const LABELS = {
  strong: "明確使用",
  medium: "可能用過",
  weak: "弱訊號",
  none: "沒使用",
};

function detectSkill(text, skill, verbose = false) {
  const patterns = SKILL_PATTERNS[skill];
  if (!patterns) return { level: "unknown" };

  for (const level of ["strong", "medium", "weak"]) {
    for (const pattern of patterns[level] || []) {
      const m = text.match(pattern);
      if (m) {
        return {
          level,
          evidence: m[0].replace(/\s+/g, " ").slice(0, 100),
          patternIdx: (patterns[level] || []).indexOf(pattern),
        };
      }
    }
  }
  return { level: "none" };
}

function formatReport(results, expectedSkills, verbose) {
  console.log("\n========= Skill 使用驗證報告 =========\n");

  const skillsToReport = expectedSkills || Object.keys(SKILL_PATTERNS);
  let total = 0;
  let strong = 0;
  let any = 0;

  for (const skill of skillsToReport) {
    const r = results[skill];
    if (!r) {
      console.log(`  ⚠️  ${skill}: 不在 SKILL_PATTERNS 中,無法檢測`);
      continue;
    }
    total++;
    if (r.level === "strong") strong++;
    if (r.level !== "none") any++;

    const icon = ICONS[r.level];
    const label = LABELS[r.level];
    console.log(`  ${icon} ${skill.padEnd(35)} ${label}`);
    if (verbose && r.evidence) {
      console.log(`      └─ 證據: ${r.evidence}${r.evidence.length >= 100 ? "..." : ""}`);
    }
  }

  console.log("\n----------------------------------------");
  console.log(`  強訊號: ${strong}/${total}  (明確用了)`);
  console.log(`  任何訊號: ${any}/${total}  (可能用了)`);
  console.log(`  通過率: ${Math.round((strong / total) * 100)}%`);
  console.log("========================================\n");

  if (expectedSkills && strong < total) {
    const missing = expectedSkills.filter((s) => results[s]?.level !== "strong");
    console.log(`⚠️  以下 skill 沒看到「明確使用」標記:`);
    missing.forEach((s) => console.log(`     - ${s}`));
    console.log();
  }
}

async function fetchFromDashboard(sessionId) {
  const url = `http://localhost:5191/api/sessions/${sessionId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API 回 ${res.status}`);
    const data = await res.json();
    // 把所有訊息內容串起來(包含 user / assistant / tool 結果)
    const msgs = data.messages || data || [];
    if (Array.isArray(msgs)) {
      return msgs.map((m) => m.content || m.text || m.body || JSON.stringify(m)).join("\n\n");
    }
    return JSON.stringify(data);
  } catch (e) {
    throw new Error(`從 dashboard 撈 session 失敗: ${e.message}`);
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let expectedSkills = null;
  let sessionId = null;
  let filePath = null;
  let verbose = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--expected" || a === "-e") expectedSkills = args[++i].split(",").map((s) => s.trim());
    else if (a === "--session-id" || a === "-s") sessionId = args[++i];
    else if (a === "--verbose" || a === "-v") verbose = true;
    else if (a === "--help" || a === "-h") showHelp = true;
    else if (!a.startsWith("-")) filePath = a;
  }

  if (showHelp) {
    console.log(`用法:
  node validate-skill-usage.mjs <file>                       讀檔案
  cat output.txt | node validate-skill-usage.mjs             從 stdin
  node validate-skill-usage.mjs --session-id <id>            從 dashboard API

選項:
  --expected, -e   逗號分隔指定要檢查的 skill
  --verbose, -v    顯示每個命中的證據文字
  --help, -h       這份說明

支援的 skill: ${Object.keys(SKILL_PATTERNS).join(", ")}`);
    process.exit(0);
  }

  let text = "";
  try {
    if (sessionId) {
      console.log(`從 dashboard 撈 session ${sessionId}...`);
      text = await fetchFromDashboard(sessionId);
    } else if (filePath) {
      text = fs.readFileSync(filePath, "utf8");
    } else {
      text = await readStdin();
    }
  } catch (e) {
    console.error(`✗ 讀輸入失敗: ${e.message}`);
    process.exit(1);
  }

  if (!text.trim()) {
    console.error("✗ 沒輸入文字。用 --help 看用法。");
    process.exit(1);
  }

  // 對每個已知 skill 做偵測
  const results = {};
  for (const skill of Object.keys(SKILL_PATTERNS)) {
    results[skill] = detectSkill(text, skill, verbose);
  }

  formatReport(results, expectedSkills, verbose);

  // exit code:強訊號不齊 → 1
  if (expectedSkills) {
    const allStrong = expectedSkills.every((s) => results[s]?.level === "strong");
    process.exit(allStrong ? 0 : 1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
