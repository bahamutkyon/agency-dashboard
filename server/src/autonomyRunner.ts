import { parseActions, type ParsedAction } from "./actionProtocol.js";
import type { DispatchItem } from "./dispatchParser.js";
import { shouldAutoApprove } from "./autonomyPolicy.js";
import { notify } from "./notifier.js";
import {
  createRun, getRun, updateRunStatus, incrementStep,
  createPendingAction, getPendingAction, decidePendingAction, markActionExecuted,
  supersedePendingForRun, clearPendingInjection, extendDeadlineBy, incrementResumeCount,
  type AutonomyRun, type PendingAction, type RunStatus,
} from "./store/autonomy.js";

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_MAX_WALL_MS = 30 * 60 * 1000;

export interface AutonomyDeps {
  sendTurn: (sessionId: string, prompt: string) => Promise<string>;
  /**
   * 執行派工。ledger 為選填記帳脈絡（pmSessionId=run 的 session、runId）——傳入時
   * 每項派工會進台帳＋（execute）推播，讓自走模式的在途面板/手機通知不再失聲。
   */
  runDispatch: (
    items: DispatchItem[],
    workspaceId: string,
    ledger?: { pmSessionId: string; runId: string },
  ) => Promise<string>;
  now: () => number;
  emit: (runId: string, evt: { kind: "run" | "pending" | "action"; run?: AutonomyRun; action?: PendingAction }) => void;
}

const activeDeps = new Map<string, AutonomyDeps>();

export const PROTOCOL = `你正在「自主模式」下工作。請嚴格用以下標記與系統溝通，每次回覆**只輸出一個** ACTION 區塊放在最末尾：
=== ACTION ===
kind: <clarify|plan|next_step|goal_done|need_input|dispatch|external_send|destructive|spend>
risk: <high|low>
summary: <一句話>
detail: <細節，可多行>
=== END ACTION ===
規則：
- **動手前先釐清**：收到目標後，若「成功標準/範圍/受眾/優先順序」任一不明，第一步必須輸出 clarify（risk: low），列出 1-3 個結構化釐清問題（格式：問題 + 為什麼需要知道 + 你的預設假設）。系統會暫停等使用者回答；回答後你再視情況繼續 clarify 或直接 plan。目標夠清楚時才直接 plan。
- 這四類屬高風險動作，必須先用 ACTION 申報、交由系統處理（系統會依當前政策決定是否需使用者核可）：dispatch（派工）、external_send（對外發訊息）、destructive（不可逆/破壞）、spend（花錢/交易/安裝）。**嚴禁你自己直接執行這四類**，一律走申報。
- 每完成一步用 next_step 回報；全部達標用 goal_done；缺關鍵資訊用 need_input。
- dispatch 派工的 detail 格式（**每項必須以 "- agentId:" 開頭**，否則系統無法解析）：
  detail:
  - agentId: <子 agent ID>
    mode: consult | execute
    task: <要做什麼，可多行>
    context: <背景，可選>
    accept: <驗收標準，可選>
  - agentId: <另一個 agent>
    mode: consult
    task: <任務>
  ⚠️ 自主模式下派工**同步等待結果**（consult 逾時 5 分鐘、execute 逾時 10 分鐘），
     請將大任務切小，或在計畫中標記「留給使用者互動模式處理」，避免在無人值守迴圈中發超長任務。`;

/** 首回合之後的每步改貼這一行提醒，不重貼完整 PROTOCOL（省 token）。 */
export const PROTOCOL_REMINDER = "（提醒：照自主模式協議回覆，最末尾輸出一個 ACTION 區塊）";

/**
 * 追蹤哪些 runId 在本次程序生命期內已送過完整 PROTOCOL。
 * - startRun 送完 planPrompt 後加入
 * - pauseRunningRunsOnBoot 時移除（下次 resumeRun 需重送）
 * - finalize 時移除（cleanup）
 */
const protocolSentForRun = new Set<string>();

function emitRun(deps: AutonomyDeps, runId: string) {
  const run = getRun(runId);
  if (run) deps.emit(runId, { kind: "run", run });
}

