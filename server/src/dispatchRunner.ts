import { agentManager } from "./agentManager.js";
import { turnMatches } from "./agentSession.js";
import { withBackgroundSlot, markShadow } from "./backgroundLimiter.js";
import type { DispatchItem } from "./dispatchParser.js";
import { createActivityDeadline, positiveMsFromEnv, minutesLabel, type DeadlineReason } from "./activityDeadline.js";
import { clipMiddle } from "./textClip.js";
import {
  ledgerBegin, ledgerFinish, defaultLedgerDeps,
  type DispatchLedgerContext, type DispatchLedgerDeps,
} from "./dispatchLedger.js";

export type { DispatchLedgerContext, DispatchLedgerDeps };

/**
 * 組合結構化交辦簡報（Brief）送給子 agent。
 * - 無選填欄位（無 context/deliverable/accept）→ 回 item.task，向後完全相容。
 * - 有任一選填欄位 → 組成帶段落標題的完整簡報，讓子 agent 清楚背景、交付物與驗收標準。
 */
export function buildDispatchBrief(item: DispatchItem): string {
  const hasExtras =
    item.context != null ||
    item.deliverable != null ||
    (item.accept != null && item.accept.length > 0);
  if (!hasExtras) return item.task;

  const lines: string[] = [item.task, ""];
  if (item.context) lines.push(`【背景】${item.context}`);
  if (item.deliverable) lines.push(`【交付物】${item.deliverable}`);
  if (item.accept && item.accept.length > 0) {
    lines.push(`【驗收標準】`);
    for (const a of item.accept) {
      lines.push(`- ${a}`);
    }
  }
  return lines.join("\n");
}

export interface ConsultResult {
  agentId: string;
  task: string;
  output: string;
  status: "ok" | "timeout" | "error";
  subSessionId: string;   // 受派子 session id —— 供前端「開啟對話」深聊
  attempts?: number;      // 實際嘗試次數（含重試）；未走重試包裝時 undefined
}

export const TIMEOUT_OUTPUT_HEADER = "【逾時・以下是未完成的過程訊息，不是結論】";

/**
 * 逾時時的「部分內容」組裝。
 *
 * 起因（真實事故）：agentic 子代理在同一回合內會吐多則 assistant 訊息——查資料、換來源、
 * 改策略的過程旁白，最後一則才是結論。舊版把 message 事件寫成 `collected = content`（覆寫），
 * 逾時那刻手上只剩「最後一則過程旁白」，例如「我先確認 lpaudio 資料夾位置」。它讀起來像人話，
 * 於是 PM 把碎念當結論整合給使用者——比空白更騙人。
 *
 * 這裡改為回傳「整段過程 + 明確的未完成標示」：資訊不丟，且 PM 一眼看得出這不是可用數據。
 */
export function buildTimeoutOutput(messages: string[], streamed: string): string {
  const body = messages.length > 0 ? messages.join("\n\n") : streamed.trim();
  if (!body) return "【逾時・未取得任何內容】這位同事在時限內沒有產出任何內容。";
  return `${TIMEOUT_OUTPUT_HEADER}\n這位同事還沒給出最終結論就超過時限。下列是他工作中的過程記錄，**不可當成結論採用**；若稍後補報進來，一律以補報內容為準。\n\n${body}`;
}

/**
 * Claude 訂閱額度用盡時，CLI 會把「You've hit your session limit · resets 9pm」當成回覆內容吐出來。
 * 起因（實測 2026-08-11）：兩筆外包的「結果」就是這行字，卻被記成 done、當成完成報告轉給 PM。
 * 只認短訊息（真正的報告不會短到只剩這行），避免報告內文剛好提到額度而誤判。
 */
const USAGE_LIMIT_RE = /hit your (?:session|weekly|daily|usage|monthly) limit|usage limit reached|session limit\s*·\s*resets/i;
export function isUsageLimitText(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length < 400 && USAGE_LIMIT_RE.test(t);
}

/**
 * 外包（execute）回合結束時判定成敗：沒內容、CLI 標 is_error、或內容其實是額度用盡通知 → 失敗。
 * consult 不套 is_error（有內容的 is_error 回合仍可能是有用的分析，且 consult 的 error 會觸發重開重跑）。
 */
export function executeResultOk(payload: any, text: string): boolean {
  if (!text.trim()) return false;
  if (payload && payload.is_error === true) return false;
  return !isUsageLimitText(text);
}

/** consult 回合結束時的狀態：沒內容或額度用盡 → error，其餘 ok。 */
function consultResultStatus(text: string): "ok" | "error" {
  return text.trim() && !isUsageLimitText(text) ? "ok" : "error";
}

