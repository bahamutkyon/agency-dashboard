/**
 * 使用者主題研究 harness —— 把「幫我研究 X」升級成有方法論的多階段深研。
 *
 * 三階段 orchestration：
 *   1. 規劃：一次 LLM 呼叫把 question 拆成 3-6 個可獨立查證的子問題（JSON 陣列）。
 *      解析失敗 → 回退用原問題當單一子問題。
 *   2. 並行研究：每個子問題 spawn 一次帶 WebSearch/WebFetch 的 claude（比照
 *      capabilityLearning.runResearchTarget），要求多來源查、回結構化發現 + 來源 URL +
 *      信心標註。用 mapWithConcurrency 限流並行；單項失敗/逾時不拖垮整批（回部分結果）。
 *   3. 綜合：一次 LLM 呼叫把所有子題發現綜合成結構化結論、對撞矛盾、標信心、彙整所有來源。
 *
 * 最後把綜合結論存進研究成果庫（saveResearchNote，帶正確 workspaceId，進 BM25 檢索庫）。
 *
 * 每階段的 LLM 呼叫函式可注入（deps），讓測試用 fake 驗證整條 orchestration，不打真 LLM。
 * 預設實作走一次性 claude spawn（包 withBackgroundSlot 進全域背景限流）。
 */
import { mapWithConcurrency } from "./dispatchRunner.js";
import { withBackgroundSlot } from "./backgroundLimiter.js";
import { runClaudeOneShot } from "./claudeOneShot.js";
import { saveResearchNote } from "./store/notes.js";
import { modelFor, deepEffort, effortArgs, type EffortLevel } from "./models.js";

// 模型一律走 models.ts 的家族別名（不再寫死版本號）——CLI 升級時自動跟上該家族最新版。
// 用函式在「呼叫時」解析，不存成模組常數：.env.local 的 DASHBOARD_MODEL_* 覆蓋要等 remoteAccess.ts
// 載入後才進 process.env，模組載入順序早於它的常數會讀不到。
/** 規劃階段用模型：拆子問題是機械任務，用 fast 層（Haiku 家族）節成本。 */
export const planModel = (): string => modelFor("fast");
/** 研究階段用模型：帶 WebSearch/WebFetch 工具查多來源，中等複雜度用 balanced 層（Sonnet 家族）。 */
export const researchStageModel = (): string => modelFor("balanced");
/** 綜合階段用模型：綜整品質攸關結論品質，用 deep 層（Opus 家族）＋ deepEffort（預設 high）。 */
export const synthesisModel = (): string => modelFor("deep");

/** 並行研究子題的限流（與全域 withBackgroundSlot 疊加，以更緊者為準）。 */
const RESEARCH_CONCURRENCY = 3;
/** 單一子題帶 web 工具研究的硬逾時（15 分鐘；新模型查證更徹底、來源讀得更多）。 */
const RESEARCH_TIMEOUT_MS = 900_000;
/** 規劃（無工具、短輸出）的逾時（3 分鐘）。 */
const PLAN_SYNTH_TIMEOUT_MS = 180_000;
/** 綜合（無工具，但輸入是全部子題發現、輸出是整份結論，effort high）的逾時（10 分鐘）。 */
const SYNTHESIS_TIMEOUT_MS = 600_000;

/** 單一子問題的研究發現。 */
export interface ResearchFinding {
  subQuestion: string;
  findings: string;
  sources: string[];
  confidence?: string;
  status: "ok" | "error";
}

/** 整個主題研究的最終結果。 */
export interface ResearchResult {
  question: string;
  subQuestions: string[];
  findings: ResearchFinding[];
  synthesis: string;
  sources: string[];
  noteId: string;
}

/** 研究進度回報（供路由推 socket）。 */
export interface ResearchProgress {
  stage: "planned" | "researching" | "synthesized";
  total: number;
  done: number;
}

/** 單一子題研究回傳的原始發現（未含 status）。 */
export interface RawFinding {
  findings: string;
  sources: string[];
  confidence?: string;
}