function finalize(deps: AutonomyDeps | undefined, runId: string, status: RunStatus, lastError?: string) {
  updateRunStatus(runId, status, lastError);
  activeDeps.delete(runId);
  protocolSentForRun.delete(runId);
  if (deps) emitRun(deps, runId);
  // 員工化推播：自主 run 結束 → Telegram（未設定 env 時 no-op；fire-and-forget）
  const run = getRun(runId);
  const kindLabel = status === "done" ? "自主任務完成" : status === "budget_exhausted" ? "自主任務預算用盡" : "自主任務失敗";
  void notify({ kind: kindLabel, title: (run?.goal ?? runId).slice(0, 80), body: lastError });
}

function budgetExceeded(run: AutonomyRun, deps: AutonomyDeps): boolean {
  return run.stepCount >= run.maxSteps || deps.now() >= run.deadlineAt;
}

function pickAction(actions: ParsedAction[], prefer?: string): ParsedAction | undefined {
  if (prefer) { const p = actions.find((a) => a.kind === prefer); if (p) return p; }
  return actions[actions.length - 1];
}

export async function startRun(
  sessionId: string, workspaceId: string, goal: string,
  opts: { maxSteps?: number; maxWallMs?: number; policy?: import("./autonomyPolicy.js").PolicyName } = {},
  deps: AutonomyDeps,
): Promise<string> {
  const run = createRun({
    sessionId, workspaceId, goal,
    maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
    maxWallMs: opts.maxWallMs ?? DEFAULT_MAX_WALL_MS,
    startedAt: deps.now(),
    policy: opts.policy ?? "manual",
  });
  activeDeps.set(run.id, deps);
  emitRun(deps, run.id);
  const planPrompt = `${PROTOCOL}\n\n# 目標\n${goal}\n\n請先評估目標是否夠清楚：\n- 若「成功標準/範圍/受眾/優先順序」任一不明 → 先輸出 kind: clarify（risk: low），列出 1-3 個結構化釐清問題（問題 + 為什麼需要知道 + 你的預設假設）。\n- 若目標夠清楚 → 直接輸出 kind: plan（risk: high），把目標拆成可執行的步驟計畫。先不要執行任何步驟。`;
  let out: string;
  try {
    out = await deps.sendTurn(sessionId, planPrompt);
    // Mark full PROTOCOL as sent for this run — loop() will use abbreviated reminder.
    protocolSentForRun.add(run.id);
  } catch (e) {
    finalize(deps, run.id, "error", e instanceof Error ? e.message : String(e));
    return run.id;
  }
  const actions = parseActions(out);
  // 若 PM 先要求釐清，暫停等使用者回答，不直接進入計畫階段
  // 注意：不用 pickAction（無目標 kind 時會 fallthrough 回最後一個），改用 find 精確比對。
  const clarifyAction = actions.find((a) => a.kind === "clarify");
  if (clarifyAction) {
    const pa = createPendingAction({
      runId: run.id, sessionId, workspaceId, kind: "clarify", risk: "low",
      summary: clarifyAction.summary, detail: clarifyAction.detail ?? out.slice(0, 2000),
    });
    updateRunStatus(run.id, "paused_for_input");
    emitRun(deps, run.id);
    deps.emit(run.id, { kind: "pending", action: pa });
    return run.id;
  }
  const plan = pickAction(actions, "plan");
  if (shouldAutoApprove("plan", run.policy)) {
    const planPa = createPendingAction({
      runId: run.id, sessionId, workspaceId, kind: "plan", risk: "high",
      summary: plan?.summary ?? "執行計畫", detail: plan?.detail ?? out.slice(0, 2000),
    });
    decidePendingAction(planPa.id, "approved");
    markActionExecuted(planPa.id, "已自動核可");
    deps.emit(run.id, { kind: "action", action: getPendingAction(planPa.id) });
    updateRunStatus(run.id, "running");
    emitRun(deps, run.id);
    await loop(run.id, deps, "計畫已自動核可，請開始執行第一步。");
    return run.id;
  }
  createPendingAction({
    runId: run.id, sessionId, workspaceId, kind: "plan", risk: "high",
    summary: plan?.summary ?? "執行計畫", detail: plan?.detail ?? out.slice(0, 2000),
  });
  updateRunStatus(run.id, "awaiting_plan_approval");
  emitRun(deps, run.id);
  deps.emit(run.id, { kind: "pending" });
  return run.id;
}

