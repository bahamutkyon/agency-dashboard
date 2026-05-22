/**
 * 能力學習的時間驅動排程器 — 模式對齊 scheduler.ts。
 * 每個 learning_schedule 依 cron 觸發，自動跑一輪能力學習。
 */
import cron, { ScheduledTask } from "node-cron";
import {
  listLearningSchedules, getLearningSchedule, upsertLearningSchedule,
} from "./learningStore.js";
import { createLearningRun, executeLearningRun, runLearningTarget } from "./capabilityLearning.js";

type ProgressSink = (payload: any) => void;

class LearningScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private sink: ProgressSink = () => {};

  /** server 啟動時呼叫一次，注入 socket 進度推送函式。 */
  init(sink: ProgressSink) {
    this.sink = sink;
    this.sync();
    console.log(`[learning-scheduler] initialized, ${this.tasks.size} active schedules`);
  }

  /** create/update/delete 後重新註冊全部 cron job。 */
  sync() {
    // teardown-and-rebuild：先全部停掉再依 DB 重建，確保啟用/停用/cron 變更都生效
    for (const id of [...this.tasks.keys()]) this.unregister(id);
    for (const s of listLearningSchedules()) {
      if (s.enabled && cron.validate(s.cron)) this.register(s.id, s.cron);
    }
  }

  private register(id: string, expr: string) {
    const task = cron.schedule(expr, () => this.fire(id), {
      timezone: process.env.SCHEDULER_TZ || "Asia/Taipei",
    });
    this.tasks.set(id, task);
    console.log(`[learning-scheduler] registered schedule ${id} (${expr})`);
  }

  private unregister(id: string) {
    const t = this.tasks.get(id);
    if (t) { t.stop(); this.tasks.delete(id); }
  }

  private async fire(id: string) {
    const s = getLearningSchedule(id);
    if (!s || !s.enabled || s.targets.length === 0) return;
    console.log(`[learning-scheduler] FIRE "${s.name}" (${s.targets.length} targets)`);
    upsertLearningSchedule({ ...s, lastRunAt: Date.now() });
    const run = createLearningRun(s.targets);
    try {
      await executeLearningRun(run, runLearningTarget, (r) => this.sink({
        runId: r.id, status: r.status, total: r.total, done: r.done,
        current: r.current, failed: r.failed,
        createdProposals: r.createdProposals, scheduleId: id,
      }));
    } catch (e: any) {
      console.warn(`[learning-scheduler] run "${s.name}" failed:`, e?.message || e);
    }
  }
}

export const learningScheduler = new LearningScheduler();
