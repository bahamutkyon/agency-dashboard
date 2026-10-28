import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createActivityDeadline, positiveMsFromEnv, minutesLabel } from "./activityDeadline.js";

describe("createActivityDeadline", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("沒有任何活動 → idleMs 後以 idle 觸發", () => {
    const onExpire = vi.fn();
    createActivityDeadline({ idleMs: 1000, hardMs: 10_000, onExpire });
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledWith("idle");
  });

  it("持續有活動 → 超過 idleMs 很多倍也不觸發（這正是舊版固定牆鐘砍掉的情境）", () => {
    const onExpire = vi.fn();
    const d = createActivityDeadline({ idleMs: 1000, hardMs: 100_000, onExpire });
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(900);
      d.touch();
    }
    // 已過 18 秒（18 倍 idleMs）仍未觸發
    expect(onExpire).not.toHaveBeenCalled();
    // 停止活動後 idleMs 才觸發
    vi.advanceTimersByTime(1000);
    expect(onExpire).toHaveBeenCalledWith("idle");
  });

  it("一直有活動但超過 hardMs → 以 hard 觸發（防失控）", () => {
    const onExpire = vi.fn();
    const d = createActivityDeadline({ idleMs: 1000, hardMs: 5000, onExpire });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(500);
      d.touch();
    }
    expect(onExpire).toHaveBeenCalledOnce();
    expect(onExpire).toHaveBeenCalledWith("hard");
  });

  it("只觸發一次：idle 觸發後 hard 不再觸發", () => {
    const onExpire = vi.fn();
    createActivityDeadline({ idleMs: 1000, hardMs: 3000, onExpire });
    vi.advanceTimersByTime(10_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("clear() 之後永不觸發，touch() 也不會重新啟動", () => {
    const onExpire = vi.fn();
    const d = createActivityDeadline({ idleMs: 1000, hardMs: 3000, onExpire });
    d.clear();
    d.touch();
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("idleStartsOnFirstTouch：排隊期間（尚未 touch）不會以 idle 觸發，第一次 touch 後才開始計", () => {
    const onExpire = vi.fn();
    const d = createActivityDeadline({ idleMs: 1000, hardMs: 60_000, onExpire, idleStartsOnFirstTouch: true });
    vi.advanceTimersByTime(30_000); // 排隊 30 秒，遠超 idleMs
    expect(onExpire).not.toHaveBeenCalled();
    d.touch(); // 真正開始
    vi.advanceTimersByTime(999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith("idle");
  });

  it("idleStartsOnFirstTouch：一直沒開始也會在 hardMs 觸發（不會永遠掛著）", () => {
    const onExpire = vi.fn();
    createActivityDeadline({ idleMs: 1000, hardMs: 5000, onExpire, idleStartsOnFirstTouch: true });
    vi.advanceTimersByTime(5000);
    expect(onExpire).toHaveBeenCalledWith("hard");
  });

  it("hardMs 小於 idleMs 時以 idleMs 為準", () => {
    const onExpire = vi.fn();
    createActivityDeadline({ idleMs: 2000, hardMs: 500, onExpire });
    vi.advanceTimersByTime(1999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });
});

describe("positiveMsFromEnv", () => {
  it("合法正數 → 採用", () => { expect(positiveMsFromEnv("60000", 5)).toBe(60000); });
  it("未設定 / 空字串 / 非數字 / 0 / 負數 → fallback", () => {
    for (const raw of [undefined, "", "  ", "abc", "0", "-5"]) {
      expect(positiveMsFromEnv(raw, 42)).toBe(42);
    }
  });
});

describe("minutesLabel", () => {
  it("四捨五入成分鐘", () => {
    expect(minutesLabel(15 * 60_000)).toBe("15 分鐘");
    expect(minutesLabel(90_000)).toBe("2 分鐘");
  });
});
