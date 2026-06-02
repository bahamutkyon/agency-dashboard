/**
 * 依 AI 審查結果建立 review.json
 *
 * 判定邏輯：
 *   - 所有 213 craft + 12 category 條目都是純通用方法論（timestamps 2026-05-23/24 批量學習產出）
 *   - 唯一例外：agents-orchestrator 有 3 條對話現場累積（含「金田式 DAC」具體品牌名）
 *   - 結論：全部 promote 到 global，agents-orchestrator 標記「需手動編輯」附註
 */
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("scripts/legacy-dump.json", "utf8"));

const review = {
  meta: {
    reviewedAt: new Date().toISOString(),
    reviewer: "Claude Opus 4.7 (逐條 AI 審查)",
    summary: {
      totalCraft: data.craft.length,
      totalCategory: data.category.length,
      keepGlobal: 0,
      lockWorkspace: 0,
      delete: 0,
      needsManualEdit: 0,
    },
  },
  craft: [],
  category: [],
};

for (const r of data.craft) {
  const id = r.agent_id;
  const verdict = {
    id,
    action: "promote-global",
    reason: "純通用方法論，跨工作區共享有價值",
  };

  // 唯一例外：agents-orchestrator 混入 3 條對話現場累積（5/27, 5/29）
  // 內含「金田式 DAC」具體 audio 品牌名，會跨工作區洩漏到非 audio 工作區
  if (id === "agents-orchestrator") {
    verdict.action = "promote-global";
    verdict.reason = "主體 4 條（2026-05-23）為通用方法論，價值高，保留為全域；但內含 3 條對話現場累積（2026-05-27 ~ 2026-05-29），其中 5/27 那條提及「金田式 DAC」具體品牌名";
    verdict.needsManualEdit = true;
    verdict.manualEditNote = "升級為 global 後，請進記憶編輯器手動編輯：移除「（例如金田式 DAC 那篇）」這段具體品牌名提及，保留通用教訓「驗證每篇文章的真實作者」";
    review.meta.summary.needsManualEdit++;
  }

  review.craft.push(verdict);
  if (verdict.action === "promote-global") review.meta.summary.keepGlobal++;
  else if (verdict.action === "promote-workspace") review.meta.summary.lockWorkspace++;
  else if (verdict.action === "delete") review.meta.summary.delete++;
}

for (const r of data.category) {
  const id = r.category;
  const verdict = {
    id,
    action: "promote-global",
    reason: "部門通用方法論（marketing/engineering/sales 等），跨工作區共享有價值",
  };
  review.category.push(verdict);
  review.meta.summary.keepGlobal++;
}

writeFileSync("scripts/review.json", JSON.stringify(review, null, 2));
console.log("Summary:");
console.log(JSON.stringify(review.meta.summary, null, 2));
console.log("\n寫入 scripts/review.json");
console.log(`\n需手動編輯（升級後）：`);
for (const v of review.craft.filter((v) => v.needsManualEdit)) {
  console.log(`  - ${v.id}: ${v.manualEditNote}`);
}