/** 可注入的三階段依賴 + 存 note + 進度回呼。 */
export interface ResearchDeps {
  /** 階段1：把 question 拆成子問題清單。 */
  plan: (question: string) => Promise<string[]>;
  /** 階段2：研究單一子問題，回結構化發現 + 來源 + 信心。 */
  research: (subQuestion: string) => Promise<RawFinding>;
  /** 階段3：把所有發現綜合成結構化結論文字。 */
  synthesize: (question: string, findings: ResearchFinding[]) => Promise<string>;
  /** 存研究成果（預設 saveResearchNote）。 */
  saveNote: (input: {
    workspaceId: string;
    topic: string;
    summary: string;
    sources?: string[];
  }) => string;
  /** 進度回呼（選填）。 */
  onProgress?: (p: ResearchProgress) => void;
}

// ─────────────────────── 預設實作（真 LLM spawn）───────────────────────

/**
 * 一次性帶（可選）工具的 claude 呼叫，回 result 文字。失敗則 throw。
 * 包進 withBackgroundSlot，與其他背景工作共用全域併發額度。
 */
async function spawnClaudeText(
  prompt: string,
  opts: { model?: string; tools?: string[]; timeoutMs?: number; effort?: EffortLevel } = {},
): Promise<string> {
  return withBackgroundSlot(async () => {
    const args = [
      "-p", "--output-format", "json", "--model", opts.model ?? synthesisModel(),
      ...effortArgs(opts.effort),
      "--no-session-persistence", "--disable-slash-commands",
    ];
    if (opts.tools?.length) args.push("--allowedTools", opts.tools.join(" "));
    const r = await runClaudeOneShot(args, {
      input: prompt,
      timeoutMs: opts.timeoutMs ?? PLAN_SYNTH_TIMEOUT_MS,
      source: "research",
    });
    if (!r.ok) throw new Error(r.error || "claude 呼叫失敗");
    try {
      const j = JSON.parse(r.stdout);
      return String(j.result || "");
    } catch (e: any) {
      throw new Error(`解析回應失敗: ${e?.message || e}`);
    }
  }, { label: "research" });
}

function buildPlanPrompt(question: string): string {
  return `你是一位嚴謹的研究規劃者。使用者想深入研究以下主題：

「${question}」

請把它拆解成 3-6 個「具體、可獨立查證、彼此不重複」的子問題，每個子問題應該能透過網路查證得到答案。
只輸出一個 JSON 字串陣列（不要任何其他文字、不要程式碼區塊標記外的說明），格式範例：
["子問題一", "子問題二", "子問題三"]`;
}

function buildResearchPrompt(subQuestion: string): string {
  return `你是一位嚴謹的研究員，請針對以下子問題做「多來源」查證研究：

「${subQuestion}」

要求：
1. 用 WebSearch/WebFetch 查多個獨立來源，交叉比對。
2. 回報結構化發現，並明確標註信心程度（high / medium / low）。
3. 列出你實際引用的來源 URL 清單。

只輸出一個 JSON 物件（不要其他文字），格式：
{
  "findings": "你的結構化發現（可含條列，用 \\n 分行）",
  "sources": ["https://...", "https://..."],
  "confidence": "high | medium | low"
}`;
}

function buildSynthesisPrompt(question: string, findings: ResearchFinding[]): string {
  const body = findings
    .map((f, i) =>
      `### 子問題 ${i + 1}：${f.subQuestion}（信心：${f.confidence ?? "未標"}，狀態：${f.status}）\n${f.findings}\n來源：${f.sources.join(", ") || "（無）"}`,
    )
    .join("\n\n");
  return `你是一位資深研究綜整者。以下是針對主題「${question}」各子問題的研究發現：

${body}

請綜合成一份結構化結論：
1. 直接回答原主題。
2. 明確指出彼此矛盾/不一致之處（若有），並說明你採信哪一方及理由。
3. 標明整體信心與尚未查清的缺口。
輸出純文字結論即可（會被存進研究成果庫供日後回溯）。`;
}

