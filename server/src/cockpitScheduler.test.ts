/**
 * cockpitScheduler 的失敗推播決策測試（純函式 buildCockpitFailureEvent）。
 *
 * 只測「該不該推、推什麼」的判斷；實際 cron 排程與 Telegram 發送不在此測。
 */
import { describe, it, expect } from "vitest";
import { buildCockpitFailureEvent } from "./cockpitScheduler.js";
import type { BriefingRow } from "./cockpitTypes.js";

function row(overrides: Partial<BriefingRow> = {}): BriefingRow {
  return {
    id: "b1",
    date: "2026-07-24",
    content: null,
    raw: "",
    status: "error",
    createdAt: 0,
    ...overrides,
  };
}

describe("buildCockpitFailureEvent", () => {
  it("簡報成功（ok）不推播 → 回 null（使用者在畫面上看得到，不吵）", () => {
    expect(buildCockpitFailureEvent(row({ status: "ok" }))).toBeNull();
  });

  it("parse_failed → 產生失敗推播事件，主旨帶當日日期", () => {
    const evt = buildCockpitFailureEvent(row({ status: "parse_failed", raw: "junk" }));
    expect(evt).not.toBeNull();
    expect(evt!.kind).toContain("簡報");
    expect(evt!.title).toContain("2026-07-24");
  });

  it("error 狀態也推播", () => {
    expect(buildCockpitFailureEvent(row({ status: "error", raw: "boom" }))).not.toBeNull();
  });

  it("OAuth 過期原文 → body 帶重登指引（讓使用者知道怎麼救）", () => {
    const evt = buildCockpitFailureEvent(
      row({ status: "parse_failed", raw: "Failed to authenticate: OAuth session expired and could not be refreshed" }),
    );
    expect(evt!.body).toMatch(/登入|重登|login/i);
    // 仍保留原始錯誤原文，方便排查
    expect(evt!.body).toContain("OAuth");
  });

  it("非 OAuth 的一般錯誤 → body 帶原文（截斷）", () => {
    const evt = buildCockpitFailureEvent(row({ status: "error", raw: "some other failure" }));
    expect(evt!.body).toContain("some other failure");
  });
});
