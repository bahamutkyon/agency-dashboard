import { describe, it, expect } from "vitest";
import {
  backgroundLimiterStats,
  __resetBackgroundLimiterForTest,
  markShadow,
  unmarkShadow,
} from "./backgroundLimiter.js";

describe("F4: shadow 計數（session-id 集合嚴格配對）", () => {
  it("stats 含 shadowRunning 欄位、初始為 0", () => {
    __resetBackgroundLimiterForTest();
    const stats = backgroundLimiterStats();
    expect(stats).toHaveProperty("shadowRunning");
    expect(typeof stats.shadowRunning).toBe("number");
    expect(stats.shadowRunning).toBe(0);
  });

  it("__resetBackgroundLimiterForTest 清空 shadow", () => {
    markShadow("s1");
    __resetBackgroundLimiterForTest();
    expect(backgroundLimiterStats().shadowRunning).toBe(0);
  });

  it("mark 增、unmark 減，數字反映實際 shadow 數", () => {
    __resetBackgroundLimiterForTest();
    markShadow("a");
    markShadow("b");
    expect(backgroundLimiterStats().shadowRunning).toBe(2);
    unmarkShadow("a");
    expect(backgroundLimiterStats().shadowRunning).toBe(1);
    unmarkShadow("b");
    expect(backgroundLimiterStats().shadowRunning).toBe(0);
  });

  it("同一 id 重複 mark 冪等（不重複計數）", () => {
    __resetBackgroundLimiterForTest();
    markShadow("dup");
    markShadow("dup");
    markShadow("dup");
    expect(backgroundLimiterStats().shadowRunning).toBe(1);
    unmarkShadow("dup");
    expect(backgroundLimiterStats().shadowRunning).toBe(0);
  });

  it("關鍵：unmark 未 mark 過的 id 為 no-op —— 通用回收路徑不得抵銷真實 shadow", () => {
    // 這正是 Opus 抓到的 bug：decrement 掛在共用回收路徑，會把真 shadow clamp 到 0。
    __resetBackgroundLimiterForTest();
    markShadow("real-shadow"); // 一個真的逾時未殺子程序
    expect(backgroundLimiterStats().shadowRunning).toBe(1);
    // 一堆無關的正常 session 被 TTL/dispatch reclaim → 對它們 unmark（未 mark 過）
    unmarkShadow("normal-1");
    unmarkShadow("normal-2");
    unmarkShadow("normal-3");
    // 真 shadow 必須還在，沒被抵銷
    expect(backgroundLimiterStats().shadowRunning).toBe(1);
    unmarkShadow("real-shadow");
    expect(backgroundLimiterStats().shadowRunning).toBe(0);
  });

  it("unmark 冪等：重複 unmark 不會變負", () => {
    __resetBackgroundLimiterForTest();
    markShadow("x");
    unmarkShadow("x");
    unmarkShadow("x");
    unmarkShadow("x");
    expect(backgroundLimiterStats().shadowRunning).toBe(0);
  });
});
