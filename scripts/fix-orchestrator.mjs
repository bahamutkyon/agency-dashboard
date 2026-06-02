/**
 * 手動修復 agents-orchestrator 的 craft memory：
 * 移除「（例如金田式 DAC 那篇）」這段具體 audio 品牌名提及，
 * 保留通用教訓「驗證每篇文章的真實作者」。
 */
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("server/data/store.db");

const row = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id='agents-orchestrator' AND scope='global'").get();
if (!row) { console.log("找不到條目"); process.exit(1); }

const before = row.content;
console.log("=== 修改前 ===");
console.log(before);
console.log("\n字數:", before.length);

// 修改：把含具體品牌名的整句改寫為通用版
// 原文: "...不能把搜尋結果頁面同時出現的其他作者作品（例如金田式 DAC 那篇）誤掛到使用者頭上——文章歸屬錯一次就會讓使用者對整份分析失去信任。"
// 改為: "...不能把搜尋結果頁面同時出現的其他作者作品誤掛到使用者頭上——文章歸屬錯一次就會讓使用者對整份分析失去信任。"
const after = before.replace(
  /，不能把搜尋結果頁面同時出現的其他作者作品（[^）]*）誤掛/,
  "，不能把搜尋結果頁面同時出現的其他作者作品誤掛"
);

if (after === before) {
  console.log("\n⚠️ 沒匹配到要改的字串，請檢查正則");
  process.exit(2);
}

console.log("\n=== 修改後（diff 摘要）===");
const diffStart = Math.max(0, before.search(/不能把搜尋結果頁面/) - 30);
const diffEnd = before.search(/誤掛/) + 50;
console.log("原文片段:", before.slice(diffStart, diffEnd));
console.log("新文片段:", after.slice(diffStart, diffEnd));
console.log("\n字數變化:", before.length, "→", after.length, `(${after.length - before.length})`);

// 透過 API PUT 寫回（dashboard 運行中）
const r = await fetch("http://127.0.0.1:5191/api/learning/craft/agents-orchestrator", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ content: after, scope: "global" }),
});

if (!r.ok) {
  console.error("PUT 失敗:", await r.text());
  process.exit(3);
}
console.log("\n✅ 已透過 API 寫回 DB");

// 二次驗證
const after2 = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id='agents-orchestrator' AND scope='global'").get();
const stillHas = after2.content.includes("金田式");
console.log("\n=== 驗證 ===");
console.log("DB 內容是否還含「金田式」:", stillHas ? "❌ 仍存在" : "✅ 已清除");
console.log("新內容字數:", after2.content.length);
