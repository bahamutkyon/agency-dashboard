/**
 * Smart Router — decides which provider should handle a given prompt.
 *
 * Strategy: **rules first, LLM fallback for ambiguous cases**.
 *
 *   1. Apply heuristic rules (keyword/regex matching). 80%+ of prompts hit
 *      a clear rule and decide instantly with zero cost.
 *   2. If no rule strongly matches, ask Claude Haiku to classify. Cost is
 *      ~$0.001 per ambiguous decision; result is cached so similar prompts
 *      reuse the answer for 24 hours.
 *
 * Output includes a `reason` field that the UI surfaces so users can see
 * *why* a particular provider was picked.
 */
import { spawnClaude } from "./claudeProcess.js";
import type { Provider } from "./store.js";
import { isCodexAvailable } from "./codexProcess.js";
import { isGeminiAvailable } from "./geminiProcess.js";

export interface RoutingDecision {
  provider: Provider;
  reason: string;
  source: "rule" | "llm" | "default" | "fallback";
  confidence?: number; // 0-1
}

interface CachedDecision {
  decision: RoutingDecision;
  ts: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, CachedDecision>();

// `\b` only matches between \w and \W. CJK chars are \W, so word boundaries
// don't work for Chinese terms. We split: ASCII patterns use \b, CJK
// patterns are plain substring matches (case-insensitive).

// === HONEST ROUTING RULES ===
// Claude (Sonnet/Opus 4.x) is competitive with or beats Codex on most coding
// benchmarks (SWE-bench, HumanEval). Plus its 1M context, better Chinese,
// and more generous Max-plan quota make it the right DEFAULT for almost
// everything. Codex is a niche backup, not "the code provider".
//
// We only route to Codex when the user is doing something where Codex's
// specific operational features matter:
//   - Heavy autonomous shell execution (Codex's sandbox is more mature)
//   - User explicitly mentions "用 codex / openai / gpt"
//   - Specific OpenAI-only tool integrations
// Otherwise → Claude.

// User-explicit Codex preference
const EXPLICIT_CODEX_ASCII = [
  /\b(use\s+codex|via\s+codex|with\s+codex|in\s+codex|codex\s+please)\b/i,
  /\b(use\s+gpt[-\s]?5|via\s+openai|with\s+gpt|gpt-?5\s+please)\b/i,
];
const EXPLICIT_CODEX_CJK = [
  /用\s*codex/i, /用\s*gpt/i, /用\s*openai/i,
  /(交給|請|給)\s*codex/i, /(交給|請|給)\s*gpt/i,
];

// User-explicit Gemini preference
const EXPLICIT_GEMINI_ASCII = [
  /\b(use\s+gemini|via\s+gemini|with\s+gemini|gemini\s+please)\b/i,
  /\b(use\s+google\s+ai|via\s+google\s+ai)\b/i,
];
const EXPLICIT_GEMINI_CJK = [
  /用\s*gemini/i, /用\s*google\s*ai/i,
  /(交給|請|給)\s*gemini/i,
];

// Sandbox / execution-heavy work (Codex's strength)
const CODEX_NICHE_ASCII = [
  /\b(execute|run\s+(this|the)\s+(script|command))\b/i,
  /\b(sandbox|安全執行)\b/i,
];
const CODEX_NICHE_CJK = [
  /用沙盒/, /沙盒裡跑/, /放沙盒/, /讓\s*codex/, /要\s*codex/,
];

// Strong Claude-preferred indicators (everything content / business / Chinese)
const CLAUDE_ASCII = [
  /\b(tone|copywriting|copy|narrative|brand|branding)\b/i,
  /\b(threads|instagram|tiktok|youtube|facebook|line)\b/i,
  /\b(marketing|seo|hashtag|caption)\b/i,
  /\b(policy|propose|proposal|invoice|quote|quoted)\b/i,
  /\b(refactor|debug|architecture|review|test)\b/i, // Claude is great at these too
];
const CLAUDE_CJK = [
  /貼文/, /文案/, /內容創作/, /內容寫作/, /品牌/, /語氣/,
  /小紅書/, /微博/, /抖音/, /快手/, /微信/, /公眾號/, /視頻號/,
  /腳本/, /劇本/, /敘事/, /故事/, /主視覺/, /海報/, /宣傳/,
  /行銷/, /營銷/, /推廣/,
  /法律/, /法務/, /合約/, /合規/, /規範/,
  /財務/, /報價/, /預算/, /提案/,
  /繁體/, /繁中/, /中文/, /台灣/, /香港/,
  /客戶/, /客人/, /顧客/,
  /審稿/, /審核/, /審查/,
  /程式/, /程式碼/, /代碼/, /偵錯/, /除錯/, /重構/,  // Claude handles code well too
];

function countHits(prompt: string, ascii: RegExp[], cjk: RegExp[]): number {
  let n = 0;
  for (const r of ascii) if (r.test(prompt)) n++;
  for (const r of cjk) if (r.test(prompt)) n++;
  return n;
}

function applyRules(prompt: string): RoutingDecision | null {
  // 1a. User explicitly asks for Gemini — highest priority
  const explicitGemini = countHits(prompt, EXPLICIT_GEMINI_ASCII, EXPLICIT_GEMINI_CJK);
  if (explicitGemini > 0 && isGeminiAvailable()) {
    return {
      provider: "gemini",
      reason: "使用者明確指定 Gemini / Google AI",
      source: "rule",
      confidence: 1.0,
    };
  }

  // 1b. User explicitly asks for Codex / GPT
  const explicitCodex = countHits(prompt, EXPLICIT_CODEX_ASCII, EXPLICIT_CODEX_CJK);
  if (explicitCodex > 0 && isCodexAvailable()) {
    return {
      provider: "codex",
      reason: "使用者明確指定 Codex / GPT",
      source: "rule",
      confidence: 1.0,
    };
  }

  // 2. Sandbox / execution-heavy task — Codex's niche
  const codexNiche = countHits(prompt, CODEX_NICHE_ASCII, CODEX_NICHE_CJK);
  if (codexNiche > 0 && isCodexAvailable()) {
    return {
      provider: "codex",
      reason: "需要沙盒執行 / Codex 特長領域",
      source: "rule",
      confidence: 0.8,
    };
  }

  // 3. Anything else with content/Chinese signal → Claude (and Claude is also
  //    strong at code, so we don't fight it)
  const claudeHits = countHits(prompt, CLAUDE_ASCII, CLAUDE_CJK);
  if (claudeHits >= 1) {
    return {
      provider: "claude",
      reason: claudeHits >= 2
        ? `規則命中:${claudeHits} 個 Claude 強項關鍵字`
        : `Claude 預設(命中關鍵字)`,
      source: "rule",
      confidence: claudeHits >= 2 ? 0.9 : 0.75,
    };
  }

  // 4. Nothing matched → ambiguous, let LLM decide
  return null;
}

async function llmClassify(prompt: string): Promise<RoutingDecision> {
  return new Promise((resolve) => {
    // Bias toward Claude unless there's a *specific* reason to pick Codex.
    // Both models handle code well; this prompt guides the classifier to
    // honestly pick Codex only for niche cases.
    const ask = `Decide which LLM should handle USER_QUERY. Default is "claude".

DEFAULT (claude — pick this unless USER_QUERY specifically benefits from Codex):
- All writing tasks (Chinese long-form, marketing copy, social posts, brand/legal/finance docs)
- All general code work (Claude is competitive with or beats Codex on most coding benchmarks)
- Research, taste judgment, multi-step reasoning, anything ambiguous

PICK CODEX only if USER_QUERY:
- Requires autonomous shell execution in a sandbox (Codex's exec sandbox is more mature)
- Explicitly asks for Codex / GPT / OpenAI by name
- Needs an OpenAI-specific tool that Claude lacks

USER_QUERY:
${prompt.slice(0, 800)}

Respond with JSON only (no commentary):
{"provider": "claude" | "codex", "reason": "<= 30 chars Traditional Chinese reason"}`;

    // Use stream-json input format — Chinese text inside JSON strings
    // survives Windows codepage mangling that breaks plain text/arg input.
    const child = spawnClaude([
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--model", "haiku",
      "--verbose",
    ]);
    let out = "";
    let err = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (d) => { out += String(d); });
    child.stderr!.on("data", (d) => { err += String(d); });
    // Build stream-json user message. Force ASCII-only escaping so Windows
    // codepage (Big5/CP950 default in zh-TW) can't mangle CJK in the pipe.
    const raw = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: ask }] },
    });
    const ascii = raw.replace(/[-￿]/g, (c) =>
      "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
    );
    child.stdin!.write(ascii + "\n");
    child.stdin!.end();
    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      console.warn(`[smartRouter] LLM classify timeout. stderr: ${err.slice(0, 200)}`);
      resolve({ provider: "claude", reason: "LLM 分類超時,預設使用 Claude", source: "fallback" });
    }, 20000);
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        // stream-json output: each line is an event; we want the final
        // assistant message text
        let assistantText = "";
        for (const line of out.split("\n")) {
          const tt = line.trim();
          if (!tt) continue;
          try {
            const evt = JSON.parse(tt);
            if (evt.type === "assistant" && evt.message?.content) {
              for (const c of evt.message.content) {
                if (c.type === "text") assistantText += c.text;
              }
            } else if (evt.type === "result" && evt.result) {
              if (!assistantText) assistantText = String(evt.result);
            }
          } catch {}
        }
        const m = assistantText.match(/\{[\s\S]*?"provider"[\s\S]*?\}/);
        if (m) {
          const decision = JSON.parse(m[0]);
          if (decision.provider === "claude" || decision.provider === "codex") {
            resolve({
              provider: decision.provider,
              reason: decision.reason || "LLM 判斷",
              source: "llm",
              confidence: 0.75,
            });
            return;
          }
        }
      } catch (e) { /* fall through */ }
      console.warn(`[smartRouter] LLM parse failed. assistant text extracted: "${out.split("\n").map(l => { try { return JSON.parse(l)?.message?.content?.[0]?.text || ""; } catch { return ""; } }).filter(Boolean).join(" | ").slice(0, 400)}"`);
      resolve({ provider: "claude", reason: "LLM 解析失敗,預設使用 Claude", source: "fallback" });
    });
  });
}