/** 從文字抽出第一個 JSON 陣列並 parse；失敗回 null。 */
function extractJsonArray(text: string): any[] | null {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 從文字抽出第一個 JSON 物件並 parse；失敗回 null。 */
function extractJsonObject(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 從文字抽出所有 http(s) URL 並去重。 */
function extractUrls(text: string): string[] {
  const m = text.match(/https?:\/\/[^\s)"'\]]+/g);
  return m ? [...new Set(m)] : [];
}

/** 把規劃回應解析成子問題清單；解析失敗回退用原問題。 */
function parseSubQuestions(text: string, question: string): string[] {
  const arr = extractJsonArray(text);
  if (arr) {
    const qs = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    if (qs.length) return qs;
  }
  return [question];
}

/** 把研究回應解析成結構化發現；解析失敗退而用全文 + regex 抽 URL。 */
function parseResearchFinding(text: string): RawFinding {
  const obj = extractJsonObject(text);
  if (obj) {
    const findings = typeof obj.findings === "string" && obj.findings.trim() ? obj.findings : text;
    const sources = Array.isArray(obj.sources)
      ? obj.sources.map((s: any) => String(s)).filter(Boolean)
      : extractUrls(text);
    const confidence = typeof obj.confidence === "string" ? obj.confidence : undefined;
    return { findings, sources, confidence };
  }
  return { findings: text, sources: extractUrls(text) };
}

async function defaultPlan(question: string): Promise<string[]> {
  const text = await spawnClaudeText(buildPlanPrompt(question), { model: planModel() });
  return parseSubQuestions(text, question);
}

async function defaultResearch(subQuestion: string): Promise<RawFinding> {
  const text = await spawnClaudeText(buildResearchPrompt(subQuestion), {
    model: researchStageModel(),
    tools: ["WebSearch", "WebFetch"],
    timeoutMs: RESEARCH_TIMEOUT_MS,
  });
  return parseResearchFinding(text);
}

async function defaultSynthesize(question: string, findings: ResearchFinding[]): Promise<string> {
  return spawnClaudeText(buildSynthesisPrompt(question, findings), {
    model: synthesisModel(),
    effort: deepEffort(),
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
  });
}

/** 預設依賴：真 LLM spawn + saveResearchNote。測試會覆蓋其中的三階段函式。 */
export const defaultResearchDeps: Omit<ResearchDeps, "onProgress"> = {
  plan: defaultPlan,
  research: defaultResearch,
  synthesize: defaultSynthesize,
  saveNote: saveResearchNote,
};

// ─────────────────────── orchestration ───────────────────────

/**
 * 跑一趟主題研究：規劃子問題 → 並行多來源研究 → 綜合標來源 → 存研究成果庫。
 * deps 可部分注入（未提供的用預設真 LLM 實作）；測試注入 fake 三階段驗證整條流程。
 */
export async function runTopicResearch(
  input: { workspaceId: string; question: string },
  deps: Partial<ResearchDeps> = {},
): Promise<ResearchResult> {
  const { workspaceId, question } = input;
  const plan = deps.plan ?? defaultResearchDeps.plan;
  const research = deps.research ?? defaultResearchDeps.research;
  const synthesize = deps.synthesize ?? defaultResearchDeps.synthesize;
  const saveNote = deps.saveNote ?? defaultResearchDeps.saveNote;
  const onProgress = deps.onProgress;

  // 階段1：規劃。解析失敗 / 拋錯 → 回退單一子問題（原問題）。
  let subQuestions: string[];
  try {
    const planned = await plan(question);
    subQuestions = Array.isArray(planned) && planned.length ? planned : [question];
  } catch {
    subQuestions = [question];
  }
  const total = subQuestions.length;
  onProgress?.({ stage: "planned", total, done: 0 });

  // 階段2：並行研究（限流）。單項失敗不拖垮整批 → 回部分結果（status:"error"）。
  let completed = 0;
  const findings: ResearchFinding[] = await mapWithConcurrency(
    subQuestions,
    RESEARCH_CONCURRENCY,
    async (sq): Promise<ResearchFinding> => {
      try {
        const r = await research(sq);
        return {
          subQuestion: sq,
          findings: r.findings,
          sources: Array.isArray(r.sources) ? r.sources : [],
          confidence: r.confidence,
          status: "ok",
        };
      } catch (e: any) {
        return {
          subQuestion: sq,
          findings: `（研究失敗：${e?.message || String(e)}）`,
          sources: [],
          status: "error",
        };
      } finally {
        completed++;
        onProgress?.({ stage: "researching", total, done: completed });
      }
    },
  );

  // 彙整所有來源 URL 並去重。
  const sources = [...new Set(findings.flatMap((f) => f.sources))];

  // 階段3：綜合。
  const synthesis = await synthesize(question, findings);
  onProgress?.({ stage: "synthesized", total, done: total });

  // 存研究成果庫（帶正確 workspaceId → 進 BM25 檢索、注入未來對話）。
  const noteId = saveNote({ workspaceId, topic: question, summary: synthesis, sources });

  return { question, subQuestions, findings, synthesis, sources, noteId };
}
