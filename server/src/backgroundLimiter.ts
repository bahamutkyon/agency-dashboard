/**
 * 全域背景工作併發限流器 + rate-limit 退避。
 *
 * 問題：dashboard 有五個子系統（workflow / dispatch / scheduler / learning /
 * cockpit）各自呼叫 agentManager.start()／spawnClaude 開背景子程序，彼此互不
 * 知情。一個排程撞上 10-step workflow 撞上派工，可能同時有 8-12 個 claude 子
 * 程序打同一份訂閱額度 → 撞爆 rate limit（401）。usageTracker 已在收 rate_limit
 * 訊號，但只有 UI 提示、無 server 端節流。
 *
 * 解法：一個「只管背景/批量工作」的全域 async semaphore。
 *   - 上限 BG_CONCURRENCY（預設 3，env AGENCY_BG_CONCURRENCY 覆蓋）。
 *   - 超過上限的排隊（FIFO），有槽釋放才進場。
 *   - rate-limit 退避：撞限流時設一個全域「退避到期時間戳」，之後所有背景工作在
 *     搶槽前先等到退避結束，一旦撞限流就自動暫緩、不繼續火上加油。
 *
 * 重要：互動使用者聊天（routes 的 session:send 路徑）**完全不經過**本限流器，
 * 零延遲、豁免。本限流器只包背景/批量 spawn 站。
 *
 * 安全保證：withBackgroundSlot 一定在 finally release（fn 拋錯往外拋、但槽必還）。
 */

/** 預設背景併發上限。 */
const DEFAULT_BG_CONCURRENCY = 3;
/** rate-limit 撞牆後、未給 retryAfter 時的預設退避時長（毫秒）。 */
const DEFAULT_BACKOFF_MS = 60_000;

/** 目前佔用中的槽數（= 正在跑 fn 的數量）。 */
let running = 0;
/** 等待槽的 FIFO 佇列，每個元素是「發槽」的 resolver。 */
const waiters: Array<() => void> = [];
/** 退避到期時間戳（ms epoch）；0 = 無退避。 */
let backoffUntil = 0;

/**
 * 已還槽但子程序仍存活的 session（shadow）——用 Set 記 sessionId 嚴格配對計數。
 *
 * 為何是 Set 而非裸計數器：decrement 掛在共用回收路徑（reclaimClaudeSubprocess 同時
 * 服務 TTL 回收與 dispatch reclaim，絕大多數 session 從未 mark 過），若無條件 -1 會把
 * 真實 shadow 抵銷 clamp 到 0 → shadowRunning 永遠低估、observability 失效。用 Set 保證
 * 只有「確實 mark 過的 shadow session」被回收時才 -1，且同一 id 重複 mark/unmark 冪等。
 */
const shadowSessions = new Set<string>();

/** 標記一個 session 為 shadow（已還槽但子程序仍存活，如 consult 逾時後不殺、交 TTL 收）。 */
export function markShadow(id: string): void {
  if (id && !shadowSessions.has(id)) shadowSessions.add(id);
}
/** 解除 shadow 標記（該 session 的子程序終於被回收/殺掉）。未標記過的 id 為 no-op。 */
export function unmarkShadow(id: string): void {
  if (id) shadowSessions.delete(id);
}

/** 讀取當前併發上限——每次呼叫時讀 env，讓測試可動態覆蓋。 */
function currentLimit(): number {
  const raw = Number(process.env.AGENCY_BG_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BG_CONCURRENCY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    // 別讓退避睡眠拖住 process 結束
    (t as any).unref?.();
  });
}

/** 若仍在退避窗內就等到退避結束（迴圈處理退避在等待期間被延長的情況）。 */
async function waitForBackoff(): Promise<void> {
  // 迴圈：退避可能在睡眠期間被 noteRateLimited 再往後推。
  while (true) {
    const remain = backoffUntil - Date.now();
    if (remain <= 0) return;
    await sleep(remain);
  }
}

/** 搶一個槽：有空位立即拿；否則排進 FIFO 佇列等 release 發槽。 */
function acquire(): Promise<void> {
  if (running < currentLimit()) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

/** 還一個槽：若有等待者就把槽直接交給下一位（running 不變）；否則 running--。 */
function release(): void {
  const next = waiters.shift();
  if (next) {
    // 把槽直接交棒給佇列最前面的等待者，running 維持不變。
    next();
  } else {
    running = Math.max(0, running - 1);
  }
}

/**
 * 在一個背景槽內執行 fn：
 *   1. 先等退避窗（若撞過限流）。
 *   2. 搶一個槽（上限 BG_CONCURRENCY，超過則排隊）。
 *   3. 跑 fn。
 *   4. finally release（fn 的錯往外拋，但槽一定歸還）。
 *
 * 只用於背景/批量工作。互動聊天不要用這個。
 */
export async function withBackgroundSlot<T>(
  fn: () => Promise<T>,
  _opts?: { label?: string },
): Promise<T> {
  await waitForBackoff();
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * 標記剛撞到 rate limit：設定/延長全域退避窗。
 * 之後所有背景工作在搶槽前會先等到退避結束。只往後延、不會縮短既有退避。
 * @param retryAfterMs 若後端有給明確的 retry-after（毫秒）就用它，否則用預設 60s。
 */
export function noteRateLimited(retryAfterMs?: number): void {
  const dur = typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : DEFAULT_BACKOFF_MS;
  const until = Date.now() + dur;
  if (until > backoffUntil) backoffUntil = until;
}

/** 觀測用：目前執行中/排隊中/退避到期時間戳/上限/shadow計數。 */
export function backgroundLimiterStats(): {
  running: number;
  queued: number;
  backoffUntil: number;
  limit: number;
  shadowRunning: number;
} {
  return { running, queued: waiters.length, backoffUntil, limit: currentLimit(), shadowRunning: shadowSessions.size };
}

/** 測試用：把限流器狀態歸零（正式程式碼不該呼叫）。 */
export function __resetBackgroundLimiterForTest(): void {
  running = 0;
  waiters.length = 0;
  backoffUntil = 0;
  shadowSessions.clear();
}