export async function routePrompt(prompt: string, defaultProvider: Provider = "claude"): Promise<RoutingDecision> {
  // If codex isn't available, always use claude
  if (!isCodexAvailable()) {
    return { provider: "claude", reason: "Codex 未安裝,使用 Claude", source: "default" };
  }

  // cache check
  const cacheKey = prompt.slice(0, 200).toLowerCase().replace(/\s+/g, " ").trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.decision };
  }

  // 1. rules — these now bias heavily toward Claude
  const ruleDecision = applyRules(prompt);
  if (ruleDecision) {
    cache.set(cacheKey, { decision: ruleDecision, ts: Date.now() });
    return ruleDecision;
  }

  // 2. Nothing matched → don't even bother LLM, just default to Claude.
  //    LLM classification only runs if user really needs more nuance — but
  //    given Claude is the right default for almost everything, we save the
  //    cost / latency and just return Claude here.
  //    (Use LLM fallback only for highly ambiguous cases — heuristic: prompt
  //    has no Chinese AND no English → fall through to LLM)
  const hasCJK = /[一-鿿]/.test(prompt);
  const hasEnglish = /[a-zA-Z]{4,}/.test(prompt);
  if (hasCJK || hasEnglish) {
    const decision: RoutingDecision = {
      provider: "claude",
      reason: "預設 Claude(無特殊 Codex 觸發訊號)",
      source: "default",
      confidence: 0.7,
    };
    cache.set(cacheKey, { decision, ts: Date.now() });
    return decision;
  }

  // 3. Truly ambiguous (no recognizable language) → LLM fallback
  try {
    const llmDecision = await llmClassify(prompt);
    cache.set(cacheKey, { decision: llmDecision, ts: Date.now() });
    return llmDecision;
  } catch (e: any) {
    return {
      provider: defaultProvider,
      reason: `LLM 分類失敗,使用預設 ${defaultProvider}`,
      source: "fallback",
    };
  }
}
