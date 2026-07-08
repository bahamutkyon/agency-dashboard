/**
 * telegramPoller.ts — Telegram 雙向批准（收到「待批」推播後直接回 bot 批准/拒絕）
 *
 * 範圍刻意收窄：只認「批准 / 拒絕」兩個動詞。所有動作走既有 CAS 核可路徑
 * （approvalService），Telegram 路徑不繞過任何守衛。
 *
 * 安全要求（不可妥協）：
 *  1. 只認設定的 chatId：chat.id !== 設定值一律忽略（連回覆都不回，避免探測）。
 *  2. 只解析批准/拒絕兩動詞（含常見變體），其他訊息回一則簡短使用說明。
 *  3. 走既有 CAS 路徑；已處理過的 pending 回「已處理過」。
 *  4. 輪詢失敗靜默指數退避（最多 5 分鐘），任何錯誤絕不影響主流程；
 *     未設定 notifier 或功能關閉時完全不啟動。
 *
 * 全部 deps 可注入（fetch/config/pending/approve/reject/sendReply/clock）供測試。
 */
import { getNotifierConfig } from "./notifier.js";
import { listAllPending } from "./store/autonomy.js";
import { getWorkspace } from "./store/workspaces.js";
import { approvePendingAction, rejectPendingAction, type ApprovalResult } from "./routes/approvalService.js";

const POLL_INTERVAL_MS = 3_000;        // 成功一輪後的間隔（getUpdates 本身 long-poll 25s）
const LONG_POLL_TIMEOUT = 25;          // Telegram getUpdates timeout（秒）
const FETCH_TIMEOUT_MS = 30_000;       // AbortController 逾時（略大於 long-poll）
const MAX_BACKOFF_MS = 5 * 60 * 1000;  // 連續失敗退避上限：5 分鐘
const SNAPSHOT_TTL_MS = 10 * 60 * 1000; // 多筆待批編號清單 snapshot 有效期：10 分鐘
const SUMMARY_LEN = 60;

const HELP_TEXT =
  "指令：回覆「批准」或「拒絕」處理待批項目。\n多筆待批時我會列出編號清單，再回覆「批准 2」指定第幾筆。";

export interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number | string }; text?: string };
}

export interface PendingLike { id: string; summary: string; workspaceId: string }

export interface PollerDeps {
  fetchImpl: typeof fetch;
  getConfig: () => { token: string; chatId: string } | null;
  listAllPending: () => PendingLike[];
  approve: (actionId: string) => ApprovalResult;
  reject: (actionId: string) => ApprovalResult;
  sendReply: (chatId: string, text: string) => Promise<void>;
  workspaceName: (workspaceId: string) => string;
  now: () => number;
}

export interface PollerState {
  offset: number;
  snapshot: { items: PendingLike[]; at: number } | null;
  failCount: number;
}

export function makeInitialState(): PollerState {
  return { offset: 0, snapshot: null, failCount: 0 };
}

type Command =
  | { verb: "approve"; index?: number }
  | { verb: "reject"; index?: number }
  | { verb: "help" };

// 完整比對（^...$）避免 "okay" 之類誤觸；尾端可帶編號（「批准 2」/「批准2」）。
const APPROVE_RE = /^(批准|同意|核可|approve|ok)\s*(\d+)?$/i;
const REJECT_RE = /^(拒絕|不要|駁回|reject|no)\s*(\d+)?$/i;

/** 解析訊息文字為指令；非批准/拒絕一律回 help。 */
export function parseCommand(text: string): Command {
  const t = (text ?? "").trim();
  let m = t.match(APPROVE_RE);
  if (m) return { verb: "approve", index: m[2] ? Number(m[2]) : undefined };
  m = t.match(REJECT_RE);
  if (m) return { verb: "reject", index: m[2] ? Number(m[2]) : undefined };
  return { verb: "help" };
}

function decide(target: PendingLike, verb: "approve" | "reject", deps: PollerDeps): ApprovalResult {
  return verb === "approve" ? deps.approve(target.id) : deps.reject(target.id);
}

function replyFor(result: ApprovalResult, target: PendingLike): string {
  switch (result.status) {
    case "approved": return `✅ 已批准：${target.summary.slice(0, SUMMARY_LEN)}（開始執行）`;
    case "rejected": return "🚫 已拒絕，已請 PM 改方案";
    case "already_handled": return "⚠️ 此項已處理過";
    case "not_found": return "⚠️ 找不到該待批項目（可能已處理）";
  }
}

