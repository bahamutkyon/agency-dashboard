/**
 * watchtowerScheduler.ts — 常駐看守任務排程器
 *
 * 模式對齊 learningScheduler.ts：
 * - 模組級 running Set 做 overlap guard
 * - TZ Asia/Taipei
 * - fire 任何一步失敗都 log + 不讓 cron 崩
 *
 * ⚠️ 升級路徑：使用 startOrchestratorSession（routes/sessions.ts 匯出），
 *   確保 PM session 帶完整 dispatchGuide + catalog + goals 開場錨定，
 *   不走裸 agentManager.start → PM 拿不到派工手冊而空轉。
 */
import cron, { ScheduledTask } from "node-cron";
import {
  listEnabledTasks,
  getWatchtowerTask,
  appendLog,
  countActsToday,
  getLastActRunId,
  updateLastFired,
  updateLastConclusion,
  type WatchtowerTask,
} from "./store/watchtower.js";
import { getRun } from "./store/autonomy.js";
import { runClaudeOneShot } from "./claudeOneShot.js";
import { startRun, type AutonomyDeps } from "./autonomyRunner.js";

/** autonomy run 的終態集合（對齊 autonomyRunner 的 run_done 分類）。非此集合＝仍活著。 */
const TERMINAL_RUN_STATUSES = new Set(["done", "stopped", "budget_exhausted", "error"]);
import { makeDeps as makeAutonomyDeps } from "./routes/autonomy.js";
import { startOrchestratorSession } from "./routes/sessions.js";
import { notify } from "./notifier.js";
import { agentManager } from "./agentManager.js";

// ─── Haiku 模型 ID ──────────────────────────────────────────────────────────
const HAIKU_MODEL = "claude-haiku-4-5";

// ─── Quiet hours 解析 ────────────────────────────────────────────────────────

