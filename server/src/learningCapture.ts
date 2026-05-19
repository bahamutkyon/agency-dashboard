/**
 * 學習擷取 — 從 agent 回應文字解析 LEARN / REMEMBER 標記，轉成學習提案草稿。
 * 純函式，不依賴 DB，方便單元測試。
 */

export type LearnKind = "fact" | "craft" | "domain" | "calibration";
export type LearnScope = "workspace" | "agent-global";

export interface LearnDraft {
  kind: LearnKind;
  scope: LearnScope;
  content: string;
}

const VALID_KINDS: LearnKind[] = ["fact", "craft", "domain", "calibration"];
const MAX_CONTENT_LEN = 200;
const MAX_DRAFTS = 5;

/** kind → scope：fact/calibration 鎖工作區；craft/domain 跟 agent 全域。 */
export function deriveScope(kind: LearnKind): LearnScope {
  return kind === "craft" || kind === "domain" ? "agent-global" : "workspace";
}

/**
 * 解析文字中所有 LEARN 與 REMEMBER 標記。
 *  - === LEARN kind=craft === ... === END LEARN ===
 *  - === REMEMBER === ... === END REMEMBER ===（視為 kind=fact）
 * 略過空內容與超過 200 字的內容；單次最多回傳 5 條。
 */
export function parseLearnMarkers(text: string): LearnDraft[] {
  const out: LearnDraft[] = [];

  const learnRe = /===\s*LEARN\s+kind=(\w+)\s*===\s*\n([\s\S]*?)\n===\s*END\s*LEARN\s*===/gi;
  for (const m of text.matchAll(learnRe)) {
    const content = m[2].trim();
    if (!content || content.length > MAX_CONTENT_LEN) continue;
    const rawKind = m[1].toLowerCase();
    const kind = (VALID_KINDS as string[]).includes(rawKind) ? (rawKind as LearnKind) : "fact";
    out.push({ kind, scope: deriveScope(kind), content });
  }

  const rememberRe = /===\s*REMEMBER\s*===\s*\n([\s\S]*?)\n===\s*END\s*REMEMBER\s*===/gi;
  for (const m of text.matchAll(rememberRe)) {
    const content = m[1].trim();
    if (!content || content.length > MAX_CONTENT_LEN) continue;
    out.push({ kind: "fact", scope: "workspace", content });
  }

  return out.slice(0, MAX_DRAFTS);
}

/**
 * 粗略相似度 — 字元 bigram 的 Jaccard 係數，回傳 0~1。用於提案去重。
 */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const A = norm(a), B = norm(b);
  if (A === B) return 1;
  if (!A || !B) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    if (s.length === 1) { set.add(s); return set; }
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = bigrams(A), sb = bigrams(B);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 內容與既有清單任一條相似度 ≥ 0.7 即視為重複。 */
export function isDuplicate(content: string, existing: string[]): boolean {
  return existing.some((e) => similarity(content, e) >= 0.7);
}