// ── 外包的自動續跑（無人值守時「回合結束 ≠ 任務完成」）────────────────────────
// Anthropic 對 Opus 5.5 的說明：長任務中模型會主動回報進度，有些回報以文字結束回合；無人值守的
// 迴圈若把這種回合當成任務結束就會停在半途。建議把它當「進度回報」，在完成條件未達成時送一則
// 簡短的續跑訊息，並把自動續跑限制在 2-3 次。外包的完成條件很明確：buildExecutePrompt 要求回報
// 最後附【完成自驗】——沒有它，代表任務多半還沒做完。
/** 外包回報必附的自驗區塊標記。 */
export const SELF_CHECK_MARKER = "【完成自驗】";
/** 同一個外包任務最多自動續跑幾次。 */
export const EXECUTE_MAX_CONTINUATIONS = 2;
/** 續跑訊息（沿用官方範例的寫法：點出還缺什麼、請它繼續、被卡住就說明）。 */
export const EXECUTE_CONTINUE_PROMPT = "你的回報裡還沒有【完成自驗】區塊，所以系統判斷這個外包任務可能還沒做完——也許你回報了進度、宣布了下一步，回合就結束了。請直接接著把剩下的部分做完；如果某一步被卡住，說明卡在哪裡、缺什麼。全部做完（或確定做不完）時，照原本的格式在最後附上【完成自驗】。";

/** 回合結束時是否該自動續跑：結果算成功（有內容、非 is_error、非額度通知）、還沒附自驗、次數未滿。 */
export function shouldContinueExecute(payload: any, text: string, continuations: number): boolean {
  if (continuations >= EXECUTE_MAX_CONTINUATIONS) return false;
  if (!executeResultOk(payload, text)) return false; // 失敗的回合續跑也沒用，照實回報
  return !text.includes(SELF_CHECK_MARKER);
}

/** 續跑用完仍沒附自驗時，附在回報後面提醒 PM。 */
function noSelfCheckNote(continuations: number): string {
  return `\n\n（系統備註：自動續跑 ${continuations} 次後仍未附【完成自驗】，請視為「未驗證」，必要時退回重做。）`;
}

// ── 外包執行的逾時：看「活動」而不是固定牆鐘 ────────────────────────────────
// 舊版：單項外包固定 30 分鐘硬砍。實測（2026-08-11）8 筆外包有 3 筆在第 30 分鐘被判失敗，
// 最後一則訊息分別是「資料齊了。開始寫報告。」「兩份報告的結論…我把交叉核對寫進報告。」
// 「已查完。寫入報告檔案：」——都在收尾，不是卡住。新模型做得更徹底、單項更久，
// 固定牆鐘只會砍掉更多快做完的工作。改成：連續 idle 沒有任何活動（吐字/呼叫工具/工具結果）
// 才判定卡住；另有絕對上限防失控。兩者可用環境變數調整（呼叫時才讀，.env.local 吃得到）。
export const EXECUTE_IDLE_MS_DEFAULT = 15 * 60 * 1000;
export const EXECUTE_HARD_MAX_MS_DEFAULT = 120 * 60 * 1000;
/** 自主迴圈裡同步等待的 execute：迴圈在等、run 本身也有牆鐘預算，絕對上限較短。 */
export const EXECUTE_SYNC_HARD_MAX_MS = 45 * 60 * 1000;

export interface ExecuteLimits { idleMs: number; hardMs: number }

/** 非同步外包的逾時設定：DISPATCH_EXECUTE_IDLE_MS（預設 15 分鐘）、DISPATCH_EXECUTE_MAX_MS（預設 120 分鐘）。 */
export function executeLimits(env: Record<string, string | undefined> = process.env): ExecuteLimits {
  const idleMs = positiveMsFromEnv(env.DISPATCH_EXECUTE_IDLE_MS, EXECUTE_IDLE_MS_DEFAULT);
  const hardMs = Math.max(idleMs, positiveMsFromEnv(env.DISPATCH_EXECUTE_MAX_MS, EXECUTE_HARD_MAX_MS_DEFAULT));
  return { idleMs, hardMs };
}

/** 外包被判定卡住/超過上限而中止時，附在過程記錄後面給 PM 的說明。 */
export function executeAbortNote(reason: DeadlineReason, limits: ExecuteLimits): string {
  const why = reason === "idle"
    ? `子代理連續 ${minutesLabel(limits.idleMs)}沒有任何活動，判定卡住`
    : `已達單項外包 ${minutesLabel(limits.hardMs)}的絕對上限`;
  return `【已中止，未完成】${why}，子代理已停止。本任務未完成，請勿原封不動重派相同任務；需要續做就把範圍切小、說清楚從哪裡接手，或改由使用者互動處理。`;
}

/** 子程序在交出結果前就結束（crash / 被停止）時的回報。 */
function endedEarlyOutput(messages: string[], streamed: string, status: unknown): string {
  const body = messages.length > 0 ? messages.join("\n\n") : streamed.trim();
  const why = status === "error" ? "異常結束" : "被停止";
  return `【未完成・子代理在交出結果前就${why}了】下列是它停止前的過程記錄，**不可當成結論採用**。\n\n${body || "（沒有任何內容）"}`;
}