export async function approvePlan(runId: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "awaiting_plan_approval") return;
  updateRunStatus(runId, "running");
  emitRun(deps, runId);
  await loop(runId, deps, "計畫已核可，請開始執行第一步。");
}

/** 執行一個已（自動或人工）核可的 dispatch 動作，回 ok 與要餵回 PM 的結果敘述。 */
async function runDispatchAndNote(
  deps: AutonomyDeps, actionId: string, run: AutonomyRun, detail: string,
): Promise<{ ok: boolean; note: string }> {
  const items = parseActions(`=== ACTION ===\nkind: dispatch\ndetail:\n${detail}\n=== END ACTION ===`)[0]?.dispatchItems ?? [];
  if (!items.length) {
    const errNote = "【派工格式錯誤】未解析到有效的派工項目（每項必須以 `- agentId: xxx` 開頭，且含 `task:` 欄位）。\n請修正 detail 格式後重新申報 dispatch，或改用 next_step 繼續執行。";
    markActionExecuted(actionId, errNote, false);
    return { ok: true, note: errNote };
  }
  try {
    // 傳入 ledger 脈絡（run 的 sessionId 當 pmSessionId、runId）→ 每項派工進台帳＋推播。
    const out = await deps.runDispatch(items, run.workspaceId, { pmSessionId: run.sessionId, runId: run.id });
    markActionExecuted(actionId, out);
    return { ok: true, note: `派工結果：\n${out.slice(0, 4000)}\n請據此用 next_step 繼續。` };
  } catch (e) {
    markActionExecuted(actionId, e instanceof Error ? e.message : String(e), false);
    return { ok: false, note: "" };
  }
}

// 白名單：只認「暫時性」錯誤 → 重試/pause。刻意用窄比對而非寬鬆黑名單。
// - 中文 marker（"逾時"/"持續忙碌"）＝我方 sendTurn 自造的兩個 reject 訊息
//   （routes/autonomy.ts 的 "sendTurn 逾時" 與 "session 持續忙碌，放棄本回合"）；
//   claude CLI stderr 為英文，中文 marker 不會誤撞不可控的原始 stderr。
// - 英文 token 只認明確的 rate-limit/overloaded 訊號；**不得**用裸 "rate"/"busy"
//   （會撞 stderr 裡的 deprecated/accurate/generated 等 → 真失敗被誤判暫時性、
//   疊加 auto-resume 反覆復活）。真錯誤（原始 stderr）一律走 error → finalize。
const TRANSIENT_SEND_PATTERNS = ["逾時", "持續忙碌", "rate limit", "rate_limit", "ratelimit", "429", "overloaded"];
function isTransientSendError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_SEND_PATTERNS.some(p => lower.includes(p));
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as any).unref?.();
  });
}

