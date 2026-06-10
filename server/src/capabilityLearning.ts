/**
 * 能力學習 runner — 用一次性 Claude CLI 呼叫產生學習提案。
 * 兩層：類層（category）產出 domain 提案、個人層（agent）產出 craft 提案，
 * 全部寫進既有的 learning_proposals 表，走 Phase 1 的批准 UI。
 */
import { spawnClaude } from "./claudeProcess.js";
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCategoryMemory, getCraftMemoryFor } from "./learningStore.js";
import { db, DEFAULT_WORKSPACE_ID } from "./db.js";
import { loadAgents, categoryLabel, readAgentDefinition } from "./agentLoader.js";
import {
  buildCategoryLearningPrompt, buildAgentLearningPrompt,
  buildAgentResearchPrompt, parseCapabilityReport,
} from "./capabilityPrompts.js";
import { saveCapabilityReport } from "./studyStore.js";

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
  // 能力學習條目較詳細（含具體判準/數字），放寬至 500 字
  const drafts = parseLearnMarkers(text, 8, 500);
  let created = 0;
  // kind / scope 由 target 類型決定，不採信 Claude 回應裡的 kind 標記
  // （類層一律 domain、個人層一律 craft），避免模型亂標。
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

/**
 * 解析研究型 worker 的回應：把 LEARN 標記建成 agent-global 的 craft 提案，
 * 並把 REPORT 區塊（含來源 URL）寫進能力報告表。回傳建立的提案數。
 */
export function ingestResearchOutput(text: string, agentId: string, runId: string | null): number {
  // research prompt 最多 6 條（對應 buildAgentResearchPrompt 的 3-6 上限）
  const drafts = parseLearnMarkers(text, 6, 500);
  let created = 0;
  for (const d of drafts) {
    const p = createProposal({
      agentId, workspaceId: DEFAULT_WORKSPACE_ID,
      kind: "craft", scope: "agent-global",
      content: d.content, source: "capability-research:agent",
    });
    if (p) created++;
  }
  const rep = parseCapabilityReport(text);
  if (rep) saveCapabilityReport({ agentId, report: rep.report, sources: rep.sources, runId });
  return created;
}

interface ClaudeRunOptions { tools?: string[]; timeoutMs?: number; }

/**
 * 共用底層：一次性非互動呼叫 Claude，支援可選工具清單與逾時保護。
 * runClaudeOnce / runClaudeWithTools 均委派至此，避免重複實作。
 */
function runClaudeOnceBase(prompt: string, opts: ClaudeRunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", "--output-format", "json", "--model", LEARNING_MODEL,
      "--no-session-persistence", "--disable-slash-commands",
    ];
    if (opts.tools?.length) args.push("--allowedTools", opts.tools.join(" "));
    let settled = false;
    const done = (err: Error | null, val?: string) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(val!);
    };
    const child = spawnClaude(args);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => { try { child.kill(); } catch {} done(new Error("研究逾時")); }, opts.timeoutMs);
      timer.unref?.();
    }
    let out = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d) => {
      out += String(d);
      if (out.length > 5_000_000) { if (timer) clearTimeout(timer); child.kill(); done(new Error("輸出超過上限")); }
    });
    child.stderr!.on("data", () => {});
    child.stdin!.write(Buffer.from(prompt, "utf8")); child.stdin!.end();
    child.on("error", (e) => { if (timer) clearTimeout(timer); done(e); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) { done(new Error(`claude exit ${code}`)); return; }
      try { const j = JSON.parse(out); done(null, String(j.result || "")); }
      catch (e: any) { done(new Error(`解析回應失敗: ${e.message}`)); }
    });
  });
}

/** 一次性非互動呼叫 Claude，回傳 result 文字。失敗則 throw。 */
function runClaudeOnce(prompt: string): Promise<string> { return runClaudeOnceBase(prompt); }