/** 派工同步路徑（consult / execute-sync）對 agentManager 的最小依賴面，供測試注入 fake session/EventEmitter。 */
type ManagedSession = {
  id: string;
  on: (event: "event", cb: (evt: any) => void) => void;
  removeListener: (event: "event", cb: (evt: any) => void) => void;
  /** 終止子程序（AgentSession.stop）。外包逾時中止時使用；舊/假 session 可能沒有。 */
  stop?: () => void;
};
export interface DispatchSessionDeps {
  /** 開一個受管子 session（帶工作區脈絡/記憶/MCP），回傳可監聽的 session。 */
  start: (agentId: string, title: string, workspaceId: string) => ManagedSession;
  /** 送出訊息，回傳本回合 turnId（用於只認自己那回合的 result）。 */
  send: (sessionId: string, text: string) => { turnId?: number };
  /** 拿到 result 後回收子程序（預設綁 agentManager.reclaimSubprocess）。 */
  reclaim: (sessionId: string) => void;
  /** F3: 強制終止子程序（execute 逾時時呼叫）。 */
  kill?: (sessionId: string) => void;
}

/** 預設依賴：真開受管子 session、真送、真回收、真終止。 */
const defaultDispatchSessionDeps: DispatchSessionDeps = {
  // unattended：派工子代理沒有人即時回覆，system prompt 會帶無人值守收尾規則（見 agentManager.StartOpts）。
  start: (agentId, title, workspaceId) => agentManager.start(agentId, title, undefined, workspaceId, false, "claude", undefined, { unattended: true }),
  send: (sessionId, text) => ({ turnId: agentManager.send(sessionId, text).turnId }),
  reclaim: (sessionId) => { agentManager.reclaimSubprocess(sessionId); },
  kill: (sessionId) => { agentManager.get(sessionId)?.stop(); },
};

/** 保序、限制同時併發數的 map。fn 自行處理錯誤（回傳值代表結果）。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 真正跑一個 consult 項：開受管子 session（帶工作區脈絡/記憶/MCP），收 final 回覆。 */
export async function runOneConsult(
  item: DispatchItem,
  workspaceId: string,
  perItemTimeoutMs: number,
  deps: DispatchSessionDeps = defaultDispatchSessionDeps,
): Promise<ConsultResult> {
  // 背景總量限流：搶到槽才真正開 session/送出打 API；槽持有到本回合 finish()
  // （拿到 result / 逾時 / 錯誤）才 release。這是全域再加一層總量控制，與
  // mapWithConcurrency 的 per-batch 併發疊加，以更緊者為準。
  return withBackgroundSlot(() => new Promise<ConsultResult>((resolve) => {
    // enableAutoFork=false：子諮詢不該再外掛 FORK 能力。
    const session = deps.start(item.agentId, `🤝 受派諮詢：${item.task.slice(0, 24)}`, workspaceId);
    let collected = "";        // 最後一則 message＝拿到 result 時的權威結論
    const messages: string[] = []; // 本回合所有 message（含過程旁白）——逾時救援用，見 buildTimeoutOutput
    let streamed = "";        // 累積的 delta 串流——連 message 都沒有時的最後退路
    let settled = false;
    let myTurnId: number | undefined; // 本回合 turnId：只認自己那回合的 result
    const finish = (status: ConsultResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener("event", onEvent);
      // 正常完成 → 最後一則 message 就是結論。
      // 逾時 → 交給 buildTimeoutOutput 帶回完整過程並標示「這不是結論」（真答案走遲到補報）。
      const output = status === "timeout"
        ? buildTimeoutOutput(messages, streamed)
        : (collected || streamed).trim();
      resolve({ agentId: item.agentId, task: item.task, output, status, subSessionId: session.id });
      // 收到 result 的 finish（非逾時）→ 立即回收子程序，不必等 idle TTL。
      // 用 queueMicrotask 延後：確保同一 result 事件的所有監聽器先處理完、
      // session status 已轉 idle，reclaim 才對它動手。逾時路徑不回收（子 agent 還在跑，
      // 而且我們要留它跑完——遲到補報靠它，見 attachLateConsults）。
      if (status !== "timeout") queueMicrotask(() => deps.reclaim(session.id));
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") { if (turnMatches(myTurnId, evt.turnId)) streamed += evt.payload; }
      else if (evt.type === "message" && evt.payload?.content) { if (turnMatches(myTurnId, evt.turnId)) { collected = String(evt.payload.content); messages.push(collected); } }
      else if (evt.type === "result") { if (turnMatches(myTurnId, evt.turnId)) finish(consultResultStatus(collected || streamed)); }
      else if (evt.type === "status" && (evt.payload === "error" || evt.payload === "closed")) { finish("error"); }
    };
    // 逾時：若已串流到部分內容，仍回 timeout 狀態但帶回那段內容（不再是空白）。
    const timer = setTimeout(() => {
      // consult 逾時不殺子程序（交 idle TTL 收）→ 是真正的 shadow，標記待回收時解除。
      markShadow(session.id);
      finish("timeout");
    }, perItemTimeoutMs);
    session.on("event", onEvent);
    myTurnId = deps.send(session.id, buildDispatchBrief(item)).turnId;
  }), { label: `consult:${item.agentId}` });
}

// ====================== 失敗自癒（同步派工重試）======================

export interface RetryOpts { maxAttempts?: number }