async function loop(runId: string, deps: AutonomyDeps, firstPrompt: string): Promise<void> {
  let prompt = firstPrompt;
  while (true) {
    let run = getRun(runId);
    if (!run || run.status !== "running") return;
    if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }

    let injectionUsed = false;
    if (run.pendingInjection) {
      prompt = `使用者插話（高優先，請先消化再繼續）：${run.pendingInjection}\n\n${prompt}`;
      injectionUsed = true;
    }

    // 首回合（startRun planPrompt）已送過完整 PROTOCOL；
    // resume 後第一步（protocolSentForRun 無此 runId）重送全文，加入 set；
    // 其餘步驟只帶一行提醒。
    let protocolPart: string;
    if (!protocolSentForRun.has(runId)) {
      protocolPart = PROTOCOL;
      protocolSentForRun.add(runId);
    } else {
      protocolPart = PROTOCOL_REMINDER;
    }
    const fullPrompt = `${protocolPart}\n\n${prompt}`;

    let out!: string;
    {
      // F1: sendTurn retry with exponential backoff for transient errors
      const MAX_SEND_RETRIES = 3;
      let sendSuccess = false;
      let lastError = "";
      for (let attempt = 1; attempt <= MAX_SEND_RETRIES; attempt++) {
        try {
          out = await deps.sendTurn(run.sessionId, fullPrompt);
          sendSuccess = true;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          if (isTransientSendError(lastError) && attempt < MAX_SEND_RETRIES) {
            console.warn(`[autonomy] sendTurn transient error (attempt ${attempt}/${MAX_SEND_RETRIES}): ${lastError}`);
            await sleepMs(100 * Math.pow(2, attempt - 1));
            // Re-read run in case it was stopped during backoff
            const stillRunning = getRun(runId);
            if (!stillRunning || stillRunning.status !== "running") return;
            continue;
          }
          if (isTransientSendError(lastError)) {
            // Exhausted retries on transient error → pause
            console.warn(`[autonomy] sendTurn exhausted retries, pausing run ${runId}`);
            updateRunStatus(runId, "paused", lastError);
            activeDeps.delete(runId);
            emitRun(deps, runId);
            return;
          }
          // Real error → finalize
          finalize(deps, runId, "error", lastError);
          return;
        }
      }
      if (!sendSuccess) return;
      // F11: clear injection ONLY after successful sendTurn
      if (injectionUsed) clearPendingInjection(runId);
    }
    // K1：sendTurn 期間可能被 stop/pause，重讀確認仍可推進
    run = getRun(runId);
    if (!run || run.status !== "running") return;
    if (!out) { finalize(deps, runId, "error", "session 消失（sendTurn 回空字串）"); return; }
    incrementStep(runId);
    const action = pickAction(parseActions(out));

    if (!action || action.kind === "next_step") {
      run = getRun(runId)!;
      if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }
      prompt = "請繼續執行下一步，朝目標推進。";
      continue;
    }
    if (action.kind === "goal_done") { finalize(deps, runId, "done"); return; }
    if (action.kind === "need_input" || action.kind === "clarify") {
      const pa = createPendingAction({ runId, sessionId: run.sessionId, workspaceId: run.workspaceId, kind: action.kind, risk: "low", summary: action.summary, detail: action.detail });
      updateRunStatus(runId, "paused_for_input"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
      void notify({ kind: "等你回覆", title: action.summary.slice(0, 80), body: (action.detail ?? "").slice(0, 300) });
      return;
    }
    // 政策：自動放行的 kind 直接執行並續跑；其餘照舊建待批卡並暫停。
    // B2 安全閘：balanced 下，dispatch 若含任一 execute item → 轉待批（不自動放行）。
    if (budgetExceeded(run, deps)) { finalize(deps, runId, "budget_exhausted"); return; }
    const hasExecuteItem = action.kind === "dispatch" &&
      (action.dispatchItems ?? []).some((item) => item.mode === "execute");
    if (shouldAutoApprove(action.kind, run.policy, { hasExecute: hasExecuteItem })) {
      const pa = createPendingAction({
        runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
        kind: action.kind, risk: "high", summary: action.summary, detail: action.detail,
      });
      decidePendingAction(pa.id, "approved");
      let note = "（已自動執行，請用 next_step 回報結果）";
      if (action.kind === "dispatch") {
        const r = await runDispatchAndNote(deps, pa.id, run, action.detail ?? "");
        if (!r.ok) { finalize(deps, runId, "error", "自動派工失敗"); return; }
        note = r.note;
      } else {
        markActionExecuted(pa.id, "已自動核可");
      }
      deps.emit(runId, { kind: "action", action: getPendingAction(pa.id) });
      const cur = getRun(runId);
      if (!cur || cur.status !== "running") return; // 期間被 stop
      prompt = note;
      continue;
    }
    // 待批 summary：若為 balanced + dispatch 含 execute，標明原因讓使用者明白為何自走模式來問
    const pendingSummary = (hasExecuteItem && run.policy === "balanced")
      ? `${action.summary}（含 execute 派工，自走模式下仍需你批准）`
      : action.summary;
    const pa = createPendingAction({
      runId, sessionId: run.sessionId, workspaceId: run.workspaceId,
      kind: action.kind, risk: "high", summary: pendingSummary, detail: action.detail,
    });
    updateRunStatus(runId, "paused_for_action"); emitRun(deps, runId); deps.emit(runId, { kind: "pending", action: pa });
    void notify({ kind: "待批", title: pendingSummary.slice(0, 80), body: (action.detail ?? "").slice(0, 300) });
    return;
  }
}

