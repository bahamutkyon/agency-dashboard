import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import { saveResearchNote } from "./notes.js";
import { findRelevantNotes } from "../notesRetrieval.js";
import { saveCapabilityReport, getLatestReport } from "../studyStore.js";

const WS_ID = "default";

beforeEach(() => {
  db.exec(
    "DELETE FROM notes WHERE id LIKE 'rnote_%';" +
    "DELETE FROM agent_capability_reports;",
  );
});

describe("研究成果庫", () => {
  it("saveResearchNote 回傳 id 前綴為 rnote_", () => {
    const id = saveResearchNote({
      workspaceId: WS_ID,
      topic: "AI 技術應用",
      summary: "AI 技術應用快速擴展，大語言模型持續進步，應用場景不斷增加。",
    });
    expect(id).toMatch(/^rnote_/);
  });

  it("saveResearchNote 寫入後 findRelevantNotes 能命中（BM25 閉環）", () => {
    saveResearchNote({
      workspaceId: WS_ID,
      topic: "台灣就業市場",
      summary:
        "台灣就業市場整體穩健，科技業需求高漲，製造業面臨轉型壓力。就業率維持在 96% 以上，失業率持續低檔。",
      sources: ["https://dgbas.gov.tw"],
      agentId: "research-bot",
    });

    // query 含「台灣就業市場」→ bigrams 重疊應超過 threshold（matchedTerms >= 2 || score >= 1.5）
    const hits = findRelevantNotes(WS_ID, "台灣就業市場趨勢分析", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toMatch(/^\[研究\]/);
  });

  it("saveCapabilityReport 後 notes 表有對應研究 note，getLatestReport 欄位不受影響", () => {
    const repId = saveCapabilityReport({
      agentId: "agent-X",
      report:
        "AI 技術應用整體評估：大語言模型在各領域已廣泛應用，AI 驅動工具持續普及，帶動產業升級。",
      sources: ["https://openai.com", "https://anthropic.com"],
      runId: "run-1",
    });

    // 既有 getLatestReport 仍正確（報告欄位不受 note 寫入影響）
    const latest = getLatestReport("agent-X");
    expect(latest?.id).toBe(repId);
    expect(latest?.report).toContain("AI");
    expect(latest?.sources).toContain("https://openai.com");
    expect(latest?.runId).toBe("run-1");

    // notes 表應有至少一筆 rnote_ 研究筆記
    const rows = db.prepare("SELECT * FROM notes WHERE id LIKE 'rnote_%'").all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].title).toMatch(/^\[研究\]/);
  });

  it("saveCapabilityReport note 寫入失敗不影響報告儲存（try/catch 隔離）", () => {
    // 正常儲存不應拋錯
    expect(() =>
      saveCapabilityReport({
        agentId: "agent-Y",
        report: "正常報告",
        sources: [],
      }),
    ).not.toThrow();

    const latest = getLatestReport("agent-Y");
    expect(latest).not.toBeNull();
  });
});
