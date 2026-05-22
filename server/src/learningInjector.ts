/**
 * 學習回灌 — 把類層能力記憶 + 個人手藝記憶組成 system prompt 注入塊。
 * 工作區客戶檔案沿用 agentManager 既有的 workspace.memory 注入，此處不重複。
 */

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
