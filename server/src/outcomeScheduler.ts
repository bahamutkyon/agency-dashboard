/**
 * 成效回訪的時間驅動排程器——模式對齊 learningScheduler.ts / cockpitScheduler.ts。
 * 每 5 分鐘掃 listDue：每筆到期回訪 → pending 改 notified → notify()（fire-and-forget）
 * → socket emit 讓 📈 成效面板即時刷新。notified 不重發（markNotified 冪等）。
 */
import cron, { ScheduledTask } from "node-cron";
import { listDue, markNotified, type OutcomeCheck } from "./store/outcomes.js";
import { notify } from "./notifier.js";

type Emit = (event: string, payload: any) => void;
type NotifyFn = (evt: { kind: string; title: string; body?: string }) => void;

export interface SweepDeps {
  /** 測試可注入固定時鐘；預設 Date.now()。 */
  now?: number;
  /** 測試可注入假 notify；預設走真實 notifier（fire-and-forget，不 await）。 */
  notify?: NotifyFn;
  /** socket 廣播；預設 no-op。 */
  emit?: Emit;
}

/**
 * 掃描到期回訪並推播。純函式（可注入 deps 測試），回傳這輪處理的筆數。
 * markNotified 冪等——已 notified 的不重發。
 */
export function sweepDueOutcomes(deps: SweepDeps = {}): number {
  const now = deps.now ?? Date.now();
  const doNotify: NotifyFn = deps.notify ?? ((evt) => { void notify(evt); });
  let count = 0;
  for (const o of listDue(now)) {
    const updated = markNotified(o.id);
    if (!updated) continue; // 已被別輪標記過（冪等）
    doNotify({
      kind: "成效回訪",
      title: o.description.slice(0, 80),
      body: "到 📈 成效面板填結果",
    });
    deps.emit?.("outcome:due", updated satisfies OutcomeCheck);
    count++;
  }
  return count;
}

class OutcomeScheduler {
  private task: ScheduledTask | null = null;
  private emit: Emit = () => {};

  /** server 啟動時呼叫一次，注入 socket 廣播函式。 */
  init(emit: Emit) {
    this.emit = emit;
    const expr = process.env.OUTCOME_CRON || "*/5 * * * *";
    if (!cron.validate(expr)) return;
    this.task = cron.schedule(expr, () => {
      try {
        sweepDueOutcomes({ emit: this.emit });
      } catch (e: any) {
        console.warn("[outcome-scheduler] sweep fail:", e?.message || e);
      }
    }, { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" });
    console.log(`[outcome-scheduler] due sweep @ ${expr}`);
  }
}

export const outcomeScheduler = new OutcomeScheduler();