/** 解析 "HH-HH" 格式。空字串 = 無 quiet hours。 */
function parseQuietHours(spec: string): { start: number; end: number } | null {
  if (!spec || !spec.trim()) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  if (!m) return null;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

/**
 * 判斷目前 Asia/Taipei 時刻是否在 quiet hours 內。
 * 支援跨午夜：如 "22-8" = 22:00 到 08:00。
 */
export function isInQuietHours(spec: string, now: number): boolean {
  const range = parseQuietHours(spec);
  if (!range) return false;
  const taipeiHour = new Date(now).toLocaleString("en-US", {
    timeZone: "Asia/Taipei",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(taipeiHour, 10);
  const { start, end } = range;
  if (start <= end) {
    // 不跨午夜，如 "9-17"
    return h >= start && h < end;
  } else {
    // 跨午夜，如 "22-8"
    return h >= start || h < end;
  }
}

// ─── 評估回合結果型別 ────────────────────────────────────────────────────────

interface EvalResult {
  shouldAct: boolean;
  reason: string;
  goal: string;
}

/** 解析 haiku 輸出的 JSON（結構化評估結論）。解析失敗回 null。 */
function parseEvalResult(stdout: string): EvalResult | null {
  try {
    // 嘗試直接 parse
    const raw = JSON.parse(stdout);
    if (typeof raw?.result?.shouldAct === "boolean") {
      // 有 claude JSON wrapper（`--output-format json`）
      const inner = typeof raw.result === "string" ? JSON.parse(raw.result) : raw.result;
      return {
        shouldAct: Boolean(inner.shouldAct),
        reason: String(inner.reason ?? ""),
        goal: String(inner.goal ?? ""),
      };
    }
    if (typeof raw?.shouldAct === "boolean") {
      return {
        shouldAct: Boolean(raw.shouldAct),
        reason: String(raw.reason ?? ""),
        goal: String(raw.goal ?? ""),
      };
    }
    // claude `--output-format json` 的 result 欄位
    if (typeof raw?.result === "string") {
      const inner = JSON.parse(raw.result);
      return {
        shouldAct: Boolean(inner.shouldAct),
        reason: String(inner.reason ?? ""),
        goal: String(inner.goal ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 可注入的 deps（供測試用假的代替）──────────────────────────────────────────

export interface WatchtowerFireDeps {
  runOneShot: typeof runClaudeOneShot;
  startRun: typeof startRun;
  makeAutonomyDeps: (io: any) => AutonomyDeps;
  startOrchestratorSession: typeof startOrchestratorSession;
  now: () => number;
  notifyFn: typeof notify;
  /** 查某 autonomy run 的目前狀態（供 overlap live-run guard）；預設讀 autonomy store。 */
  getRunStatus?: (runId: string) => string | undefined;
}

const defaultDeps: WatchtowerFireDeps = {
  runOneShot: runClaudeOneShot,
  startRun,
  makeAutonomyDeps,
  startOrchestratorSession,
  now: () => Date.now(),
  notifyFn: notify,
  getRunStatus: (runId) => getRun(runId)?.status,
};

// ─── 核心 fire 邏輯（可測試）──────────────────────────────────────────────────

/**
 * 執行一次看守任務 fire 流程。
 * 回傳 decision（供測試斷言）。
 *
 * 設計：四道護欄 + 評估 + 升級。每步失敗都 log 對應 decision，不 throw。
 */
export async function firewatchdogTask(
  task: WatchtowerTask,
  io: any,
  deps: WatchtowerFireDeps = defaultDeps,
  opts: { force?: boolean } = {},
): Promise<"quiet" | "quota" | "overlap" | "skip" | "act" | "error"> {
  const { runOneShot, startRun: doStartRun, makeAutonomyDeps: makeDeps, startOrchestratorSession: startOrch, now, notifyFn } = deps;
  const getRunStatus = deps.getRunStatus ?? ((runId: string) => getRun(runId)?.status);
  const force = opts.force === true;
  const taskId = task.id;
  const workspaceId = task.workspaceId;
  const nowMs = now();

  // ① quiet hours（force 手動觸發可略過）
  if (!force && isInQuietHours(task.quietHours, nowMs)) {
    appendLog({ taskId, workspaceId, decision: "quiet", reason: `quiet hours: ${task.quietHours}` });
    return "quiet";
  }

  // ② daily quota（force 手動觸發可略過）
  if (!force) {
    const actsToday = countActsToday(taskId, nowMs);
    if (actsToday >= task.dailyQuota) {
      appendLog({
        taskId,
        workspaceId,
        decision: "quota",
        reason: `今日已升級 ${actsToday} 次（上限 ${task.dailyQuota}）`,
      });
      return "quota";
    }
  }

  // ③ live-run overlap guard（**force 也擋**——資源安全）：
  // scheduler 的 in-memory running set 在 startRun 的 loop return（含 run 進 paused/待批態）
  // 後就清空，無法防「上一個升級的 run 還卡在待批」。這裡用台帳最近一次 act 的 run_id 查
  // 該 run 是否仍未終結；未終結就跳過，避免累積並存孤兒 PM session/run。
  const lastRunId = getLastActRunId(taskId);
  if (lastRunId) {
    const st = getRunStatus(lastRunId);
    if (st && !TERMINAL_RUN_STATUSES.has(st)) {
      appendLog({ taskId, workspaceId, decision: "overlap", reason: `上一個升級的 run（${st}）尚未終結，跳過本次` });
      return "overlap";
    }
  }

  // ③ 組狀態包 + 便宜評估回合（haiku）
  const { buildWatchtowerContext, formatWatchtowerContextPrompt } = await import("./watchtowerContext.js");
  const ctx = buildWatchtowerContext(workspaceId, taskId);
  const ctxText = formatWatchtowerContextPrompt(ctx);

  const evalPrompt = `你是一個自主 PM 看守任務的評估員。
根據以下工作區狀態包，判斷現在是否需要啟動一次自主行動（autonomy run）。

${ctxText}

請分析：
1. 有沒有到期或快到期的待回訪需要追？
2. 有沒有失敗的交辦需要重試或跟進？
3. 有沒有落後的目標需要啟動行動？
4. 有沒有在途交辦數量超過合理範圍（>5個）代表可能有問題？

請用 JSON 回答（不要有其他文字）：
{"shouldAct": true/false, "reason": "一句話說明", "goal": "如果要動手，給 PM 的明確目標（20字內）；不動手則空字串"}`;

  let evalResult: EvalResult | null = null;
  try {
    const r = await runOneShot(
      [
        "-p",
        "--output-format", "json",
        "--model", HAIKU_MODEL,
        "--no-session-persistence",
        "--disable-slash-commands",
      ],
      {
        input: evalPrompt,
        timeoutMs: 60_000, // 評估回合 1 分鐘夠了
        source: "watchtower",
      },
    );

    if (!r.ok) {
      appendLog({ taskId, workspaceId, decision: "error", reason: `評估回合失敗: ${r.error || "unknown"}` });
      return "error";
    }

    evalResult = parseEvalResult(r.stdout);
    if (!evalResult) {
      appendLog({ taskId, workspaceId, decision: "error", reason: `評估結果解析失敗: ${r.stdout.slice(0, 200)}` });
      updateLastConclusion(taskId, `解析失敗（跳過升級）`);
      return "error";
    }
  } catch (e: any) {
    appendLog({ taskId, workspaceId, decision: "error", reason: `評估回合例外: ${e?.message ?? String(e)}` });
    return "error";
  }

  // ④ shouldAct=false → skip
  if (!evalResult.shouldAct) {
    appendLog({ taskId, workspaceId, decision: "skip", reason: evalResult.reason || "評估認為不需行動" });
    updateLastConclusion(taskId, `skip: ${evalResult.reason}`);
    return "skip";
  }

  // ⑤ 升級 → 開真 PM session + startRun(policy=balanced)
  const goal = evalResult.goal || `看守任務啟動：${task.name}`;
  let sessionId: string;
  let runId: string | undefined;

  try {
    const title = `🔭 看守任務 ${new Date(nowMs).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })} — ${task.name}`;
    sessionId = startOrch(workspaceId, title);
  } catch (e: any) {
    appendLog({ taskId, workspaceId, decision: "error", reason: `開 PM session 失敗: ${e?.message ?? String(e)}` });
    return "error";
  }

  try {
    const autonomyDeps = makeDeps(io);
    runId = await doStartRun(
      sessionId,
      workspaceId,
      goal,
      { policy: "balanced" },
      autonomyDeps,
    );
    // 更新台帳
    appendLog({ taskId, workspaceId, decision: "act", reason: evalResult.reason, runId });
    updateLastConclusion(taskId, `act: ${evalResult.reason}`);
    updateLastFired(taskId);
    // 推播（best-effort）
    try {
      void notifyFn({
        kind: "看守任務動手了",
        title: `${task.name}：${goal.slice(0, 60)}`,
        body: evalResult.reason,
      });
    } catch {}
    return "act";
  } catch (e: any) {
    appendLog({ taskId, workspaceId, decision: "error", reason: `startRun 失敗: ${e?.message ?? String(e)}` });
    return "error";
  }
}

// ─── Scheduler 類（對齊 learningScheduler.ts 結構）──────────────────────────

class WatchtowerScheduler {
  private tasks = new Map<string, ScheduledTask>();
  // overlap guard：同一看守任務上一輪還在跑就跳過本次
  private running = new Set<string>();
  private io: any = null;

  /** server 啟動時呼叫一次，注入 socket io。 */
  init(io: any) {
    this.io = io;
    this.sync();
    console.log(`[watchtower-scheduler] initialized, ${this.tasks.size} active tasks`);
  }

  /** DB 變動（CRUD）後重新同步 cron job。 */
  sync() {
    // teardown-and-rebuild
    for (const id of [...this.tasks.keys()]) this.unregister(id);
    for (const task of listEnabledTasks()) {
      if (cron.validate(task.cron)) {
        this.register(task.id, task.cron);
      } else {
        console.warn(`[watchtower-scheduler] 非法 cron "${task.cron}" 跳過 task ${task.id}`);
      }
    }
  }

  private register(taskId: string, expr: string) {
    const task = cron.schedule(
      expr,
      () => void this.fire(taskId),
      { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" },
    );
    this.tasks.set(taskId, task);
    console.log(`[watchtower-scheduler] registered task ${taskId} (${expr})`);
  }

  private unregister(taskId: string) {
    const t = this.tasks.get(taskId);
    if (t) { t.stop(); this.tasks.delete(taskId); }
  }

  private async fire(taskId: string) {
    const task = getWatchtowerTask(taskId);
    if (!task || !task.enabled) return;

    // overlap guard
    if (this.running.has(taskId)) {
      appendLog({ taskId, workspaceId: task.workspaceId, decision: "overlap", reason: "上一輪仍在執行，跳過本次" });
      console.log(`[watchtower-scheduler] SKIP task ${taskId}（overlap）`);
      return;
    }

    this.running.add(taskId);
    console.log(`[watchtower-scheduler] FIRE task ${taskId} "${task.name}"`);
    try {
      const decision = await firewatchdogTask(task, this.io);
      console.log(`[watchtower-scheduler] task ${taskId} decision=${decision}`);
    } catch (err: any) {
      // 最後一道防線：任何意外不讓 cron 崩
      console.error(`[watchtower-scheduler] task ${taskId} unhandled error:`, err?.message ?? err);
      try {
        appendLog({ taskId, workspaceId: task.workspaceId, decision: "error", reason: `unhandled: ${err?.message ?? String(err)}` });
      } catch {}
    } finally {
      this.running.delete(taskId);
    }
  }

  /**
   * 手動「立即執行一次」——走與 cron fire 同一個 in-memory running-set 併發守衛
   * （修 W-2：run-now 原本直呼 firewatchdogTask 繞過 overlap，連按兩下會開兩個 run）。
   * force=true 略過 firewatchdogTask 內的 quiet/quota（但 live-run overlap 仍擋——資源安全）。
   * @returns decision，或 "overlap"（已有一輪在跑）
   */
  async runNow(taskId: string, opts: { force?: boolean } = {}, deps: WatchtowerFireDeps = defaultDeps): Promise<string> {
    const task = getWatchtowerTask(taskId);
    if (!task) return "error";
    if (!task.enabled) return "disabled"; // 停用不是錯誤——回中性 decision，前端別標紅
    if (this.running.has(taskId)) {
      appendLog({ taskId, workspaceId: task.workspaceId, decision: "overlap", reason: "上一輪仍在執行，跳過本次（手動）" });
      return "overlap";
    }
    this.running.add(taskId);
    try {
      return await firewatchdogTask(task, this.io, deps, { force: opts.force === true });
    } catch (err: any) {
      try {
        appendLog({ taskId, workspaceId: task.workspaceId, decision: "error", reason: `run-now unhandled: ${err?.message ?? String(err)}` });
      } catch {}
      return "error";
    } finally {
      this.running.delete(taskId);
    }
  }

  /** 取正在執行中的 task ID set（供測試斷言）。 */
  getRunning(): ReadonlySet<string> {
    return this.running;
  }
}

export const watchtowerScheduler = new WatchtowerScheduler();