/**
 * 同步派工的失敗自癒包裝。
 *
 * 策略（刻意保守）：
 * - `error`（有回合但無輸出，或 runOne 直接拋錯如 spawn 失敗）→ 重試，最多 maxAttempts 次。
 *   error 幾乎等於「什麼都沒發生」，重開全新 session 再跑一次安全且便宜。
 * - `timeout` **不重試**：時間預算已耗盡（自主迴圈裡重試會讓牆鐘時間翻倍），且逾時路徑
 *   已有「部分輸出救回」機制，重試反而丟掉已到手的內容。
 * - runOne 拋錯絕不往上炸——轉成 error 結果。修掉原本 spawn 失敗會 reject 整批派工的問題。
 * - async execute（startExecute）不套這層：該路徑失敗時 PM 會被指示「退回重做」，屬 LLM 層
 *   重試；有副作用的任務再疊機械重試會有重複執行風險。
 */
export async function runOneWithRetry(
  runOne: RunOneFn,
  item: DispatchItem,
  workspaceId: string,
  timeoutMs: number,
  opts: RetryOpts = {},
): Promise<ConsultResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  let last: ConsultResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await runOne(item, workspaceId, timeoutMs);
    } catch (e: any) {
      last = {
        agentId: item.agentId, task: item.task,
        output: `派工執行拋錯：${e?.message || String(e)}`,
        status: "error", subSessionId: "",
      };
    }
    if (last.status !== "error") return { ...last, attempts: attempt };
    if (attempt < maxAttempts) {
      console.warn(`[dispatchRunner] ${item.agentId} 第 ${attempt} 次失敗（error），自動重試…`);
    }
  }
  return { ...last!, attempts: maxAttempts };
}

/** 並行（限流）跑所有 consult 項，回每項原始輸出（含逾時/錯誤標記）。error 項自動重試一次。 */
export async function runConsult(
  items: DispatchItem[],
  workspaceId: string,
  opts: { concurrency: number; perItemTimeoutMs: number },
  runOne: (item: DispatchItem, workspaceId: string, timeoutMs: number) => Promise<ConsultResult> = runOneConsult,
): Promise<ConsultResult[]> {
  return mapWithConcurrency(items, opts.concurrency, (it) =>
    runOneWithRetry(runOne, it, workspaceId, opts.perItemTimeoutMs));
}

/**
 * 同步等待的 execute 項 runOne：使用 buildExecutePrompt 包裝提示，確保子 agent 回報自驗證據。
 * 與 runOneConsult 的差異：prompt 附「完成自驗」要求，適用 execute 語意的派工。
 * 在自主迴圈中使用（不 fire-and-forget），避免非同步回報插進同步迴圈的 race。
 */
export async function runOneExecuteAsConsult(
  item: DispatchItem,
  workspaceId: string,
  perItemTimeoutMs: number,
  deps: DispatchSessionDeps = defaultDispatchSessionDeps,
): Promise<ConsultResult> {
  // 背景總量限流：同 runOneConsult，搶到槽才送、槽持有到本回合結束才 release。
  return withBackgroundSlot(() => new Promise<ConsultResult>((resolve) => {
    const session = deps.start(item.agentId, `🛠️ 外包執行（同步）：${item.task.slice(0, 24)}`, workspaceId);
    let collected = "", streamed = "", settled = false;
    const messages: string[] = []; // 同 runOneConsult：逾時要帶回完整過程，不能只剩最後一則旁白
    let myTurnId: number | undefined; // 本回合 turnId：只認自己那回合的 result
    let continuations = 0; // 已自動續跑次數（見 shouldContinueExecute）
    // 看活動的逾時：perItemTimeoutMs 是「連續沒動靜」的上限；一直有進展就繼續等，
    // 但不超過 EXECUTE_SYNC_HARD_MAX_MS（自主迴圈在等，run 也有牆鐘預算）。
    const limits: ExecuteLimits = { idleMs: perItemTimeoutMs, hardMs: Math.max(perItemTimeoutMs, EXECUTE_SYNC_HARD_MAX_MS) };
    let timeoutReason: DeadlineReason = "idle";
    const finish = (status: ConsultResult["status"], override?: string) => {
      if (settled) return;
      settled = true;
      deadline.clear();
      session.removeListener("event", onEvent);
      // F3: 逾時時加上中止說明，讓 PM 知道任務未完成且不應重派。
      // execute 逾時會殺子程序（無遲到補報可救），故過程訊息更要完整帶回。
      const output = override ?? (status === "timeout"
        ? `${buildTimeoutOutput(messages, streamed)}\n\n${executeAbortNote(timeoutReason, limits)}`
        : (collected || streamed).trim());
      resolve({ agentId: item.agentId, task: item.task, output, status, subSessionId: session.id });
      // 同 runOneConsult：result 的 finish（非逾時）→ 延後回收子程序；逾時不回收。
      if (status !== "timeout") queueMicrotask(() => deps.reclaim(session.id));
    };
    const onEvent = (evt: any) => {
      deadline.touch(); // 任何事件都算「還在動」
      if (evt.type === "delta" && typeof evt.payload === "string") { if (turnMatches(myTurnId, evt.turnId)) streamed += evt.payload; }
      else if (evt.type === "message" && evt.payload?.content) { if (turnMatches(myTurnId, evt.turnId)) { collected = String(evt.payload.content); messages.push(collected); } }
      else if (evt.type === "result") {
        if (!turnMatches(myTurnId, evt.turnId)) return;
        const out = (collected || streamed).trim();
        if (shouldContinueExecute(evt.payload, out, continuations)) {
          // 回合結束但還沒附自驗 → 當成進度回報，送續跑訊息（同一個子 session，新回合）。
          continuations++;
          streamed = "";
          myTurnId = deps.send(session.id, EXECUTE_CONTINUE_PROMPT).turnId;
          return;
        }
        const ok = executeResultOk(evt.payload, out);
        finish(ok ? "ok" : "error", ok && !out.includes(SELF_CHECK_MARKER) ? out + noSelfCheckNote(continuations) : undefined);
      }
      else if (evt.type === "status" && (evt.payload === "error" || evt.payload === "closed")) { finish("error", endedEarlyOutput(messages, streamed, evt.payload)); }
    };
    const deadline = createActivityDeadline({
      ...limits,
      onExpire: (reason) => {
        timeoutReason = reason;
        // F3: execute 逾時直接殺子程序（語意誠實、避免重複副作用）。
        // 殺掉＝不是 shadow（shadow 專指「未殺、仍存活」），故不 markShadow。
        // 先 finish（移除監聽）再殺：殺程序會同步發出 status closed，不能讓它蓋掉逾時說明。
        finish("timeout");
        deps.kill?.(session.id);
      },
    });
    session.on("event", onEvent);
    myTurnId = deps.send(session.id, buildExecutePrompt(buildDispatchBrief(item))).turnId;
  }), { label: `execute-sync:${item.agentId}` });
}