/**
 * 撈全域 pending，依 0/N 筆分流：0→提示、1 筆以上→一律存 snapshot 並列編號清單（等帶編號指令才執行）。
 *
 * 為何連「只有 1 筆」也要回編號確認、不直批（R3）：批准有不可逆副作用（開始執行）。
 * poller push 待批推播與使用者回覆之間，pending 佇列可能已被換掉（原本第 1 筆被處理、
 * 新的 pending 遞補上來），若裸動詞「批准」直接對「當下唯一那筆」執行，就可能批錯目標。
 * 一律回編號清單＋存 snapshot（快照釘住 id），只有帶編號的「批准 1」才對快照第 N 筆執行，
 * 多一次來回換絕不批錯。0 筆行為不變。
 */
async function listOrExecute(
  verb: "approve" | "reject", chatId: string, deps: PollerDeps, state: PollerState, expiredIndex: boolean,
): Promise<void> {
  const pending = deps.listAllPending();
  const verbLabel = verb === "approve" ? "批准" : "拒絕";

  if (pending.length === 0) {
    state.snapshot = null;
    await deps.sendReply(chatId, expiredIndex ? "剛才的清單已過期，且目前沒有待批項目。" : "目前沒有待批項目");
    return;
  }
  // 1 筆以上 → 一律存 snapshot（TTL 10 分鐘）+ 列編號清單，等使用者回「批准 N」帶編號才執行。
  state.snapshot = { items: pending.map((p) => ({ id: p.id, summary: p.summary, workspaceId: p.workspaceId })), at: deps.now() };
  if (pending.length === 1) {
    // 只有 1 筆也要確認：回「待批 1 筆：1. <summary>。回覆「批准 1」確認」。
    const p = pending[0];
    const prefix = expiredIndex ? "剛才的清單已過期，目前" : "";
    await deps.sendReply(
      chatId,
      `${prefix}待批 1 筆：1. ${p.summary.slice(0, SUMMARY_LEN)}（${deps.workspaceName(p.workspaceId)}）。回覆「${verbLabel} 1」確認。`,
    );
    return;
  }
  const lines = pending.map((p, i) => `${i + 1}. ${p.summary.slice(0, SUMMARY_LEN)}（${deps.workspaceName(p.workspaceId)}）`);
  const prefix = expiredIndex ? "剛才的清單已過期，這是最新的待批清單：\n" : "有多筆待批項目：\n";
  await deps.sendReply(chatId, `${prefix}${lines.join("\n")}\n\n請回覆「${verbLabel} 編號」指定要處理哪一筆（例：${verbLabel} 1）。`);
}

async function handleCommand(cmd: Command, chatId: string, deps: PollerDeps, state: PollerState): Promise<void> {
  if (cmd.verb === "help") {
    await deps.sendReply(chatId, HELP_TEXT);
    return;
  }
  if (cmd.index != null) {
    // 「批准 N」→ 對 snapshot 第 N 筆執行；snapshot 過期/無 → 重新列清單。
    const snap = state.snapshot;
    if (snap && (deps.now() - snap.at) < SNAPSHOT_TTL_MS) {
      const target = snap.items[cmd.index - 1];
      if (!target) {
        await deps.sendReply(chatId, `編號超出範圍（清單共 ${snap.items.length} 筆），請重新回覆「批准」查看清單。`);
        return;
      }
      await deps.sendReply(chatId, replyFor(decide(target, cmd.verb, deps), target));
      return;
    }
    await listOrExecute(cmd.verb, chatId, deps, state, true);
    return;
  }
  await listOrExecute(cmd.verb, chatId, deps, state, false);
}

/** 處理單一 update：chatId 過濾（陌生 chat 完全忽略不回）→ 解析 → 執行。 */
export async function processUpdate(update: TelegramUpdate, deps: PollerDeps, state: PollerState): Promise<void> {
  const cfg = deps.getConfig();
  if (!cfg) return; // 未設定 → 不處理
  const msg = update?.message;
  const incoming = msg?.chat?.id;
  if (incoming == null) return;
  // 安全要求 1：只認設定的 chatId，陌生 chat 一律忽略，連回覆都不回（避免探測）。
  if (String(incoming) !== String(cfg.chatId)) return;
  const text = typeof msg?.text === "string" ? msg.text : "";
  if (!text.trim()) return; // 非文字/空訊息（貼圖等）→ 忽略，不回說明避免噪音
  await handleCommand(parseCommand(text), String(cfg.chatId), deps, state);
}

/**
 * 暫停到期時間戳（module-level，供 discover-chat 路由與 poller 迴圈跨模組互斥用）。
 * discoverChatId() 與 poller 都會打同一支 getUpdates long-poll 流，兩邊同時搶會被
 * Telegram 回 409（Conflict）。故 discover 前先 suspend 一小段，讓 poller 讓路。
 */