export async function approveAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  const run = getRun(pa.runId);
  if (!deps || !run || run.status !== "paused_for_action") return;
  decidePendingAction(actionId, "approved");
  let resultNote = "（已核可，請執行並用 next_step 回報結果）";
  if (pa.kind === "dispatch") {
    const r = await runDispatchAndNote(deps, actionId, run, pa.detail ?? "");
    if (!r.ok) { finalize(deps, pa.runId, "error", "派工失敗"); return; }
    resultNote = r.note;
  } else {
    markActionExecuted(actionId, "已核可");
  }
  // K1：runDispatch 期間可能被 stop；重讀確認仍是 paused_for_action 才續行
  const cur = getRun(pa.runId);
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  if (!cur || cur.status !== "paused_for_action") return;
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, resultNote);
}

export async function rejectAction(actionId: string): Promise<void> {
  const pa = getPendingAction(actionId);
  if (!pa || !pa.runId || pa.status !== "pending") return;
  const deps = activeDeps.get(pa.runId);
  const run = getRun(pa.runId);
  if (!deps || !run || run.status !== "paused_for_action") return;
  decidePendingAction(actionId, "rejected");
  deps.emit(pa.runId, { kind: "action", action: getPendingAction(actionId) });
  updateRunStatus(pa.runId, "running"); emitRun(deps, pa.runId);
  await loop(pa.runId, deps, `你剛申報的動作「${pa.summary}」被拒絕，請改用替代方案，或若無替代則用 goal_done 收尾並說明。`);
}

export async function provideInput(runId: string, text: string): Promise<void> {
  const run = getRun(runId);
  const deps = activeDeps.get(runId);
  if (!run || !deps || run.status !== "paused_for_input") return;
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, `使用者補充資訊：${text}\n請據此繼續。`);
}

export async function stopRun(runId: string): Promise<void> {
  const deps = activeDeps.get(runId);
  finalize(deps, runId, "stopped");
}

export function pauseRunningRunsOnBoot(listActiveRunsFn: () => AutonomyRun[]): number {
  const active = listActiveRunsFn();
  for (const r of active) {
    updateRunStatus(r.id, "paused");
    supersedePendingForRun(r.id);
    // Clear protocol-sent flag so resumeRun re-sends full PROTOCOL (new process context).
    protocolSentForRun.delete(r.id);
  }
  return active.length;
}

export async function resumeRun(runId: string, deps: AutonomyDeps): Promise<void> {
  const run = getRun(runId);
  if (!run || (run.status !== "paused" && run.status !== "error")) return;
  const MAX_RESUME = parseInt(process.env.AUTONOMY_MAX_RESUME ?? "5");
  if (run.resumeCount >= MAX_RESUME) {
    console.warn(`[autonomy] resumeRun ${runId} hit resume_count cap (${run.resumeCount}), staying paused`);
    return;
  }
  incrementResumeCount(runId);
  activeDeps.set(runId, deps);
  updateRunStatus(runId, "running"); emitRun(deps, runId);
  await loop(runId, deps, "（已從中斷處恢復）請接續朝目標執行下一步。");
}

export async function autoResumeOnBoot(
  listPausedFn: () => AutonomyRun[],
  makeDepsForRun: (run: AutonomyRun) => AutonomyDeps,
  now = Date.now(),
): Promise<number> {
  if (process.env.AUTONOMY_AUTO_RESUME !== "true") return 0;
  const maxResume = parseInt(process.env.AUTONOMY_MAX_RESUME ?? "5");
  const paused = listPausedFn().filter(r => r.status === "paused" && r.resumeCount < maxResume);
  let count = 0;
  for (const run of paused) {
    const downtime = now - run.updatedAt;
    if (downtime > 0) extendDeadlineBy(run.id, downtime);
    // fire-and-forget（對齊 routes/autonomy.ts resume route 慣例）：各 paused run 並發恢復、
    // 各自跑到終態。**不** await 整個 loop——否則多個 paused run 會序列跑到完（run2 得等
    // run1 整個結束才恢復），失去並發自走。每 run 獨立 catch：單一 resume 拋錯不影響其餘。
    void resumeRun(run.id, makeDepsForRun(run)).catch((e: any) =>
      console.warn(`[autonomy] autoResumeOnBoot resume ${run.id} 失敗:`, e?.message || e));
    count++;
  }
  return count;
}