type RunOneFn = (item: DispatchItem, workspaceId: string, timeoutMs: number) => Promise<ConsultResult>;

/**
 * 自主迴圈的 mode-aware 派工執行器。
 * - consult 項：同步等 consultTimeoutMs（預設 5 分鐘），用純諮詢 prompt。
 * - execute 項：同步等 executeTimeoutMs（預設 10 分鐘），用「完成自驗」包裝 prompt。
 *
 * 兩種 mode 均同步等待結果（不 fire-and-forget），確保自主迴圈能拿到真實結果繼續推進，
 * 且不引入非同步回報插進同步迴圈的 race 問題。
 */
export async function runDispatchByMode(
  items: DispatchItem[],
  workspaceId: string,
  opts: { concurrency: number; consultTimeoutMs: number; executeTimeoutMs: number },
  runOneConsultFn: RunOneFn = runOneConsult,
  runOneExecuteFn: RunOneFn = runOneExecuteAsConsult,
  ctx?: DispatchLedgerContext,
  ledger: DispatchLedgerDeps = defaultLedgerDeps,
): Promise<string> {
  const results = await mapWithConcurrency(items, opts.concurrency, (item) => {
    // consult 才機械重試（純諮詢無副作用，error=零輸出重開新 session 試一次）。
    // execute 刻意不重試：有副作用的任務「零輸出的 error」不代表沒做事，
    // 機械重跑可能重複執行（重複上架/發文/下單）。execute 失敗交給 PM 層
    // 判斷（收到失敗回報後決定退回重做），與非同步 execute 路徑的邊界一致。
    const run = item.mode === "execute"
      ? () => runOneWithRetry(runOneExecuteFn, item, workspaceId, opts.executeTimeoutMs, { maxAttempts: 1 })
      : () => runOneWithRetry(runOneConsultFn, item, workspaceId, opts.consultTimeoutMs);
    return runItemWithLedger(item, ctx, ledger, run);
  });
  // 回饋給自主迴圈的派工結果：每項公平分配額度、保頭尾（舊版由呼叫端整包 slice(0, 4000)，
  // 3 項派工時後面的同事整段消失、每份只剩開頭；結論與【完成自驗】通常在最後）。
  const per = Math.max(2_000, Math.floor(DISPATCH_RESULT_TOTAL / Math.max(1, results.length)));
  return results.map((r) => {
    const body = r.output || "（無回覆）";
    const clipped = [...body].length > per ? `${clipMiddle(body, per, 0.4)}\n…（完整內容見該同事的子對話）` : body;
    return `### ${r.agentId}（${r.status}）\n${clipped}`;
  }).join("\n\n");
}

/** runDispatchByMode 回傳文字（餵回自主迴圈 PM）的總量上限。 */
export const DISPATCH_RESULT_TOTAL = 24_000;

/**
 * 用台帳/推播包裝一項（含重試）派工：開始建 delegation → 跑（重試在內）→ 結束記最終結果＋推播。
 * - ctx 為 undefined → 完全不記帳、不推播（直接跑），向後相容既有呼叫端與測試。
 * - 記帳以「一個 dispatch 項」為單位（一筆 delegation）；重試不另開新筆，finish 記最終結果，
 *   subSessionId 記最後一次嘗試的（來自最終 result）。
 */
