import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db.js";
import {
  setTierOverride, getTierOverride, listOverrides,
  saveCapabilityReport, getLatestReport, lastResearchedAt,
  listStudySchedules, updateStudySchedule, touchStudyScheduleRun,
} from "./studyStore.js";

beforeEach(() => {
  db.exec("DELETE FROM agent_study_prefs; DELETE FROM agent_capability_reports;");
});

describe("studyStore", () => {
  it("覆寫讀寫 + 清除", () => {
    setTierOverride("a1", "hot");
    expect(getTierOverride("a1")).toBe("hot");
    setTierOverride("a1", null);
    expect(getTierOverride("a1")).toBeNull();
  });
  it("能力報告寫入後可取最新 + lastResearchedAt", () => {
    const id = saveCapabilityReport({ agentId: "a1", report: "現況", sources: ["http://x"], runId: "r1" });
    expect(id).toBeTruthy();
    const latest = getLatestReport("a1");
    expect(latest?.report).toBe("現況");
    expect(latest?.sources).toEqual(["http://x"]);
    expect(lastResearchedAt("a1")).toBeGreaterThan(0);
    expect(lastResearchedAt("never")).toBeNull();
  });
  it("分層排程種子可讀、可更新 enabled/cron/cap", () => {
    const before = listStudySchedules();
    expect(before.find((s) => s.tier === "hot")).toBeTruthy();
    updateStudySchedule("hot", { enabled: true, perRunCap: 5 });
    const hot = listStudySchedules().find((s) => s.tier === "hot")!;
    expect(hot.enabled).toBe(true);
    expect(hot.perRunCap).toBe(5);
  });
});