/**
 * 帶工具（WebSearch/WebFetch）與逾時的一次性 Claude 呼叫，回傳 result 文字。
 * 與 runClaudeOnce 相同的協議，但多了 --allowedTools 與硬逾時保護。
 */
function runClaudeWithTools(prompt: string, tools: string[], timeoutMs: number): Promise<string> {
  return runClaudeOnceBase(prompt, { tools, timeoutMs });
}

/**
 * 跑單一 agent 的自主進修：用 WebSearch/WebFetch 研究最新業界知識，
 * 產出 craft 提案 + 能力現況報告。回傳建立的提案數。會打真 Claude。
 */
export async function runResearchTarget(target: LearnTarget, runId: string | null = null): Promise<{ created: number }> {
  const agent = loadAgents().find((a) => a.id === target.id);
  if (!agent) throw new Error(`找不到 agent: ${target.id}`);
  const def = readAgentDefinition(target.id);
  const bundle = getCraftMemoryFor(target.id, DEFAULT_WORKSPACE_ID);
  const craftText = [bundle.legacyGlobal, bundle.global].filter((s) => s && s.trim()).join("\n");
  const catMem = getCategoryMemory(agent.category);
  const prompt = buildAgentResearchPrompt(agent.name, agent.description, def?.body, craftText, catMem);
  const text = await runClaudeWithTools(prompt, ["WebSearch", "WebFetch"], 600_000);
  const created = ingestResearchOutput(text, target.id, runId);
  if (created === 0 && !parseCapabilityReport(text)) throw new Error("研究未產出任何 LEARN 或 REPORT");
  return { created };
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
  scheduleId?: string | null;
  runKind?: "learning" | "research";
}

const runs = new Map<string, LearningRun>();
const RUN_TTL_MS = 30 * 60 * 1000; // run 完成後保留 30 分鐘供查詢，之後清掉

// --- DB 持久化 helpers ---

/** 把 LearningRun 的當前狀態 INSERT 進 DB（建立時呼叫）。 */
function insertRunToDB(run: LearningRun): void {
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO learning_runs
    (id, targets, status, total, done, current, failed, created_proposals, schedule_id, run_kind, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    JSON.stringify(run.targets),
    run.status,
    run.total,
    run.done,
    run.current ?? null,
    JSON.stringify(run.failed),
    run.createdProposals,
    run.scheduleId ?? null,
    run.runKind ?? "learning",
    now,
    now,
  );
}

/** 把 LearningRun 的當前狀態 UPDATE 進 DB（每次進度變化時呼叫）。 */
function persistRun(run: LearningRun): void {
  db.prepare(`
    UPDATE learning_runs
    SET status = ?, done = ?, current = ?, failed = ?, created_proposals = ?, updated_at = ?
    WHERE id = ?
  `).run(
    run.status,
    run.done,
    run.current ?? null,
    JSON.stringify(run.failed),
    run.createdProposals,
    Date.now(),
    run.id,
  );
}

/** 從 DB 的一行資料重建 LearningRun 物件（不寫進 in-memory Map）。 */
function rowToRun(row: any): LearningRun {
  return {
    id: row.id,
    targets: JSON.parse(row.targets || "[]"),
    status: row.status,
    total: row.total,
    done: row.done,
    current: row.current ?? null,
    failed: JSON.parse(row.failed || "[]"),
    createdProposals: row.created_proposals,
    scheduleId: row.schedule_id ?? null,
    runKind: row.run_kind ?? "learning",
  };
}

/**
 * 查詢 run 進度：先查 in-memory Map，沒有再查 DB。
 * 讓 GET /api/learning/run/:id 在 server 重啟後仍可查到歷史紀錄。
 */
