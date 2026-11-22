/** 對話過長提醒交接（純前端，不花 token）。門檻依實測：最長 10% 的專案經理對話 ≥102 則。 */
export const NUDGE_MESSAGES = 80;
export const NUDGE_CHARS = 30000;

export function shouldNudge(p: { messageCount: number; totalChars?: number; dismissed?: boolean; handedOff?: boolean }): boolean {
  if (p.dismissed || p.handedOff) return false;
  return p.messageCount >= NUDGE_MESSAGES || (p.totalChars ?? 0) >= NUDGE_CHARS;
}

/** 收到 session:handoff 時：使用者正在看來源對話才自動切到新對話。 */
export function handoffSwitchTarget(viewingSessionId: string | undefined, evt: { fromId: string; toId: string }): string | null {
  return viewingSessionId && viewingSessionId === evt.fromId ? evt.toId : null;
}

const DISMISS_KEY = (id: string) => `handoffNudgeDismissed:${id}`;
export const nudgeDismissed = (id: string) => { try { return localStorage.getItem(DISMISS_KEY(id)) === "1"; } catch { return false; } };
export const dismissNudge = (id: string) => { try { localStorage.setItem(DISMISS_KEY(id), "1"); } catch { /* ignore */ } };

/** 「🔁 交接」鈕送出的固定訊息 */
export const HANDOFF_REQUEST_TEXT = "請整理交接，換到新對話繼續";