async function runItemWithLedger(
  item: DispatchItem,
  ctx: DispatchLedgerContext | undefined,
  ledger: DispatchLedgerDeps,
  run: () => Promise<ConsultResult>,
): Promise<ConsultResult> {
  if (!ctx) return run(); // 無脈絡 → 不記帳（含不推播）
  const delegId = ledgerBegin(ctx, item, ledger);
  const result = await run();
  ledgerFinish(
    delegId, item,
    { ok: result.status === "ok", output: result.output, subSessionId: result.subSessionId },
    ledger,
  );
  return result;
}

// ====================== execute（非同步外包執行，切片②）======================

export interface ExecuteHandle { subSessionId: string; agentId: string; }
export interface ExecuteDone {
  pmSessionId: string;
  agentId: string;
  subSessionId: string;
  output: string;
  status: "ok" | "error";
}
export interface ExecuteDeps {
  start: (item: DispatchItem, workspaceId: string) => string;
  attachDone: (subSessionId: string, cb: (output: string, ok: boolean) => void) => void;
}

/**
 * 外包執行的指令包裝：在原任務後追加「完成自驗 + 證據」要求。
 *
 * 起因：execute 是非同步、無人值守的背景執行，做完沒有人即時盯著。若不強制
 * 自驗附證據，最常見的失敗是 agent「說做完、其實沒做好」，而 PM 只會照單轉達。
 * 這段把「交辦出去的事可信」這條鏈補起來——回報必含可檢查的證據，禁止無驗證的
 * 「應該沒問題」。只用於 execute（外包）；consult 是同步顧問、使用者當場會看，不套。
 */
export function buildExecutePrompt(task: string): string {
  return `${task}

---
⚠️ 這是「外包執行」任務，完成後沒有人會即時盯著，你必須自己把關。回報的最後務必附上一段【完成自驗】，格式如下，不可省略：

【完成自驗】
- 我做了什麼：（具體、可檢查的動作，不要含糊）
- 怎麼確認有效：（實際驗證方式——跑了什麼命令／打開哪個頁面／比對什麼結果）
- 證據：（命令輸出、檔案路徑、截圖、連結等；真的沒有就明說「無客觀證據」）
- 還沒把握／未完成：（誠實列出；沒有就寫「無」）
- 結論：已驗證完成 ／ 部分完成（說明） ／ 未完成（說明）

規則：禁用「應該沒問題」「大概可以」「看起來沒問題」這類沒驗證的措辭；沒有實際驗證就標「未驗證」，不要假裝完成。`;
}

/** execute 非同步路徑對 agentManager 的最小依賴面，供測試注入 fake session/EventEmitter。 */
interface ExecuteAgentManager {
  start: (
    agentId: string, title: string, extra: undefined, workspaceId: string, enableAutoFork: boolean,
    provider?: "claude", projectId?: undefined, opts?: { unattended?: boolean },
  ) => ManagedSession;
  send: (sessionId: string, text: string) => unknown;
  get: (sessionId: string) => ManagedSession | undefined;
  reclaimSubprocess: (sessionId: string) => boolean;
}

/**
 * 用給定的 agentManager-like 造出 execute（非同步外包）預設依賴。
 * 抽成工廠讓測試能注入 fake session/EventEmitter 驗回收與監聽順序，正式碼綁真 agentManager。
 */
