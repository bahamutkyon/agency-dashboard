/**
 * store/usage 的單元測試：雙寫邏輯 + bySource 彙總。
 * DB 在測試環境走 :memory:（IS_TEST=true，由 db.ts 決定），每次 vitest run 全新。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { recordUsageTurn, getUsageSummary } from "./usage.js";
import { db } from "../db.js";

/** 與 store/usage.ts 相同的本地日期字串邏輯（sv-SE = YYYY-MM-DD）。 */
function localDate(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

beforeEach(() => {
  // 清除測試數據，避免跨測試累積（in-memory DB 在同一 vitest run 中共享）
  db.exec("DELETE FROM usage_daily");
  db.exec("DELETE FROM usage_daily_source");
});

describe("recordUsageTurn 雙寫", () => {
  it("帶 source 後，usage_daily 總帳與 usage_daily_source 各自正確累加", () => {
    const today = localDate();
    recordUsageTurn(today, { costUSD: 0.01, inputTokens: 100, outputTokens: 50, turns: 1 }, "titler");
    recordUsageTurn(today, { costUSD: 0.02, inputTokens: 200, outputTokens: 100, turns: 1 }, "summarize");
    recordUsageTurn(today, { costUSD: 0.005, inputTokens: 50, outputTokens: 25, turns: 1 }, "titler");

    // 總帳 usage_daily：三筆合計
    const daily = db.prepare("SELECT * FROM usage_daily WHERE date = ?").get(today) as any;
    expect(daily).toBeTruthy();
    expect(daily.cost_usd).toBeCloseTo(0.035, 5);
    expect(daily.turns).toBe(3);

    // 來源 titler：兩筆
    const titler = db.prepare("SELECT * FROM usage_daily_source WHERE date = ? AND source = ?").get(today, "titler") as any;
    expect(titler).toBeTruthy();
    expect(titler.cost_usd).toBeCloseTo(0.015, 5);
    expect(titler.turns).toBe(2);
    expect(titler.input_tokens).toBe(150);

    // 來源 summarize：一筆
    const summarize = db.prepare("SELECT * FROM usage_daily_source WHERE date = ? AND source = ?").get(today, "summarize") as any;
    expect(summarize).toBeTruthy();
    expect(summarize.cost_usd).toBeCloseTo(0.02, 5);
    expect(summarize.turns).toBe(1);
  });

  it("不帶 source 預設 interactive 也寫進 usage_daily_source", () => {
    const today = localDate();
    recordUsageTurn(today, { costUSD: 0.005, turns: 1 }); // 無 source → 預設 interactive

    const interactive = db.prepare(
      "SELECT * FROM usage_daily_source WHERE date = ? AND source = ?",
    ).get(today, "interactive") as any;
    expect(interactive).toBeTruthy();
    expect(interactive.turns).toBe(1);
  });

  it("同 source 多次累加（UPSERT 正確）", () => {
    const today = localDate();
    recordUsageTurn(today, { costUSD: 0.1, turns: 1 }, "research");
    recordUsageTurn(today, { costUSD: 0.2, turns: 1 }, "research");

    const research = db.prepare(
      "SELECT * FROM usage_daily_source WHERE date = ? AND source = ?",
    ).get(today, "research") as any;
    expect(research.cost_usd).toBeCloseTo(0.3, 5);
    expect(research.turns).toBe(2);
  });
});

describe("getUsageSummary().bySource", () => {
  it("回傳今天 + 過去 7 天各 source 的彙總", () => {
    const today = localDate();
    recordUsageTurn(today, { costUSD: 0.1, turns: 5, inputTokens: 1000, outputTokens: 500 }, "research");
    recordUsageTurn(today, { costUSD: 0.01, turns: 10 }, "titler");

    const summary = getUsageSummary();
    expect(Array.isArray(summary.bySource)).toBe(true);

    const research = (summary.bySource as any[]).find((s) => s.source === "research");
    expect(research).toBeTruthy();
    expect(research.costUSD).toBeCloseTo(0.1, 5);
    expect(research.turns).toBe(5);
    expect(research.inputTokens).toBe(1000);

    const titler = (summary.bySource as any[]).find((s) => s.source === "titler");
    expect(titler).toBeTruthy();
    expect(titler.costUSD).toBeCloseTo(0.01, 5);
    expect(titler.turns).toBe(10);
  });

  it("沒有來源資料時 bySource 為空陣列", () => {
    const summary = getUsageSummary();
    expect(summary.bySource).toEqual([]);
  });

  it("bySource 按成本降序排列", () => {
    const today = localDate();
    recordUsageTurn(today, { costUSD: 0.01 }, "titler");
    recordUsageTurn(today, { costUSD: 0.5 }, "research");
    recordUsageTurn(today, { costUSD: 0.1 }, "distill");

    const summary = getUsageSummary();
    const sources = (summary.bySource as any[]).map((s) => s.source);
    // research(0.5) > distill(0.1) > titler(0.01)
    expect(sources.indexOf("research")).toBeLessThan(sources.indexOf("distill"));
    expect(sources.indexOf("distill")).toBeLessThan(sources.indexOf("titler"));
  });
});
