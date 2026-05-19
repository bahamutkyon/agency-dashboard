/**
 * 學習回灌 — 把 agent 手藝記憶組成 system prompt 注入塊。
 * 工作區客戶檔案沿用 agentManager 既有的 workspace.memory 注入，此處不重複。
 */

export function buildCraftMemoryBlock(craftContent: string): string {
  const c = (craftContent || "").trim();
  if (!c) return "";
  return `\n\n# 你累積的手藝與領域知識
以下是你過去執行任務時提煉、並經使用者批准的工作經驗與領域動態。請當成你的專業底牌，主動運用：

${c}
`;
}