export function makeExecuteDeps(
  am: ExecuteAgentManager,
  limitsFn: () => ExecuteLimits = executeLimits,
): ExecuteDeps {
  // 每個外包子 session 的派送階段：queued（等背景槽）→ sent（已送出）。attachDone 逾時放棄時
  // 若還在 queued，標成 abandoned——之後搶到槽也不再送出，避免「已回報 PM 失敗」才真的開工。
  const phase = new Map<string, "queued" | "sent" | "abandoned">();
  // 正在自動續跑的子 session：attachDone 判定要續跑時加入，槽持有者看到就不釋放槽、不回收子程序。
  const continuing = new Set<string>();
  return {
    start: (item, workspaceId) => {
      const s = am.start(item.agentId, `🛠️ 外包執行：${item.task.slice(0, 24)}`, undefined, workspaceId, false, "claude", undefined, { unattended: true });
      phase.set(s.id, "queued");
      // startExecute 原本「無上限」——每項立即 send 打 API，是撞爆限流的主嫌。
      // 這裡把「送出 + 等本回合結束」包進背景槽：session 立即建立（同步回傳 subSessionId
      // 給 UI 連結），但真正 send 延到搶到槽才發，槽持有到 result/逾時才 release。
      // send 延到槽內（下一個 microtask 起），故 startExecute 隨後同步呼叫的 attachDone
      // 監聽器一定先於 send 掛上，不漏事件。
      void withBackgroundSlot(() => new Promise<void>((releaseSlot) => {
        if (phase.get(s.id) === "abandoned") { phase.delete(s.id); releaseSlot(); return; }
        phase.set(s.id, "sent");
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          slotDeadline.clear();
          s.removeListener("event", onSlotEvent);
          phase.delete(s.id);
          releaseSlot();
        };
        const onSlotEvent = (evt: any) => {
          if (evt.type === "result" && continuing.has(s.id)) {
            // attachDone 已送出續跑訊息（它的監聽器先註冊、先收到這個 result）→ 任務還沒完，槽繼續持有。
            slotDeadline.touch();
          } else if (evt.type === "result") {
            finish();
            // 收到 result → 立即回收子程序（不必等 idle TTL）。延到 microtask：
            // attachDone 的第二監聽器與本槽監聽器收同一個同步 emit 的 result，兩者的
            // listener 本體都會先跑完，reclaim 延到 microtask 後才殺程序，不搶在
            // attachDone 的 cb（拿完整 output）之前。逾時路徑不回收（由 attachDone 中止子程序）。
            queueMicrotask(() => am.reclaimSubprocess(s.id));
          } else if (evt.type === "status" && (evt.payload === "error" || evt.payload === "closed")) {
            finish(); // 子程序已結束（中止/crash）→ 槽立即歸還
          } else {
            slotDeadline.touch();
          }
        };
        // 保底：即使 result 永不來，槽也一定歸還，不會永久佔用。與 attachDone 同一套活動判定，
        // 多給 1 分鐘讓 attachDone 先處理逾時（回報 PM＋中止子程序）。
        const lim = limitsFn();
        const slotDeadline = createActivityDeadline({ idleMs: lim.idleMs + 60_000, hardMs: lim.hardMs + 60_000, onExpire: finish });
        s.on("event", onSlotEvent);
        am.send(s.id, buildExecutePrompt(buildDispatchBrief(item)));
      }), { label: `execute:${item.agentId}` });
      return s.id;
    },
    attachDone: (subSessionId, cb) => {
      const s = am.get(subSessionId);
      if (!s) { cb("（子 session 不存在）", false); return; }
      let collected = "";
      let streamed = "";
      const messages: string[] = []; // 逾時/中止時要帶回完整過程，不能只剩最後一則旁白
      let settled = false;
      let continuations = 0; // 已自動續跑次數（見 shouldContinueExecute）
      const lim = limitsFn();
      const finish = (output: string, ok: boolean) => {
        if (settled) return;
        settled = true;
        continuing.delete(subSessionId);
        deadline.clear();
        s.removeListener("event", onEvent);
        cb(output, ok);
      };
      const onEvent = (evt: any) => {
        if (settled) return;
        deadline.touch(); // 任何事件（吐字、工具呼叫/結果、狀態）都算「還在動」
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) { collected = String(evt.payload.content); messages.push(collected); }
        else if (evt.type === "result") {
          const out = (collected || streamed).trim();
          if (shouldContinueExecute(evt.payload, out, continuations)) {
            // 回合結束但還沒附自驗 → 當成進度回報，送續跑訊息；槽與子程序都保留（見槽持有者）。
            continuations++;
            continuing.add(subSessionId);
            streamed = "";
            try {
              am.send(subSessionId, EXECUTE_CONTINUE_PROMPT);
            } catch {
              finish(out + noSelfCheckNote(continuations - 1), true);
            }
            return;
          }
          const ok = executeResultOk(evt.payload, out);
          finish((out || "（執行未產出內容）") + (ok && !out.includes(SELF_CHECK_MARKER) ? noSelfCheckNote(continuations) : ""), ok);
        } else if (evt.type === "status" && (evt.payload === "error" || evt.payload === "closed")) {
          // 子程序在交出結果前就結束（crash / 被外部停止）→ 立刻回報，不必乾等到逾時。
          finish(endedEarlyOutput(messages, streamed, evt.payload), false);
        }
      };
      const deadline = createActivityDeadline({
        ...lim,
        // 送出前可能還在排背景槽（上限 3 個併發）：排隊期間沒有活動不算卡住，idle 從第一個事件
        //（送出當下同步發出的 status starting/busy）才開始計；hard 上限從現在起算，排隊也算在內。
        idleStartsOnFirstTouch: true,
        onExpire: (reason) => {
          if (phase.get(subSessionId) === "queued") phase.set(subSessionId, "abandoned");
          // 判定卡住或超過絕對上限 → 回報「未完成」並中止子代理（與同步路徑 F3 一致：
          // 告訴 PM 失敗的同時不讓它在背景繼續做，避免 PM 重派後重複執行副作用）。
          // 先 finish（移除監聽）再停：stop 會同步發出 status closed，不能蓋掉逾時說明。
          finish(`${buildTimeoutOutput(messages, streamed)}\n\n${executeAbortNote(reason, lim)}`, false);
          try { s.stop?.(); } catch { /* 停止失敗不影響回報 */ }
        },
      });
      s.on("event", onEvent);
    },
  };
}

// 預設依賴：開背景真 session（吃工作區 Chrome/MCP）並掛 result 監聽。
const defaultExecuteDeps: ExecuteDeps = makeExecuteDeps(agentManager as unknown as ExecuteAgentManager);

