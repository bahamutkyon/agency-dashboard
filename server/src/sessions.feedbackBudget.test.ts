/**
 * 餵回 PM 的長度額度（2026-10）。
 *
 * 鎖住兩件事：
 *  1. 總量仍有上限（B4 防 PM 長對話膨脹的精神不變）。
 *  2. 人多時額度平分、每位都有份（舊版整包 slice 讓第 4 位之後的同事整段消失）。
 * 以及 trimReportKeepSelfCheck 的新參數 selfCheckMax 在正式額度下的行為。
 */
import { describe, it, expect } from "vitest";
import {
  consultBudgetPerAgent, CONSULT_FEEDBACK_TOTAL, CONSULT_FEEDBACK_PER_AGENT,
  REPORT_LIMIT, REPORT_SELF_CHECK_MAX, trimReportKeepSelfCheck,
} from "./routes/sessions.js";

describe("consultBudgetPerAgent", () => {
  it("人少時用單人上限", () => {
    expect(consultBudgetPerAgent(1)).toBe(CONSULT_FEEDBACK_PER_AGENT);
    expect(consultBudgetPerAgent(3)).toBe(CONSULT_FEEDBACK_PER_AGENT);
  });

  it("人多時總量平分，合計不超過總上限", () => {
    for (const n of [4, 5, 7, 10]) {
      const per = consultBudgetPerAgent(n);
      expect(per).toBeLessThanOrEqual(CONSULT_FEEDBACK_PER_AGENT);
      expect(per * n).toBeLessThanOrEqual(CONSULT_FEEDBACK_TOTAL);
    }
  });

  it("極端人數仍保底 1,500 字（每位都看得到重點）", () => {
    expect(consultBudgetPerAgent(100)).toBe(1_500);
  });

  it("0 人不炸", () => {
    expect(consultBudgetPerAgent(0)).toBe(CONSULT_FEEDBACK_PER_AGENT);
  });
});

describe("trimReportKeepSelfCheck 正式額度", () => {
  it("REPORT_LIMIT 內原樣回（舊 6,000 會砍掉的長回報現在完整保留）", () => {
    const text = "R".repeat(12_000) + "\n【完成自驗】已驗證完成";
    expect(trimReportKeepSelfCheck(text, REPORT_LIMIT, REPORT_SELF_CHECK_MAX)).toBe(text);
  });

  it("超過上限：頭部 = limit - selfCheckMax - 200，自驗段最多 selfCheckMax", () => {
    const head = "H".repeat(30_000);
    const selfCheck = "【完成自驗】" + "S".repeat(10_000);
    const out = trimReportKeepSelfCheck(head + "\n" + selfCheck, REPORT_LIMIT, REPORT_SELF_CHECK_MAX);
    const headLen = REPORT_LIMIT - REPORT_SELF_CHECK_MAX - 200;
    expect(out.startsWith("H".repeat(headLen))).toBe(true);
    expect(out.startsWith("H".repeat(headLen + 1))).toBe(false);
    const tail = out.slice(out.indexOf("【完成自驗】"));
    expect(tail.length).toBe(REPORT_SELF_CHECK_MAX);
  });
});
