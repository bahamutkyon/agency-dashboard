// server/src/handoffParser.ts
/** 專案經理交接單：=== HANDOFF === … === END HANDOFF ===。多個取最後一個；以字元（code point）截斷。 */
export const HANDOFF_MAX = 2000;
const TRUNC_MARK = "…（已截斷）";
const RE = /=== HANDOFF ===\s*\n([\s\S]*?)\n=== END HANDOFF ===/g;

/**
 * PM 手冊（routes/sessions.ts buildHandoffGuide）範本裡各欄位的佔位說明。
 * 區塊含 ≥2 個佔位說明＝PM 在示範格式（例如使用者問「交接單長什麼樣」），不是真交接。
 * 改手冊範本時要同步這裡（app.test.ts 有守護：手冊必須含全部佔位說明）。
 */
export const HANDOFF_TEMPLATE_HINTS = [
  "這場要達成什麼",
  "談定、不要再重問的事",
  "交辦了一半的工作、等誰回報",
  "接手後第一件要做的事",
  "需要使用者決定的事",
  "數字、連結、檔案路徑",
];

/** 範本示範或空骨架（每行都只有「欄位：」沒有內容）→ 不算交接。 */
function isTemplate(body: string): boolean {
  if (HANDOFF_TEMPLATE_HINTS.filter((h) => body.includes(h)).length >= 2) return true;
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => /[：:]$/.test(l));
}

export function capHandoff(text: string): string {
  const chars = [...text.trim()];
  return chars.length > HANDOFF_MAX ? chars.slice(0, HANDOFF_MAX).join("") + TRUNC_MARK : chars.join("");
}

export function parseHandoff(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(RE)) {
    const body = m[1].trim();
    if (body && !isTemplate(body)) last = body;
  }
  return last == null ? null : capHandoff(last);
}
