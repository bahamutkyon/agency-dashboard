import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import { saveBriefing, getLatestBriefing } from "./cockpitStore.js";
import type { Briefing } from "./cockpitTypes.js";

const sample: Briefing = {
  date: "2026-07-03",
  generatedAt: 1,
  sections: [
    {
      kind: "decisions",
      title: "待拍板",
      items: [{ title: "X", body: "Y" }],
    },
  ],
};

describe("cockpitStore", () => {
  beforeEach(() => {
    db.exec("DELETE FROM cockpit_briefings");
  });

  it("save 後 getLatest 拿回同一份（含解析結構）", () => {
    saveBriefing({
      date: "2026-07-03",
      content: sample,
      raw: "raw1",
      status: "ok",
    });
    const r = getLatestBriefing();
    expect(r?.status).toBe("ok");
    expect(r?.content?.sections[0].items[0].title).toBe("X");
  });

  it("getLatest 回最新一筆（by createdAt）", async () => {
    saveBriefing({
      date: "2026-07-02",
      content: sample,
      raw: "old",
      status: "ok",
    });
    // 確保時間戳足夠不同，以免 SQLite 排序不確定
    await new Promise((resolve) => setTimeout(resolve, 10));
    saveBriefing({
      date: "2026-07-04",
      content: sample,
      raw: "new",
      status: "ok",
    });
    expect(getLatestBriefing()?.raw).toBe("new");
  });

  it("parse_failed 也能存/取，content 為 null", () => {
    saveBriefing({
      date: "2026-07-05",
      content: null,
      raw: "junk",
      status: "parse_failed",
    });
    const r = getLatestBriefing();
    expect(r?.status).toBe("parse_failed");
    expect(r?.content).toBeNull();
  });
});
