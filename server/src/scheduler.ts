import cron, { ScheduledTask } from "node-cron";
import { v4 as uuid } from "uuid";
import {
  listSchedules,
  upsertSchedule,
  deleteSchedule as removeSchedule,
  getWorkspace,
  DEFAULT_WORKSPACE_ID,
  type Schedule,
} from "./store.js";
import { agentManager } from "./agentManager.js";
import { withBackgroundSlot } from "./backgroundLimiter.js";
import { createActivityDeadline } from "./activityDeadline.js";

/**
 * Cron-based scheduler for autonomous agent runs.
 *
 * Each Schedule fires on its cron expression and creates a fresh AgentSession
 * (so each run starts with a clean conversation). The resulting session is
 * persisted like any other, and the user can pick it up as a tab to continue
 * the conversation manually if they want.
 *
 * Note: Running schedules consume the user's Claude subscription rate limit
 * just like any other agent call. The dashboard surfaces this in the UI so
 * users don't accidentally schedule themselves into a 5-hour rate-limit lockout.
 */
class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private listeners = new Set<(s: Schedule) => void>();

  init() {
    for (const s of listSchedules()) {
      if (s.enabled) this.register(s);
    }
    console.log(`[scheduler] initialized, ${this.tasks.size} active schedules`);
  }

  list(workspaceId?: string): Schedule[] {
    return listSchedules(workspaceId).map((s) => ({
      ...s,
      nextRunAt: s.enabled ? this.computeNextRun(s.cron) : undefined,
    }));
  }

  create(input: Omit<Schedule, "id" | "createdAt" | "workspaceId"> & Partial<Pick<Schedule, "id" | "workspaceId">>): Schedule {
    if (!cron.validate(input.cron)) {
      throw new Error(`Invalid cron expression: ${input.cron}`);
    }
    const s: Schedule = {
      id: input.id || uuid(),
      workspaceId: input.workspaceId || DEFAULT_WORKSPACE_ID,
      name: input.name || "未命名排程",
      agentId: input.agentId,
      prompt: input.prompt,
      cron: input.cron,
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
    };
    upsertSchedule(s);
    if (s.enabled) this.register(s);
    return s;
  }

  update(id: string, patch: Partial<Schedule>): Schedule | null {
    const all = listSchedules();
    const cur = all.find((x) => x.id === id);
    if (!cur) return null;

    if (patch.cron && !cron.validate(patch.cron)) {
      throw new Error(`Invalid cron expression: ${patch.cron}`);
    }

    const next: Schedule = { ...cur, ...patch, id };
    upsertSchedule(next);

    // re-register if cron or enabled changed
    this.unregister(id);
    if (next.enabled) this.register(next);
    return next;
  }

  delete(id: string) {
    this.unregister(id);
    removeSchedule(id);
  }

  onFire(cb: (s: Schedule) => void) {
    this.listeners.add(cb);
  }

  private register(s: Schedule) {
    if (this.tasks.has(s.id)) return;
    const task = cron.schedule(s.cron, () => this.fire(s.id), {
      timezone: process.env.SCHEDULER_TZ || "Asia/Taipei",
    });
    this.tasks.set(s.id, task);
    console.log(`[scheduler] registered "${s.name}" (${s.cron}) → ${s.agentId}`);
  }

  private unregister(id: string) {
    const t = this.tasks.get(id);
    if (t) {
      t.stop();
      this.tasks.delete(id);
    }
  }

  private async fire(scheduleId: string) {
    try {
      const all = listSchedules();
      const s = all.find((x) => x.id === scheduleId);
      if (!s || !s.enabled) return;
      console.log(`[scheduler] FIRE "${s.name}" → ${s.agentId}`);

      s.lastRunAt = Date.now();
      upsertSchedule(s);

      const standing = getWorkspace(s.workspaceId)?.standingContext || "";
      const session = agentManager.start(
        s.agentId,
        `[排程 ${new Date().toLocaleString("zh-TW", { hour12: false })}] ${s.name}`,
        standing || undefined,
        s.workspaceId,
        false, // no auto-fork in unattended scheduled runs
        "claude",
        undefined,
        { unattended: true }, // 無人值守：帶「不要做到一半就回報收尾」的收尾規則
      );

      // 背景總量限流：排程 fire 是無人值守的背景工作，過去直接開 session 送出、
      // 無 server 端 guard（scheduler.ts 檔頭註解自承會把使用者排進 rate-limit
      // lockout）。這裡搶到槽才 send，槽持有到本回合結束（result / 逾時保底）才 release，
      // 讓排程撞上 workflow/派工時自動排隊而非同時打爆 API。互動聊天不受影響。
      const sess = agentManager.get(session.id);
      await withBackgroundSlot(() => new Promise<void>((releaseSlot) => {
        if (!sess) { releaseSlot(); return; }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          slotDeadline.clear();
          sess.removeListener("event", onEvent);
          releaseSlot();
        };
        // Attach a one-shot completion listener and remove it after the first
        // result event, preventing leaks when the session is later reused.
        const onEvent = (evt: { type: string; payload?: unknown }) => {
          if (evt.type === "result") {
            console.log(`[scheduler] DONE "${s.name}" (session ${session.id.slice(0, 8)})`);
            this.listeners.forEach((cb) => cb(s));
            finish();
          } else if (evt.type === "status" && (evt.payload === "closed" || evt.payload === "error")) {
            finish(); // 子程序已結束（crash / 被停止）→ 槽立即歸還
          } else {
            slotDeadline.touch();
          }
        };
        // 槽的保底歸還：看活動（連續 15 分鐘沒動靜，或滿 120 分鐘）。舊版固定 30 分鐘——
        // 排程任務還在跑就先還槽，背景併發上限形同虛設；新模型的長任務越來越常超過 30 分鐘。
        const slotDeadline = createActivityDeadline({ idleMs: 15 * 60 * 1000, hardMs: 120 * 60 * 1000, onExpire: finish });
        sess.on("event", onEvent);
        agentManager.send(session.id, s.prompt);
      }), { label: `schedule:${s.name}` });
    } catch (err: any) {
      console.error(`[scheduler] fire error for schedule ${scheduleId}:`, err?.message ?? err);
    }
  }

  /**
   * Crude approximation of next run — node-cron doesn't expose this directly.
   * We compute by walking forward minute-by-minute up to 7 days.
   */
  private computeNextRun(expr: string): number | undefined {
    if (!cron.validate(expr)) return;
    const parts = expr.split(/\s+/);
    if (parts.length !== 5) return;
    const [m, h, dom, mon, dow] = parts;
    const matches = (n: number, range: string, max: number): boolean => {
      if (range === "*") return true;
      // step like */15
      const stepMatch = range.match(/^\*\/(\d+)$/);
      if (stepMatch) return n % Number(stepMatch[1]) === 0;
      // comma list
      if (range.includes(",")) return range.split(",").some((p) => matches(n, p, max));
      // range like 1-5
      const r = range.match(/^(\d+)-(\d+)$/);
      if (r) return n >= Number(r[1]) && n <= Number(r[2]);
      return Number(range) === n;
    };

    const now = new Date();
    for (let i = 1; i <= 7 * 24 * 60; i++) {
      const t = new Date(now.getTime() + i * 60 * 1000);
      t.setSeconds(0, 0);
      if (
        matches(t.getMinutes(), m, 59) &&
        matches(t.getHours(), h, 23) &&
        matches(t.getDate(), dom, 31) &&
        matches(t.getMonth() + 1, mon, 12) &&
        matches(t.getDay(), dow, 6)
      ) {
        return t.getTime();
      }
    }
    return;
  }
}

export const scheduler = new Scheduler();
