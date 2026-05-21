/**
 * 能力學習 prompt 組裝 — 純函式，不依賴 DB / 子行程，方便單元測試。
 */

/** 類層學習：要 agent 以「領域總監」視角盤點該類別頂尖專家的核心能力。 */
export function buildCategoryLearningPrompt(categoryLabel: string): string {
  return `你是統籌「${categoryLabel}」整個部門全體專家的領域總監，見過這個領域最頂尖的人才。

# 任務
盤點：一個世界頂尖的「${categoryLabel}」專家，必須內化哪些**核心能力與專業判斷**？
寫出 5-8 條。每條是一句可直接內化、能指導實際工作的能力要點或專業心法，**不超過 200 字**，具體、可操作，不要空話套話。

# 輸出格式
每條能力用下面的標記包起來（kind 固定為 domain）：

=== LEARN kind=domain ===
能力要點內容
=== END LEARN ===

直接輸出 5-8 個這樣的標記區塊，不要前言、不要編號、不要額外解釋。`;
}

/** 個人層學習：在類共通能力之上，要 agent 盤點自己角色獨有的手藝。 */
export function buildAgentLearningPrompt(
  agentName: string,
  agentDescription: string,
  categoryMemory: string,
): string {
  const cat = (categoryMemory || "").trim();
  const catBlock = cat
    ? `\n# 你所屬領域的類共通能力（你已具備）\n${cat}\n`
    : "";
  const onTop = cat ? "在上述類共通能力之上" : "在你的專業角色基礎上";
  const avoid = cat ? "避免與上述類共通能力重複，" : "";
  return `你是「${agentName}」。${agentDescription}
${catBlock}
# 任務
${onTop}，作為更具體、更專精的「${agentName}」，你還需要哪些**獨有的**專業細節、手藝、判斷，才能比同領域的一般專家更強？
寫出 3-5 條。每條聚焦你這個角色**獨有**的東西，${avoid}**不超過 200 字**，具體可操作。

# 輸出格式
每條用下面的標記包起來（kind 固定為 craft）：

=== LEARN kind=craft ===
手藝要點內容
=== END LEARN ===

直接輸出 3-5 個這樣的標記區塊，不要前言、不要編號、不要額外解釋。`;
}
