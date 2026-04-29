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

// ASCII tech terms (use \b)
const CODEX_ASCII = [
  /\b(code|coding|debug|debugger)\b/i,
  /\b(python|javascript|typescript|java|golang|rust|cpp|bash|sql|html|css|tsx|jsx)\b/i,
  /\b(api|sdk|library|framework|webhook|endpoint)\b/i,
  /\b(github|git|repo|repository|commit|branch|merge|pull\s+request)\b/i,
  /\b(docker|kubernetes|k8s|terraform|deploy)\b/i,
  /\.(py|js|ts|tsx|jsx|java|go|rs|cpp|h|css|html|sql|sh|yml|yaml|json|toml|csv|xml)\b/i,
  /\b(stack\s*trace|exception|traceback)\b/i,
  /\b(unit\s*test|test\s*case)\b/i,
  /\b(npm|pip|cargo|yarn|pnpm)\b/i,
  /\b(localhost|127\.0\.0\.1|https?:\/\/[\w./?-]+)/i,
];

// Chinese tech terms (no \b; substring match)
const CODEX_CJK = [
  /程式/, /程式碼/, /代碼/, /偵錯/, /除錯/, /重構/,
  /套件/, /框架/, /單元測試/, /測試案例/, /錯誤訊息/,
];

// ASCII content terms
const CLAUDE_ASCII = [
  /\b(tone|copywriting|copy|narrative|brand|branding)\b/i,
  /\b(threads|instagram|tiktok|youtube|facebook|line)\b/i,
  /\b(marketing|seo|hashtag|caption)\b/i,
  /\b(policy|propose|proposal|invoice|quote|quoted)\b/i,
];

// Chinese content / business terms
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
];

function countHits(prompt: string, ascii: RegExp[], cjk: RegExp[]): number {
  let n = 0;
  for (const r of ascii) if (r.test(prompt)) n++;
  for (const r of cjk) if (r.test(prompt)) n++;
  return n;
}

function applyRules(prompt: string): RoutingDecision | null {
  const codexHits = countHits(prompt, CODEX_ASCII, CODEX_CJK);
  const claudeHits = countHits(prompt, CLAUDE_ASCII, CLAUDE_CJK);

  // strong dominance — even 1 unique hit can be enough if the other side is 0
  if (codexHits >= 1 && claudeHits === 0) {
    return {
      provider: "codex",
      reason: `規則命中:${codexHits} 個技術/程式關鍵字`,
      source: "rule",
      confidence: codexHits >= 2 ? 0.9 : 0.7,
    };
  }
  if (claudeHits >= 1 && codexHits === 0) {
    return {
      provider: "claude",
      reason: `規則命中:${claudeHits} 個內容/品牌關鍵字`,
      source: "rule",
      confidence: claudeHits >= 2 ? 0.9 : 0.7,
    };
  }
  // dominance with hits on both sides
  if (codexHits >= 2 && codexHits > claudeHits + 1) {
    return { provider: "codex", reason: `規則命中:${codexHits} 個技術關鍵字 vs ${claudeHits} 個內容關鍵字`, source: "rule", confidence: 0.85 };
  }
  if (claudeHits >= 2 && claudeHits > codexHits + 1) {
    return { provider: "claude", reason: `規則命中:${claudeHits} 個內容關鍵字 vs ${codexHits} 個技術關鍵字`, source: "rule", confidence: 0.85 };
  }
  // both 0 or roughly tied → ambiguous
  return null;
}

async function llmClassify(prompt: string): Promise<RoutingDecision> {
  return new Promise((resolve) => {
    // Mostly-English instruction so Windows codepage glitches can't garble
    // it; user prompt is interpolated as data and JSON-escaped (which makes
    // Chinese chars survive as \uXXXX).
    const ask = `Classify the following USER_QUERY between two LLMs:
- claude: best for Chinese long-form writing, brand/marketing copy, social posts, law/finance docs, taste judgment.
- codex: best for code generation, debugging, API integration, command-line tools, automation scripts.

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
    return { provider: "claude", reason: "Codex CLI 未安裝,只能用 Claude", source: "default" };
  }

  // cache check
  const cacheKey = prompt.slice(0, 200).toLowerCase().replace(/\s+/g, " ").trim();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.decision, source: "rule" };
  }

  // 1. rules
  const ruleDecision = applyRules(prompt);
  if (ruleDecision) {
    cache.set(cacheKey, { decision: ruleDecision, ts: Date.now() });
    return ruleDecision;
  }

  // 2. LLM fallback for ambiguous
  try {
    const llmDecision = await llmClassify(prompt);
    cache.set(cacheKey, { decision: llmDecision, ts: Date.now() });
    return llmDecision;
  } catch (e: any) {
    return {
      provider: defaultProvider,
      reason: `LLM 分類失敗(${e.message}),用預設 ${defaultProvider}`,
      source: "fallback",
    };
  }
}
