/**
 * 自主進修的分層排程器 — 模式對齊 learningScheduler.ts。
 * 依 study_schedules（hot/cold 兩層）的 cron 觸發，
 * 用分層挑選器 pickForRun 取目標、走 research worker 自動跑一輪進修。
 */
import cron, { ScheduledTask } from "node-cron";
import { listStudySchedules, touchStudyScheduleRun } from "./studyStore.js";
import { pickForRun } from "./studyTiering.js";
import { createLearningRun, executeLearningRun, runResearchTarget, type LearnTarget } from "./capabilityLearning.js";

type Sink = (payload: any) => void;
type Worker = (t: LearnTarget) => Promise<{ created: number }>;
type Picker = (tier: "hot" | "cold", cap: number) => string[];

/** 測試可注入 worker/picker；正式用預設。回傳 { total, runId }。 */
export async function runScheduledTier(
  tier: "hot" | "cold", cap: number,
  worker: Worker = runResearchTarget, sink: Sink = () => {},
  picker: Picker = pickForRun,
): Promise<{ total: number; runId: string | null }> {
  const ids = picker(tier, cap);
  if (ids.length === 0) return { total: 0, runId: null };
  const targets: LearnTarget[] = ids.map((id) => ({ type: "agent", id }));
  const run = createLearningRun(targets, null, "research");
  touchStudyScheduleRun(tier);
  await executeLearningRun(run, (t) => worker(t), (r) => sink({
    runId: r.id, status: r.status, total: r.total, done: r.done,
    current: r.current, failed: r.failed, createdProposals: r.createdProposals, tier,
  }));
  return { total: ids.length, runId: run.id };
}

class StudyScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private sink: Sink = () => {};

  /** server 啟動時呼叫一次，注入 socket 進度推送函式。 */
  init(sink: Sink) {
    this.sink = sink;
    this.sync();
    console.log(`[study-scheduler] initialized, ${this.tasks.size} active`);
  }

  /** create/update 後重新註冊全部 cron job（teardown-and-rebuild）。 */
  sync() {
    for (const id of [...this.tasks.keys()]) { this.tasks.get(id)!.stop(); this.tasks.delete(id); }
    for (const s of listStudySchedules()) {
      if (s.enabled && cron.validate(s.cron)) {
        const task = cron.schedule(s.cron, () => {
          runScheduledTier(s.tier, s.perRunCap, runResearchTarget, this.sink).catch((e) =>
            console.warn(`[study-scheduler] ${s.tier} failed:`, e?.message || e));
        }, { timezone: process.env.SCHEDULER_TZ || "Asia/Taipei" });
        this.tasks.set(s.tier, task);
        console.log(`[study-scheduler] registered ${s.tier} (${s.cron})`);
      }
    }
  }
}

export const studyScheduler = new StudyScheduler();
