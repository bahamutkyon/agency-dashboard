/**
 * 學習回灌 — 把類層能力記憶 + 個人手藝記憶組成 system prompt 注入塊。
 * 工作區客戶檔案沿用 agentManager 既有的 workspace.memory 注入，此處不重複。
 *
 * v2 之後支援 scope 分節：
 *   - 全域（cross-workspace 通用方法論）
 *   - 本工作區（workspace-only 專屬經驗）
 *   - legacy-global（遷移前累積，待重審——仍當全域用但加標籤提醒）
 */

import type { CategoryMemoryBundle, CraftMemoryBundle } from "./learningStore.js";

/** @deprecated 舊 API。新呼叫者請用 buildCapabilityBlockFor。 */
export function buildCapabilityBlock(categoryContent: string, craftContent: string): string {
  const cat = (categoryContent || "").trim();
  const craft = (craftContent || "").trim();
  let out = "";
  if (cat) {
    out += `\n\n# 你所屬領域的類共通能力
以下是你這個專業領域頂尖專家共通的核心能力與判斷，經使用者批准。請當成你的專業底盤：

${cat}
`;
  }
  if (craft) {
    out += `\n\n# 你累積的個人手藝與領域知識
以下是你過去執行任務時提煉、並經使用者批准的個人專業經驗。請當成你的獨門底牌，主動運用：

${craft}
`;
  }
  return out;
}

/**
 * v2：依 scope 分節組成注入塊。
 *
 * 注入結構：
 *   [類層能力 - 全域]   ← 跨工作區、所有同類 agent 共享
 *   [類層能力 - 本工作區] ← 該工作區累積（少見）
 *   [類層能力 - legacy] ← 遷移前累積（標記待重審）
 *   [個人手藝 - 全域]
 *   [個人手藝 - 本工作區] ← 該工作區與該 agent 的合作累積
 *   [個人手藝 - legacy]
 */
export function buildCapabilityBlockFor(
  category: CategoryMemoryBundle,
  craft: CraftMemoryBundle,
): string {
  let out = "";

  // 類層能力
  const catParts: string[] = [];
  if (category.global.trim()) {
    catParts.push(`## 通用（跨工作區共享的方法論）\n${category.global.trim()}`);
  }
  if (category.workspace.trim()) {
    catParts.push(`## 本工作區專屬\n${category.workspace.trim()}`);
  }
  if (category.legacyGlobal.trim()) {
    catParts.push(`## ⚠️ legacy（遷移前累積，使用者待重審）\n${category.legacyGlobal.trim()}`);
  }
  if (catParts.length) {
    out += `\n\n# 你所屬領域的類共通能力
以下是你這個專業領域頂尖專家共通的核心能力與判斷，經使用者批准。請當成你的專業底盤：

${catParts.join("\n\n")}
`;
  }

  // 個人手藝
  const craftParts: string[] = [];
  if (craft.global.trim()) {
    craftParts.push(`## 通用（跨工作區共享的方法論）\n${craft.global.trim()}`);
  }
  if (craft.workspace.trim()) {
    craftParts.push(`## 本工作區專屬（與此使用者在此工作區的合作累積）\n${craft.workspace.trim()}`);
  }
  if (craft.legacyGlobal.trim()) {
    craftParts.push(`## ⚠️ legacy（遷移前累積，使用者待重審）\n${craft.legacyGlobal.trim()}`);
  }
  if (craftParts.length) {
    out += `\n\n# 你累積的個人手藝與領域知識
以下是你過去執行任務時提煉、並經使用者批准的個人專業經驗。請當成你的獨門底牌，主動運用：

${craftParts.join("\n\n")}
`;
  }

  return out;
}
