/**
 * 開新話題時帶入上一場重點（方案 D2）。只帶一場、不串接更早的；新話題無關時由 PM 忽略、使用者可選「不要帶入」。
 */
import { getSession } from "./store.js";
import { getSessionState } from "./store/sessionState.js";

export interface Handoff {
  fromId: string;
  fromTitle: string;
  summary: string;
  /** digest＝閒置回收時整理的「停在哪」；excerpt＝還沒整理，取最後一則專案經理回覆節錄 */
  source: "digest" | "excerpt";
}

const EXCERPT_MAX = 300;

export function buildHandoff(fromId: string): Handoff | null {
  const s = getSession(fromId);
  if (!s) return null;
  const msgs = s.messages || [];
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return null;
  const lastTs = Math.max(...msgs.map((m) => m.ts || 0));
  const st = getSessionState(fromId);
  if (st?.stoppedAt && st.digestAt && st.digestAt >= lastTs) {
    return { fromId, fromTitle: s.title, summary: st.stoppedAt, source: "digest" };
  }
  const text = lastAssistant.content.replace(/\s+/g, " ").trim();
  const chars = [...text];
  const summary = chars.length > EXCERPT_MAX ? chars.slice(0, EXCERPT_MAX).join("") + "…" : text;
  return { fromId, fromTitle: s.title, summary, source: "excerpt" };
}

export function handoffPromptBlock(h: Handoff): string {
  return `\n\n# 🔁 上一場交接\n使用者這場是從上一場專案經理對話「${h.fromTitle}」之後開的新話題。上一場${h.source === "digest" ? "停在" : "最後一則回覆節錄"}：\n> ${h.summary}\n（使用者這場要談的事若跟上一場有關，就接著做、不要重問已經確認過的事；若無關，忽略這段。）`;
}