let suspendedUntil = 0;

/**
 * 暫停 poller ms 毫秒（pollOnce 在暫停期間直接 no-op 短路）。
 * 由 routes/misc.ts 的 discover-chat 在呼叫 discoverChatId() 前呼叫，避免搶同一 getUpdates 流。
 */
export function suspendTelegramPoller(ms: number): void {
  suspendedUntil = Date.now() + Math.max(0, ms);
}

/** 一輪 long-poll getUpdates + 處理。任何錯誤靜默吞掉並累加 failCount（供退避），絕不拋。 */
export async function pollOnce(deps: PollerDeps, state: PollerState): Promise<void> {
  // 暫停期間（discover-chat 佔用 getUpdates 流）直接 no-op，避免 409 互搶。
  if (deps.now() < suspendedUntil) return;
  const cfg = deps.getConfig();
  // 未設定 notifier → no-op 短路（不打網路），維持空轉間隔等使用者設定，設定後下一輪即生效。
  if (!cfg) { state.failCount = 0; return; }
  try {
    const url = `https://api.telegram.org/bot${cfg.token}/getUpdates?offset=${state.offset}&timeout=${LONG_POLL_TIMEOUT}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    timer.unref?.();
    let resp: any;
    try {
      resp = await deps.fetchImpl(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    const j: any = await resp.json();
    if (j?.ok !== true) { state.failCount++; return; }
    const updates: TelegramUpdate[] = Array.isArray(j.result) ? j.result : [];
    for (const u of updates) {
      // offset 先推進（即使該筆處理出錯也不重放；重啟漏一則沒關係，pending 還在）。
      state.offset = Math.max(state.offset, (u.update_id ?? 0) + 1);
      try {
        await processUpdate(u, deps, state);
      } catch (e: any) {
        console.warn("[tg-poll] processUpdate 失敗：", e?.message || e);
      }
    }
    state.failCount = 0; // 成功一輪 → 重置退避
  } catch (e: any) {
    state.failCount++; // 靜默退避，不拋
  }
}

/** 依連續失敗次數算下一次輪詢間隔：成功→基準間隔；失敗→指數退避到上限。 */
export function nextDelayMs(state: PollerState): number {
  if (state.failCount <= 0) return POLL_INTERVAL_MS;
  return Math.min(POLL_INTERVAL_MS * 2 ** state.failCount, MAX_BACKOFF_MS);
}

function defaultDeps(): PollerDeps {
  return {
    fetchImpl: fetch,
    getConfig: () => getNotifierConfig(),
    listAllPending: () => listAllPending().map((p) => ({ id: p.id, summary: p.summary, workspaceId: p.workspaceId })),
    // io=undefined：poller 無 socket 脈絡；executeDispatch 的 io?.emit 是選填，DB 記帳照常。
    approve: (id) => approvePendingAction(id, undefined),
    reject: (id) => rejectPendingAction(id),
    sendReply: async (chatId, text) => {
      const cfg = getNotifierConfig();
      if (!cfg) return;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      timer.unref?.();
      try {
        await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: ctrl.signal,
        });
      } catch { /* fail-safe：回覆丟了就丟了 */ } finally {
        clearTimeout(timer);
      }
    },
    workspaceName: (id) => getWorkspace(id)?.name ?? id,
    now: () => Date.now(),
  };
}

let running = false;

/**
 * 啟動輪詢迴圈（由 index.ts 在非 VITEST 的 listen callback 掛）。
 * 常駐化：不再因啟動時 notifier 未設定而永不啟動——迴圈常駐，pollOnce 在 cfg==null 時
 * no-op 短路（不打網路、維持空轉間隔），使用者一旦設定好下一輪即生效，不用重啟 server。
 * 唯二不啟動條件：TELEGRAM_TWO_WAY === "off"（顯式關閉）與 running（已在跑）。
 * 回傳是否真的啟動。
 */
export function startTelegramPoller(overrides?: Partial<PollerDeps>): boolean {
  if (process.env.TELEGRAM_TWO_WAY === "off") return false;
  if (running) return false;
  const deps: PollerDeps = { ...defaultDeps(), ...overrides };
  running = true;
  const state = makeInitialState();
  const tick = async () => {
    if (!running) return;
    await pollOnce(deps, state);
    if (!running) return;
    const t = setTimeout(tick, nextDelayMs(state));
    t.unref?.();
  };
  void tick();
  console.log("[tg-poll] Telegram 雙向批准輪詢已啟動");
  return true;
}

/** 供測試/關機用。停止時一併清除暫停狀態。 */
export function stopTelegramPoller(): void { running = false; suspendedUntil = 0; }
