import { agentManager } from "./agentManager.js";
import { turnMatches } from "./agentSession.js";
import { withBackgroundSlot, markShadow } from "./backgroundLimiter.js";
import type { DispatchItem } from "./dispatchParser.js";
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

/** 派工同步路徑（consult / execute-sync）對 agentManager 的最小依賴面，供測試注入 fake session/EventEmitter。 */
type ManagedSession = {
  id: string;
  on: (event: "event", cb: (evt: any) => void) => void;
  removeListener: (event: "event", cb: (evt: any) => void) => void;
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
  start: (agentId, title, workspaceId) => agentManager.start(agentId, title, undefined, workspaceId, false),
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
    let collected = "";   // 最終 message 事件的權威全文
    let streamed = "";    // 累積的 delta 串流——逾時時用它救回「部分內容」而非空白
    let settled = false;
    let myTurnId: number | undefined; // 本回合 turnId：只認自己那回合的 result
    const finish = (status: ConsultResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener("event", onEvent);
      // 有完整 message 用它；否則退而用串流到一半的內容（逾時仍給部分價值）。
      resolve({ agentId: item.agentId, task: item.task, output: (collected || streamed).trim(), status, subSessionId: session.id });
      // 收到 result 的 finish（非逾時）→ 立即回收子程序，不必等 idle TTL。
      // 用 queueMicrotask 延後：確保同一 result 事件的所有監聽器先處理完、
      // session status 已轉 idle，reclaim 才對它動手。逾時路徑不回收（子 agent 還在跑，交給 TTL 收）。
      if (status !== "timeout") queueMicrotask(() => deps.reclaim(session.id));
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") { if (turnMatches(myTurnId, evt.turnId)) streamed += evt.payload; }
      else if (evt.type === "message" && evt.payload?.content) { if (turnMatches(myTurnId, evt.turnId)) collected = String(evt.payload.content); }
      else if (evt.type === "result") { if (turnMatches(myTurnId, evt.turnId)) finish((collected || streamed) ? "ok" : "error"); }
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
    let myTurnId: number | undefined; // 本回合 turnId：只認自己那回合的 result
    const finish = (status: ConsultResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener("event", onEvent);
      const raw = (collected || streamed).trim();
      // F3: 逾時時加上中止說明，讓 PM 知道任務未完成且不應重派
      const output = status === "timeout"
        ? (raw ? `${raw}\n\n【已中止，未完成】子代理已停止，本任務未完成，請勿重派相同任務。` : "【已中止，未完成】子代理已停止，本任務未完成，請勿重派相同任務。")
        : raw;
      resolve({ agentId: item.agentId, task: item.task, output, status, subSessionId: session.id });
      // 同 runOneConsult：result 的 finish（非逾時）→ 延後回收子程序；逾時不回收。
      if (status !== "timeout") queueMicrotask(() => deps.reclaim(session.id));
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") { if (turnMatches(myTurnId, evt.turnId)) streamed += evt.payload; }
      else if (evt.type === "message" && evt.payload?.content) { if (turnMatches(myTurnId, evt.turnId)) collected = String(evt.payload.content); }
      else if (evt.type === "result") { if (turnMatches(myTurnId, evt.turnId)) finish((collected || streamed) ? "ok" : "error"); }
      else if (evt.type === "status" && (evt.payload === "error" || evt.payload === "closed")) { finish("error"); }
    };
    const timer = setTimeout(() => {
      // F3: execute 逾時直接殺子程序（語意誠實、避免重複副作用）。
      // 殺掉＝不是 shadow（shadow 專指「未殺、仍存活」），故不 markShadow。
      deps.kill?.(session.id);
      finish("timeout");
    }, perItemTimeoutMs);
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
  return results.map((r) => `### ${r.agentId}（${r.status}）\n${r.output || "（無回覆）"}`).join("\n\n");
}

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

const EXECUTE_MAX_MS = 30 * 60 * 1000; // 單項外包執行最長 30 分鐘

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
  start: (agentId: string, title: string, extra: undefined, workspaceId: string, enableAutoFork: boolean) => ManagedSession;
  send: (sessionId: string, text: string) => unknown;
  get: (sessionId: string) => ManagedSession | undefined;
  reclaimSubprocess: (sessionId: string) => boolean;
}

/**
 * 用給定的 agentManager-like 造出 execute（非同步外包）預設依賴。
 * 抽成工廠讓測試能注入 fake session/EventEmitter 驗回收與監聽順序，正式碼綁真 agentManager。
 */
export function makeExecuteDeps(am: ExecuteAgentManager): ExecuteDeps {
  return {
    start: (item, workspaceId) => {
      const s = am.start(item.agentId, `🛠️ 外包執行：${item.task.slice(0, 24)}`, undefined, workspaceId, false);
      // startExecute 原本「無上限」——每項立即 send 打 API，是撞爆限流的主嫌。
      // 這裡把「送出 + 等本回合結束」包進背景槽：session 立即建立（同步回傳 subSessionId
      // 給 UI 連結），但真正 send 延到搶到槽才發，槽持有到 result/逾時才 release。
      // send 延到槽內（下一個 microtask 起），故 startExecute 隨後同步呼叫的 attachDone
      // 監聽器一定先於 send 掛上，不漏事件。
      void withBackgroundSlot(() => new Promise<void>((releaseSlot) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          s.removeListener("event", onSlotEvent);
          releaseSlot();
        };
        const onSlotEvent = (evt: any) => {
          if (evt.type === "result") {
            finish();
            // 收到 result → 立即回收子程序（不必等 idle TTL）。延到 microtask：
            // attachDone 的第二監聽器與本槽監聽器收同一個同步 emit 的 result，兩者的
            // listener 本體都會先跑完，reclaim 延到 microtask 後才殺程序，不搶在
            // attachDone 的 cb（拿完整 output）之前。硬逾時路徑（下方 timer）不回收。
            queueMicrotask(() => am.reclaimSubprocess(s.id));
          }
        };
        // 硬逾時保底：即使 result 永不來，槽也一定歸還，不會永久佔用。逾時不回收（子 agent 可能還在跑）。
        const timer = setTimeout(finish, EXECUTE_MAX_MS);
        timer.unref?.();
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
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.removeListener("event", onEvent);
        cb((collected || streamed).trim() || "（執行未產出內容）", ok);
      };
      const onEvent = (evt: any) => {
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
        else if (evt.type === "result") done(!!(collected || streamed));
      };
      const timer = setTimeout(() => done(false), EXECUTE_MAX_MS);
      s.on("event", onEvent);
    },
  };
}

// 預設依賴：開背景真 session（吃工作區 Chrome/MCP）並掛 result 監聽。
const defaultExecuteDeps: ExecuteDeps = makeExecuteDeps(agentManager as unknown as ExecuteAgentManager);

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
