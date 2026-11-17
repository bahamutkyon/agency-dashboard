import { describe, it, expect } from "vitest";
import { isDefaultTitle, isAutomatedTitle, agentLabel, pickResumable, ORCHESTRATOR_ID, PM_TITLE } from "./sessionTitles";
import type { SessionRecord } from "./api";

const s = (o: Partial<SessionRecord>): SessionRecord => ({
  id: o.id || "x", agentId: ORCHESTRATOR_ID, title: PM_TITLE, createdAt: 0, updatedAt: 0, messages: [], messageCount: 2, ...o,
});

describe("sessionTitles", () => {
  it("專案經理預設標題算預設；自訂標題不算", () => {
    expect(isDefaultTitle(PM_TITLE, ORCHESTRATOR_ID, "智能體編排者")).toBe(true);
    expect(isDefaultTitle("電容定價", ORCHESTRATOR_ID, "智能體編排者")).toBe(false);
  });

  it("排程/批次/workflow/設定顧問/派工子對話算自動產生", () => {
    for (const t of ["[排程 2026/7/1] LP", "[批次] x", "[workflow] y", "🤖 工作區設定顧問", "🤝 受派諮詢 · a", "🛠️ 外包執行 · b"]) {
      expect(isAutomatedTitle(t)).toBe(true);
    }
    expect(isAutomatedTitle("電容定價")).toBe(false);
  });

  it("agents-orchestrator 一律顯示「專案經理」，不再出現「智能體編排者」", () => {
    expect(agentLabel(ORCHESTRATOR_ID, "智能體編排者")).toBe("👨‍💼 專案經理");
    expect(agentLabel("seo", "SEO 專家")).toBe("SEO 專家");
  });

  it("pickResumable：只挑有訊息的互動式專案經理對話，新到舊", () => {
    const list = [
      s({ id: "old", updatedAt: 1 }),
      s({ id: "sched", title: "[排程 x] LP", updatedAt: 9 }),
      s({ id: "empty", messageCount: 0, updatedAt: 8 }),
      s({ id: "other", agentId: "seo", updatedAt: 7 }),
      s({ id: "new", title: "電容定價", updatedAt: 5 }),
    ];
    expect(pickResumable(list, 3).map((x) => x.id)).toEqual(["new", "old"]);
  });
});
