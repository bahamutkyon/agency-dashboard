/**
 * 能力學習 runner — 用一次性 Claude CLI 呼叫產生學習提案。
 * 兩層：類層（category）產出 domain 提案、個人層（agent）產出 craft 提案，
 * 全部寫進既有的 learning_proposals 表，走 Phase 1 的批准 UI。
 */
import { spawnClaude } from "./claudeProcess.js";
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCategoryMemory } from "./learningStore.js";
import { DEFAULT_WORKSPACE_ID } from "./db.js";
import { loadAgents, categoryLabel } from "./agentLoader.js";
import { buildCategoryLearningPrompt, buildAgentLearningPrompt } from "./capabilityPrompts.js";

/** 類層提案的 agent_id 前綴 — 避免與真實 agentId 撞名。 */
export const CATEGORY_PREFIX = "__category__:";

/** 能力學習用的模型：盤點專業必備知識是高品質反思任務，用最強的 Opus 4.7。 */
const LEARNING_MODEL = "claude-opus-4-7";

export interface LearnTarget {
  type: "category" | "agent";
  id: string; // category id 或 agent id
}

/** 從類層提案的 agent_id 取回 categoryId；非類層格式回傳 null。 */
export function parseCategoryAgentId(agentId: string): string | null {
  return agentId.startsWith(CATEGORY_PREFIX) ? agentId.slice(CATEGORY_PREFIX.length) : null;
}

/**
 * 把 Claude 回應文字解析成學習提案並寫入 DB，回傳實際建立的提案數
 * （createProposal 內建去重，重複的不計入）。
 */
export function ingestLearningOutput(text: string, target: LearnTarget): number {
  const drafts = parseLearnMarkers(text, 8);
  let created = 0;
  for (const d of drafts) {
    const proposal = target.type === "category"
      ? createProposal({
          agentId: CATEGORY_PREFIX + target.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          kind: "domain",
          scope: "category",
          content: d.content,
          source: "capability-learning:category",
        })
      : createProposal({
          agentId: target.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          kind: "craft",
          scope: "agent-global",
          content: d.content,
          source: "capability-learning:agent",
        });
    if (proposal) created++;
  }
  return created;
}

/** 一次性非互動呼叫 Claude，回傳 result 文字。失敗則 throw。 */
function runClaudeOnce(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, val?: string) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(val!);
    };
    const child = spawnClaude([
      "-p", "--output-format", "json",
      "--model", LEARNING_MODEL,
      "--no-session-persistence",
      "--disable-slash-commands",
    ]);
    let out = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d) => {
      out += String(d);
      if (out.length > 5_000_000) { child.kill(); done(new Error("輸出超過上限")); }
    });
    child.stderr!.on("data", () => {});
    child.stdin!.write(Buffer.from(prompt, "utf8"));
    child.stdin!.end();
    child.on("error", (e) => done(e));
    child.on("close", (code) => {
      if (code !== 0) { done(new Error(`claude exit ${code}`)); return; }
      try {
        const j = JSON.parse(out);
        done(null, String(j.result || ""));
      } catch (e: any) {
        done(new Error(`解析回應失敗: ${e.message}`));
      }
    });
  });
}

// --- 學習 run 狀態機 ---

export interface LearningRun {
  id: string;
  targets: LearnTarget[];
  status: "running" | "done" | "error";
  total: number;
  done: number;
  current: string | null;
  failed: { target: string; error: string }[];
  createdProposals: number;
}

const runs = new Map<string, LearningRun>();

export function getLearningRun(id: string): LearningRun | undefined {
  return runs.get(id);
}

/**
 * 序列執行一個 run：逐一處理 target，每完成一個呼叫 onProgress。
 * worker 注入以利測試；正式呼叫傳 runLearningTarget。
 */
export async function executeLearningRun(
  run: LearningRun,
  worker: (t: LearnTarget) => Promise<{ created: number }>,
  onProgress: (run: LearningRun) => void,
): Promise<void> {
  for (const t of run.targets) {
    run.current = `${t.type}:${t.id}`;
    try {
      const { created } = await worker(t);
      run.createdProposals += created;
    } catch (e: any) {
      run.failed.push({ target: `${t.type}:${t.id}`, error: e?.message || String(e) });
    }
    run.done++;
    onProgress(run);
  }
  run.current = null;
  run.status = "done";
}

/** 建立並登記一個新 run（狀態機初始值）。 */
export function createLearningRun(targets: LearnTarget[]): LearningRun {
  const run: LearningRun = {
    id: `lrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    targets, status: "running",
    total: targets.length, done: 0, current: null,
    failed: [], createdProposals: 0,
  };
  runs.set(run.id, run);
  return run;
}

/** 跑單一 target 的能力學習，回傳建立的提案數。 */
export async function runLearningTarget(target: LearnTarget): Promise<{ created: number }> {
  let prompt: string;
  if (target.type === "category") {
    prompt = buildCategoryLearningPrompt(categoryLabel(target.id));
  } else {
    const agent = loadAgents().find((a) => a.id === target.id);
    if (!agent) throw new Error(`找不到 agent: ${target.id}`);
    const catMem = getCategoryMemory(agent.category);
    prompt = buildAgentLearningPrompt(agent.name, agent.description, catMem);
  }
  const text = await runClaudeOnce(prompt);
  const created = ingestLearningOutput(text, target);
  if (created === 0 && !parseLearnMarkers(text, 8).length) {
    throw new Error("回應未包含任何學習標記");
  }
  return { created };
}