export function getLearningRun(id: string): LearningRun | undefined {
  const mem = runs.get(id);
  if (mem) return mem;
  const row = db.prepare("SELECT * FROM learning_runs WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToRun(row);
}

/**
 * 序列執行一個 run：逐一處理 target，每完成一個呼叫 onProgress。
 * worker 注入以利測試；正式呼叫傳 runLearningTarget。
 *
 * 斷點續跑核心：for 迴圈從 run.done 開始（而非 0），
 * 讓 resume 時跳過已完成的部分。
 * 新建的 run 其 done=0，行為與舊版一致。
 */
export async function executeLearningRun(
  run: LearningRun,
  worker: (t: LearnTarget) => Promise<{ created: number }>,
  onProgress: (run: LearningRun) => void,
): Promise<void> {
  try {
    // 從 done 開始，而非 0。新建 run done=0 等同全跑；resume 時則從中斷點繼續。
    for (let i = run.done; i < run.targets.length; i++) {
      const t = run.targets[i];
      run.current = `${t.type}:${t.id}`;
      try {
        const { created } = await worker(t);
        run.createdProposals += created;
      } catch (e: any) {
        run.failed.push({ target: `${t.type}:${t.id}`, error: e?.message || String(e) });
      }
      run.done++;
      persistRun(run);
      onProgress(run);
    }
    run.current = null;
    run.status = "done";
    persistRun(run);
  } finally {
    // run 結束（成功或拋錯）後延遲清理，避免 runs Map 無限增長。
    // DB 紀錄保留；in-memory 30 分鐘後清除。
    // unref 讓這個 timer 不會阻止 process 結束。
    setTimeout(() => runs.delete(run.id), RUN_TTL_MS).unref();
  }
}

/** 建立並登記一個新 run（狀態機初始值），同時寫入 DB。 */
export function createLearningRun(
  targets: LearnTarget[],
  scheduleId?: string | null,
  runKind: "learning" | "research" = "learning",
): LearningRun {
  const run: LearningRun = {
    id: `lrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    targets, status: "running",
    total: targets.length, done: 0, current: null,
    failed: [], createdProposals: 0,
    scheduleId: scheduleId ?? null,
    runKind,
  };
  runs.set(run.id, run);
  insertRunToDB(run);
  return run;
}

/**
 * server 啟動時呼叫：撿起上次中斷的 run（status='running'）並從斷點續跑。
 * sink 由 index.ts 注入（避免 capabilityLearning.ts 直接依賴 socket.io）；
 * worker 則依每個 run 的 runKind 內部分流：research → runResearchTarget（需綁 run.id），
 * 其餘 → runLearningTarget，確保進修型 run 重啟後仍走研究流程並寫回能力報告。
 */
export function resumeUnfinishedRuns(
  sink: (run: LearningRun) => void,
): void {
  const rows = db.prepare("SELECT * FROM learning_runs WHERE status = 'running'").all() as any[];
  if (rows.length === 0) return;
  console.log(`[capability-learning] resuming ${rows.length} unfinished run(s)`);
  for (const row of rows) {
    const run = rowToRun(row);
    // 重建 in-memory 讓 getLearningRun 可以直接查 Map
    runs.set(run.id, run);
    // 依 runKind 選對 worker：research 需把 run.id 綁進去以利報告寫回
    const worker = run.runKind === "research"
      ? (t: LearnTarget) => runResearchTarget(t, run.id)
      : runLearningTarget;
    // 背景續跑，不 await
    executeLearningRun(run, worker, sink).catch((e) => {
      run.status = "error";
      persistRun(run);
      console.warn(`[capability-learning] resumed run ${run.id} failed:`, e?.message || e);
    });
  }
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
    // 把 agent .md 完整人設正文也餵給 Opus，讓窄領域 agent 有足夠素材寫出獨門手藝
    const def = readAgentDefinition(target.id);
    prompt = buildAgentLearningPrompt(agent.name, agent.description, catMem, def?.body);
  }
  const text = await runClaudeOnce(prompt);
  const created = ingestLearningOutput(text, target);
  if (created === 0 && !parseLearnMarkers(text, 8, 500).length) {
    throw new Error("回應未包含任何學習標記");
  }
  return { created };
}
