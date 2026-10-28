/**
 * activityDeadline.ts —— 「看活動」的逾時。
 *
 * 起因（實測，2026-08-11）：外包執行固定 30 分鐘硬砍，8 筆有 3 筆在第 30 分鐘被判失敗，
 * 最後一則訊息分別是「資料齊了。開始寫報告。」「已查完。寫入報告檔案：」——都正在收尾，
 * 不是卡住。新模型做得更徹底、單項耗時更長，固定牆鐘會砍掉越來越多「快做完」的工作。
 *
 * 這裡的語意：只要對方還在動（吐字、呼叫工具、收到工具結果…呼叫端每次 touch()），
 * 就不會逾時；連續 idleMs 沒有任何活動才判定卡住（reason "idle"）。另有 hardMs 絕對上限，
 * 防止失控的無限迴圈（reason "hard"）。onExpire 最多觸發一次；clear() 之後永不觸發。
 */

export type DeadlineReason = "idle" | "hard";

export interface ActivityDeadline {
  /** 有活動時呼叫：把 idle 計時重置（hard 上限不受影響）。 */
  touch(): void;
  /** 正常結束（拿到結果或放棄）時呼叫：清掉所有計時器，之後不會再觸發 onExpire。 */
  clear(): void;
}

export interface ActivityDeadlineOpts {
  /** 連續多久沒有活動就判定卡住（毫秒）。 */
  idleMs: number;
  /** 絕對上限（毫秒）；小於 idleMs 時以 idleMs 為準。 */
  hardMs: number;
  onExpire: (reason: DeadlineReason) => void;
  /**
   * true＝idle 計時從第一次 touch() 才開始（hard 上限仍從建立時起算）。
   * 用在「工作可能還在排隊、尚未真正開始」的情境：排隊期間沒有活動不該被判成卡住。
   */
  idleStartsOnFirstTouch?: boolean;
}

export function createActivityDeadline(opts: ActivityDeadlineOpts): ActivityDeadline {
  const idleMs = Math.max(1, opts.idleMs);
  const hardMs = Math.max(idleMs, opts.hardMs);
  let done = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  };
  const expire = (reason: DeadlineReason) => {
    if (done) return;
    done = true;
    stopTimers();
    opts.onExpire(reason);
  };
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => expire("idle"), idleMs);
  };

  const hardTimer = setTimeout(() => expire("hard"), hardMs);
  if (!opts.idleStartsOnFirstTouch) armIdle();

  return {
    touch() {
      if (!done) armIdle();
    },
    clear() {
      done = true;
      stopTimers();
    },
  };
}

/** 讀「正整數毫秒」環境變數；未設定或非法時用 fallback。 */
export function positiveMsFromEnv(raw: string | undefined, fallback: number): number {
  const v = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 毫秒 → 給人看的「N 分鐘」。 */
export function minutesLabel(ms: number): string {
  return `${Math.round(ms / 60_000)} 分鐘`;
}