// ====================== consult 遲到補報（逾時後把結論收回來）======================

/**
 * 逾時後繼續守著等結論：只要子代理還在動就一直等；連續 15 分鐘沒動靜、或逾時後滿 60 分鐘
 * 就放生（不回報、不再持有監聽器）。舊版固定只守 20 分鐘——新模型查得更徹底，收尾常超過。
 */
export const LATE_CONSULT_IDLE_MS = 15 * 60 * 1000;
export const LATE_CONSULT_MAX_MS = 60 * 60 * 1000;

export interface LateConsultReport {
  index: number;          // 在 ConsultResult[] 中的位置——呼叫端據此對回 delegationId/原 item
  agentId: string;
  subSessionId: string;
  output: string;
  ok: boolean;
}
export interface LateConsultDeps {
  attach: (subSessionId: string, cb: (output: string, ok: boolean) => void) => void;
}

/**
 * 造 consult 遲到補報的依賴：在「已逾時但仍活著」的子 session 上補掛監聽。
 *
 * 為什麼不直接複用 execute 的 attachDone：語意不同。attachDone 在硬逾時後會回一則
 * 「（執行未產出內容）」的空手回報；補報路徑不該這樣——沒補到東西就該安靜放生，
 * 而不是 20 分鐘後跳出來吵 PM 一則沒有內容的訊息。
 */
export function makeLateConsultDeps(
  am: ExecuteAgentManager,
  limits: { idleMs: number; hardMs: number } = { idleMs: LATE_CONSULT_IDLE_MS, hardMs: LATE_CONSULT_MAX_MS },
): LateConsultDeps {
  return {
    attach: (subSessionId, cb) => {
      const s = am.get(subSessionId);
      if (!s) return; // 子 session 已不在（已被 TTL 回收）→ 無從補報，靜默略過
      let collected = "", streamed = "", settled = false;
      const stop = () => {
        settled = true;
        deadline.clear();
        s.removeListener("event", onEvent);
      };
      const onEvent = (evt: any) => {
        if (settled) return;
        deadline.touch(); // 還在動就繼續等
        // 補掛時本回合早已在進行中，拿不到 turnId 對照，且一個受派子 session 只跑一回合 → 不做 turn 過濾。
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
        else if (evt.type === "result") {
          stop();
          const out = (collected || streamed).trim();
          // 只在真的補到內容時回報；空手不吵 PM。內容其實是「額度用盡」通知 → 以失敗回報，
          // 讓 PM 告訴使用者這部分沒拿到結論，而不是把那行字當結論轉述。
          if (out) cb(out, !isUsageLimitText(out));
          // 結論到手＝這個 shadow 子程序可以收了（reclaim 內含 unmarkShadow）。
          queueMicrotask(() => am.reclaimSubprocess(subSessionId));
        }
      };
      const deadline = createActivityDeadline({ ...limits, onExpire: stop });
      s.on("event", onEvent);
    },
  };
}

const defaultLateConsultDeps: LateConsultDeps = makeLateConsultDeps(agentManager as unknown as ExecuteAgentManager);

/**
 * 對逾時的 consult 項掛「遲到補報」監聽，回傳實際掛上的 subSessionId 清單。
 *
 * 起因（真實事故，2026-07-13）：consult 逾時刻意不殺子程序（見 runOneConsult），子代理
 * 通常會在逾時後 1~8 分鐘把真正的結論做完——但系統沒有任何路徑去收，結論就爛在 DB 裡，
 * PM 只拿到過程碎念。台帳 6/6 全滅、每筆的結論都在逾時後 61~495 秒才產出，全數丟棄。
 *
 * 這裡把那條斷掉的回流補起來：逾時＝「還沒好」，不再等於「放棄」。
 */
export function attachLateConsults(
  results: ConsultResult[],
  onLate: (r: LateConsultReport) => void,
  deps: LateConsultDeps = defaultLateConsultDeps,
): string[] {
  const attached: string[] = [];
  results.forEach((r, index) => {
    if (r.status !== "timeout" || !r.subSessionId) return;
    deps.attach(r.subSessionId, (output, ok) =>
      onLate({ index, agentId: r.agentId, subSessionId: r.subSessionId, output, ok }),
    );
    attached.push(r.subSessionId);
  });
  return attached;
}

/**
 * 啟動 execute 項為背景真 session（不等完成），完成時透過 onDone 把結果交回。
 * 立即返回 handle。execute 任務可能跑數分鐘，故非同步、不卡 PM。
 */
export function startExecute(
  items: DispatchItem[],
  workspaceId: string,
  pmSessionId: string,
  onDone: (d: ExecuteDone) => void,
  deps: ExecuteDeps = defaultExecuteDeps,
): ExecuteHandle[] {
  return items.map((item) => {
    const subSessionId = deps.start(item, workspaceId);
    deps.attachDone(subSessionId, (output, ok) =>
      onDone({ pmSessionId, agentId: item.agentId, subSessionId, output, status: ok ? "ok" : "error" }),
    );
    return { subSessionId, agentId: item.agentId };
  });
}
