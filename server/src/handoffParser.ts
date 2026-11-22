// server/src/handoffParser.ts
/** 專案經理交接單：=== HANDOFF === … === END HANDOFF ===。多個取最後一個；以字元（code point）截斷。 */
export const HANDOFF_MAX = 2000;
const TRUNC_MARK = "…（已截斷）";
const RE = /=== HANDOFF ===\s*\n([\s\S]*?)\n=== END HANDOFF ===/g;

export function capHandoff(text: string): string {
  const chars = [...text.trim()];
  return chars.length > HANDOFF_MAX ? chars.slice(0, HANDOFF_MAX).join("") + TRUNC_MARK : chars.join("");
}

export function parseHandoff(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(RE)) last = m[1];
  if (last == null) return null;
  const body = last.trim();
  return body ? capHandoff(body) : null;
}
