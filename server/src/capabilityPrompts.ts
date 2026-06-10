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

/** 個人層學習：在類共通能力之上，要 agent 盤點自己角色獨有的手藝。
 *  agentBody 是該 agent .md 的完整人設正文（職責、風格、領域知識），
 *  比 description 那一行豐富，讓 Opus 有足夠素材寫出真正獨門的手藝。
 *  早期版本只給 description，導致窄領域 agent（如嵌入式韌體、Solidity）
 *  寫不出 LEARN 標記。 */
export function buildAgentLearningPrompt(
  agentName: string,
  agentDescription: string,
  categoryMemory: string,
  agentBody?: string,
): string {
  const cat = (categoryMemory || "").trim();
  const body = (agentBody || "").trim();
  const bodyBlock = body
    ? `\n# 你的完整角色設定（人設、職責、工作風格、領域知識）\n${body}\n`
    : "";
  const catBlock = cat
    ? `\n# 你所屬領域的類共通能力（你已具備）\n${cat}\n`
    : "";
  const onTop = cat ? "在上述類共通能力之上" : "在你的專業角色基礎上";
  const avoid = cat ? "避免與上述類共通能力重複，" : "";
  return `你是「${agentName}」。${agentDescription}
${bodyBlock}${catBlock}
# 任務
${onTop}，作為更具體、更專精的「${agentName}」，你還需要哪些**獨有的**專業細節、手藝、判斷，才能比同領域的一般專家更強？從你的人設與領域中提煉**具體可操作**的工作心法、判斷準則、踩坑經驗。
寫出 3-5 條。每條聚焦你這個角色**獨有**的東西，${avoid}**不超過 200 字**，具體可操作（最好帶數字門檻、判準、或一句話的決策樹）。

# 輸出格式
每條用下面的標記包起來（kind 固定為 craft）：

=== LEARN kind=craft ===
手藝要點內容
=== END LEARN ===

直接輸出 3-5 個這樣的標記區塊，不要前言、不要編號、不要額外解釋。`;
}

/** 自主進修：用 WebSearch 研究最新業界知識，對照現有手藝找缺口。
 *  agentBody       — agent .md 人設正文（可選）
 *  existingCraft   — 該 agent 目前已學到的手藝記憶（可選，避免重複）
 *  categoryMemory  — 類共通能力記憶（可選）
 */
export function buildAgentResearchPrompt(
  agentName: string,
  agentDescription: string,
  agentBody: string | undefined,
  existingCraft: string | undefined,
  categoryMemory: string | undefined,
): string {
  const body = (agentBody || "").trim();
  const craft = (existingCraft || "").trim();
  const cat = (categoryMemory || "").trim();
  const bodyBlock = body ? `\n# 你的角色設定\n${body}\n` : "";
  const craftBlock = craft ? `\n# 你目前已有的手藝（避免重複，要在此之上找更新/更缺的）\n${craft}\n` : "";
  const catBlock = cat ? `\n# 類共通能力（已具備）\n${cat}\n` : "";
  return `你是「${agentName}」。${agentDescription}
${bodyBlock}${craftBlock}${catBlock}
# 任務
用 **WebSearch** 工具研究你這個專業領域**當前年度最新**的最佳實踐、工具、平台規則與趨勢（必要時用 WebFetch 讀來源）。對照你目前的手藝與人設，找出：①已**過時／需更新**的做法 ②你還**缺**的新能力。只收**具體可操作**（帶數字門檻／判準／一句話決策樹）、且**有來源依據**的要點；避免通用空話，也避免與你現有手藝重複。
若你是文案／內容類角色，至少要有一條「如何降低 AI 味（anti-AI-slop）」的具體手法。

# 輸出格式（嚴格遵守，不要前言/編號/額外解釋）
先輸出 3-6 個手藝（每條 ≤500 字）：
=== LEARN kind=craft ===
最新手藝要點（具體、可操作、最好帶來源年份）
=== END LEARN ===

最後輸出一份能力現況報告：
=== REPORT ===
目前已具備：…
業界最新：…
你的缺口：…
來源： <把你引用的 URL 列在這行，用空白分隔>
=== END REPORT ===`;
}

export interface ParsedReport { report: string; sources: string[]; }

/** 從 LLM 回應中擷取 REPORT 區塊與來源 URL。無 REPORT 時回傳 null。 */
export function parseCapabilityReport(text: string): ParsedReport | null {
  const m = text.match(/===\s*REPORT\s*===[ \t]*\r?\n([\s\S]*?)\r?\n===\s*END\s*REPORT\s*===/i);
  if (!m) return null;
  const report = m[1].trim();
  if (!report) return null;
  const sources = Array.from(report.matchAll(/https?:\/\/[^\s)]+/g)).map((u) => u[0]);
  return { report, sources: [...new Set(sources)] };
}
