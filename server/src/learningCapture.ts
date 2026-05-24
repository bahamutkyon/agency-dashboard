/**
 * 學習擷取 — 從 agent 回應文字解析 LEARN / REMEMBER 標記，轉成學習提案草稿。
 * 純函式，不依賴 DB，方便單元測試。
 */

export type LearnKind = "fact" | "craft" | "domain" | "calibration";
export type LearnScope = "workspace" | "agent-global" | "category";

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
 * 略過空內容與超過 maxLen 字的內容；單次最多回傳 maxDrafts 條（LEARN + REMEMBER 合計）。
 * 預設 maxDrafts=5、maxLen=200（Phase 1 對話內 LEARN 標記用）；
 * 能力學習場景傳 maxDrafts=8、maxLen=500（產出條目較長、較詳細）。
 * LEARN 先解析、REMEMBER 後解析，超出上限時後者先被裁掉。
 */
export function parseLearnMarkers(
  text: string,
  maxDrafts: number = MAX_DRAFTS,
  maxLen: number = MAX_CONTENT_LEN,
): LearnDraft[] {
  const out: LearnDraft[] = [];

  const learnRe = /===\s*LEARN\s+kind=(\w+)\s*===[ \t]*\r?\n([\s\S]*?)\r?\n===\s*END\s*LEARN\s*===/gi;
  let m: RegExpExecArray | null;
  while ((m = learnRe.exec(text)) !== null) {
    const content = m[2].trim();
    if (content.startsWith("===")) {
      // Nested marker: reset lastIndex to just after the opening tag so
      // the inner block can be discovered in the next iteration.
      learnRe.lastIndex = m.index + m[0].indexOf("\n") + 1;
      continue;
    }
    if (!content || content.length > maxLen) continue;
    const rawKind = m[1].toLowerCase();
    const kind = (VALID_KINDS as string[]).includes(rawKind) ? (rawKind as LearnKind) : "fact";
    out.push({ kind, scope: deriveScope(kind), content });
  }

  const rememberRe = /===\s*REMEMBER\s*===[ \t]*\r?\n([\s\S]*?)\r?\n===\s*END\s*REMEMBER\s*===/gi;
  let r: RegExpExecArray | null;
  while ((r = rememberRe.exec(text)) !== null) {
    const content = r[1].trim();
    if (content.startsWith("===")) {
      rememberRe.lastIndex = r.index + r[0].indexOf("\n") + 1;
      continue;
    }
    if (!content || content.length > maxLen) continue;
    out.push({ kind: "fact", scope: "workspace", content });
  }

  return out.slice(0, maxDrafts);
}

/** 從字串產生字元 bigram 集合；長度 1 時退回單字元集合。 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length === 1) { set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * 粗略相似度 — 字元 bigram 的 Jaccard 係數，回傳 0~1。用於提案去重。
 */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const A = norm(a), B = norm(b);
  if (A === B) return 1;
  if (!A || !B) return 0;
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
