/**
 * 單元測試：backgroundLimiter.ts
 *
 * 覆蓋範圍：
 *   - 併發不超過上限（BG_CONCURRENCY）
 *   - 排隊 FIFO（先進先出、依序進場）
 *   - release 後下一個進場
 *   - 退避窗內延後（noteRateLimited → 背景工作先等到退避結束）
 *   - fn 拋錯仍 release（且錯往外拋，不被吞）
 *   - backgroundLimiterStats 觀測值正確
 *
 * 用真計時器 + 手動 gate（deferred promise）驗證併發/排隊語意，
 * 用短暫真延遲驗證退避——與本專案既有測試風格一致（見 dispatchRunner.test）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  withBackgroundSlot,
  noteRateLimited,
  backgroundLimiterStats,
  __resetBackgroundLimiterForTest,
} from "./backgroundLimiter.js";

/** 讓事件迴圈跑一輪，把已就緒的 microtask/timer 抽乾。 */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 手動控制何時完成的 deferred。 */
function defer<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  delete process.env.AGENCY_BG_CONCURRENCY;
  __resetBackgroundLimiterForTest();
});

describe("併發上限", () => {
  it("同時執行的 fn 數量不超過上限（預設 3）", async () => {
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => defer());
    const ps = gates.map((g) =>
      withBackgroundSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );

    await tick();
    // 預設上限 3：恰好 3 個進場、3 個排隊
    expect(backgroundLimiterStats().running).toBe(3);
    expect(backgroundLimiterStats().queued).toBe(3);

    gates.forEach((g) => g.resolve());
    await Promise.all(ps);

    expect(peak).toBe(3);
    expect(backgroundLimiterStats().running).toBe(0);
    expect(backgroundLimiterStats().queued).toBe(0);
  });

  it("env AGENCY_BG_CONCURRENCY 可覆蓋上限", async () => {
    process.env.AGENCY_BG_CONCURRENCY = "2";
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => defer());
    const ps = gates.map((g) =>
      withBackgroundSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );

    await tick();
    expect(backgroundLimiterStats().running).toBe(2);
    expect(backgroundLimiterStats().queued).toBe(3);

    gates.forEach((g) => g.resolve());
    await Promise.all(ps);
    expect(peak).toBe(2);
  });
});

describe("排隊 FIFO + release 後下一個進場", () => {
  it("上限 1 時，依提交順序逐一進場", async () => {
    process.env.AGENCY_BG_CONCURRENCY = "1";
    const order: number[] = [];
    const gates = [defer(), defer(), defer()];
    const ps = gates.map((g, i) =>
      withBackgroundSlot(async () => {
        order.push(i);
        await g.promise;
      }),
    );

    await tick();
    expect(order).toEqual([0]); // 只有第一個進場

    gates[0].resolve();
    await tick();
    expect(order).toEqual([0, 1]); // release 後下一個（1）進場

    gates[1].resolve();
    await tick();
    expect(order).toEqual([0, 1, 2]);

    gates[2].resolve();
    await Promise.all(ps);
    expect(backgroundLimiterStats().running).toBe(0);
  });
});

describe("rate-limit 退避", () => {
  it("退避窗內的背景工作先延後，退避結束後才進場", async () => {
    noteRateLimited(60); // 退避 60ms
    let started = false;
    const p = withBackgroundSlot(async () => {
      started = true;
    });

    await tick();
    expect(started).toBe(false); // 仍在退避窗內，尚未進場
    expect(backgroundLimiterStats().backoffUntil).toBeGreaterThan(Date.now());

    await p; // 等退避結束後自然完成
    expect(started).toBe(true);
  });

  it("noteRateLimited 只往後延、不縮短既有退避", () => {
    noteRateLimited(100_000);
    const first = backgroundLimiterStats().backoffUntil;
    noteRateLimited(10); // 較短，不該把退避拉回
    expect(backgroundLimiterStats().backoffUntil).toBe(first);
  });
});

describe("錯誤處理 — 必 release", () => {
  it("fn 拋錯：錯往外拋，但槽一定歸還", async () => {
    await expect(
      withBackgroundSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(backgroundLimiterStats().running).toBe(0);
    expect(backgroundLimiterStats().queued).toBe(0);

    // 出錯後槽有還，下一個仍能進場
    let ran = false;
    await withBackgroundSlot(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("一個排隊項的前一項拋錯，也能正常遞補進場", async () => {
    process.env.AGENCY_BG_CONCURRENCY = "1";
    const results: string[] = [];
    const p1 = withBackgroundSlot(async () => {
      results.push("a-start");
      throw new Error("a-fail");
    }).catch(() => results.push("a-caught"));
    const p2 = withBackgroundSlot(async () => {
      results.push("b-start");
    });
    await Promise.all([p1, p2]);
    expect(results).toContain("a-caught");
    expect(results).toContain("b-start");
    expect(backgroundLimiterStats().running).toBe(0);
  });
});
