/**
 * 總管駕駛艙的時間驅動排程器
 * 每日 07:00 Asia/Taipei 生成當日簡報。
 *
 * 失敗推播：排程（無人值守）產簡報失敗時，主動推 Telegram 通知使用者。
 * 這條推播由 server 端發（用 Telegram bot token），不依賴 Claude 登入，
 * 所以即使失敗原因就是「Claude OAuth 過期」，這則提醒照樣送得出去。
 * 手動 refresh 的失敗不在此推播（使用者正看著畫面，不需要吵手機）。
 */
import cron, { ScheduledTask } from "node-cron";
import { runCockpit } from "./cockpitGenerator.js";
import { notify } from "./notifier.js";
import type { NotifyEvent } from "./notifier.js";
import type { BriefingRow } from "./cockpitTypes.js";

/** 把失敗簡報的原始錯誤轉成好懂的推播內文；OAuth 過期補上重登指引。 */
function cockpitFailureReason(raw: string | null): string {
  const r = (raw || "").trim();
  if (/oauth|authenticate|expired|refresh/i.test(r)) {
    return `原因：Claude Code 登入過期。\n${r}\n→ 請重新登入 Claude Code（/login 或重開）即可恢復每日簡報。`;
  }
  return r.slice(0, 300) || "未知原因，請開 dashboard 查看。";
}

/**
 * 依排程簡報結果決定是否推播失敗通知（純函式，方便測試）。
 * 成功（ok）→ 回 null（不推）；失敗（parse_failed / error）→ 回一則帶原因的推播事件。
 */
export function buildCockpitFailureEvent(row: BriefingRow): NotifyEvent | null {
  if (row.status === "ok") return null;
  return {
    kind: "簡報失敗",
    title: `今日總管簡報自動更新失敗（${row.date}）`,
    body: cockpitFailureReason(row.raw),
  };
}

class CockpitScheduler {
  private task: ScheduledTask | null = null;

  /** 每日 07:00 Asia/Taipei 生成當日簡報；失敗則推 Telegram。 */
  init() {
    const expr = process.env.COCKPIT_CRON || "0 7 * * *";
    if (!cron.validate(expr)) return;
    this.task = cron.schedule(expr, () => {
      runCockpit("daily")
        .then((row) => {
          const evt = buildCockpitFailureEvent(row);
          if (evt) void notify(evt); // fire-and-forget；notify 內部絕不拋錯
        })
        .catch((e) => {
          // runCockpit 正常情況不會 throw（內部已 catch 成 error row），這裡是防禦性後備。
          const msg = e?.message || String(e);
          console.warn("[cockpit-scheduler] fail:", msg);
          void notify({ kind: "簡報失敗", title: "今日總管簡報自動更新異常", body: String(msg).slice(0, 300) });
        });
    }, { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" });
    console.log(`[cockpit-scheduler] daily briefing @ ${expr}`);
  }
}

export const cockpitScheduler = new CockpitScheduler();
