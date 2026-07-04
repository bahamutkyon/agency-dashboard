/**
 * 總管駕駛艙的時間驅動排程器
 * 每日 07:00 Asia/Taipei 生成當日簡報。
 */
import cron, { ScheduledTask } from "node-cron";
import { runCockpit } from "./cockpitGenerator.js";

class CockpitScheduler {
  private task: ScheduledTask | null = null;

  /** 每日 07:00 Asia/Taipei 生成當日簡報。 */
  init() {
    const expr = process.env.COCKPIT_CRON || "0 7 * * *";
    if (!cron.validate(expr)) return;
    this.task = cron.schedule(expr, () => {
      runCockpit("daily").catch((e) => console.warn("[cockpit-scheduler] fail:", e?.message || e));
    }, { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" });
    console.log(`[cockpit-scheduler] daily briefing @ ${expr}`);
  }
}

export const cockpitScheduler = new CockpitScheduler();
