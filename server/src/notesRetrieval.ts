/**
 * Lightweight retrieval over workspace notes. Computes a relevance score
 * between the user's message and each note, returns top-K. Uses BM25-ish
 * scoring (term frequency × inverse document frequency) over Chinese-aware
 * character bigrams + English word tokens.
 *
 * Not as good as embeddings, but zero deps and works ok for personal-scale
 * note collections.
 */
import { listNotes, type Note } from "./store.js";

function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  // English/numeric words
  const words = t.match(/[a-z0-9_-]{2,}/g) || [];
  for (const w of words) out.push(w);
  // Chinese character bigrams (CJK ranges)
  const cjk = t.replace(/[^㐀-鿿]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    out.push(cjk[i] + cjk[i + 1]);
  }
  return out;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

interface Scored {
  note: Note;
  score: number;
  matchedTerms: string[];
}

export function findRelevantNotes(workspaceId: string, query: string, topK: number = 2): Note[] {
  const notes = listNotes(workspaceId);
  if (notes.length === 0) return [];
  const queryTokens = uniq(tokenize(query));
  if (queryTokens.length === 0) return [];

  // Build IDF per token across all notes
  const docs = notes.map((n) => tokenize((n.title + " " + n.body).toLowerCase()));
  const docFreq: Record<string, number> = {};
  for (const tok of queryTokens) {
    docFreq[tok] = docs.filter((d) => d.includes(tok)).length;
  }

  const scored: Scored[] = notes.map((note, i) => {
    const doc = docs[i];
    const tf: Record<string, number> = {};
    for (const t of doc) tf[t] = (tf[t] || 0) + 1;
    let score = 0;
    const matched: string[] = [];
    for (const qt of queryTokens) {
      if (tf[qt]) {
        const idf = Math.log(1 + (notes.length - docFreq[qt] + 0.5) / (docFreq[qt] + 0.5));
        score += idf * (tf[qt] / (tf[qt] + 1.5));
        matched.push(qt);
      }
    }
    // Pinned notes get a small boost
    if (note.pinned) score *= 1.3;
    return { note, score, matchedTerms: matched };
  });

  scored.sort((a, b) => b.score - a.score);

  // Filter out noise — require at least 2 matched terms OR a strong score
  const filtered = scored.filter((s) => s.matchedTerms.length >= 2 || s.score >= 1.5);
  return filtered.slice(0, topK).map((s) => s.note);
}

const NOTE_BODY_LIMIT = 1500;
const CONTEXT_TOTAL_LIMIT = 4000;
const TRUNCATE_SUFFIX = "…（已截斷，完整內容在研究成果庫）";

/**
 * 建 context 字串並回報「實際納入」的 note 清單。
 * 因總量上限（4000 字）可能把後段 note 整塊丟掉，呼叫端需要知道哪些真的進去了，
 * 才能只把納入的標記為已注入（避免被丟掉的 note 永遠不再重試注入）。
 */
export function buildNotesContext(notes: Note[]): { text: string; included: Note[] } {
  const parts: string[] = [];
  const included: Note[] = [];
  let totalLen = 0;
  for (const n of notes) {
    const body = n.body.length > NOTE_BODY_LIMIT
      ? n.body.slice(0, NOTE_BODY_LIMIT) + TRUNCATE_SUFFIX
      : n.body;
    const part = `<context source="筆記:${n.title}">\n${body}\n</context>`;
    if (totalLen + part.length > CONTEXT_TOTAL_LIMIT) break;
    parts.push(part);
    included.push(n);
    totalLen += part.length;
  }
  return { text: parts.join("\n\n"), included };
}

export function formatNotesAsContext(notes: Note[]): string {
  return buildNotesContext(notes).text;
}
