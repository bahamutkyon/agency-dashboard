import { describe, it, expect, vi } from "vitest";
import { runTopicResearch, type ResearchDeps, type ResearchFinding } from "./researchRunner.js";

// 這些測試只驗證「規劃→並行研究→綜合→存 note」整條 orchestration，
// 全用注入的 fake 三階段函式 + fake saveNote，完全不打真 LLM、不寫 DB。

function makeDeps(over: Partial<ResearchDeps> = {}): {
  deps: ResearchDeps;
  saved: any[];
  researched: string[];
} {
  const saved: any[] = [];
  const researched: string[] = [];
  const deps: ResearchDeps = {
    plan: async (q) => [`${q} 子題A`, `${q} 子題B`, `${q} 子題C`],
    research: async (sq) => {
      researched.push(sq);
      return {
        findings: `對「${sq}」的發現`,
        sources: [`https://example.com/${encodeURIComponent(sq)}`],
        confidence: "high",
      };
    },
    synthesize: async (_q, findings) =>
      `綜合結論（${findings.length} 個子題）`,
    saveNote: (input) => {
      saved.push(input);
      return "rnote_fake_id";
    },
    ...over,
  };
  return { deps, saved, researched };
}

describe("runTopicResearch 三階段 orchestration", () => {
  it("規劃 3 子題 → 並行研究 → 綜合 → saveNote 帶正確 workspaceId/topic/彙整來源", async () => {
    const { deps, saved, researched } = makeDeps();
    const result = await runTopicResearch(
      { workspaceId: "ws-123", question: "台灣 AI 產業前景" },
      deps,
    );

    // 規劃出 3 子題並全部研究過
    expect(result.subQuestions).toHaveLength(3);
    expect(researched).toHaveLength(3);

    // findings 結構正確
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f: ResearchFinding) => f.status === "ok")).toBe(true);

    // 來源彙整且去重
    expect(result.sources).toHaveLength(3);

    // 綜合結論
    expect(result.synthesis).toContain("綜合結論");

    // saveNote 被呼叫一次，帶正確 workspaceId / topic / 彙整來源
    expect(saved).toHaveLength(1);
    expect(saved[0].workspaceId).toBe("ws-123");
    expect(saved[0].topic).toBe("台灣 AI 產業前景");
    expect(saved[0].summary).toBe(result.synthesis);
    expect(saved[0].sources).toEqual(result.sources);

    // ResearchResult 結構
    expect(result.question).toBe("台灣 AI 產業前景");
    expect(result.noteId).toBe("rnote_fake_id");
  });

  it("去重：多個子題回相同 URL 只保留一份", async () => {
    const { deps } = makeDeps({
      research: async (sq) => ({
        findings: `f:${sq}`,
        sources: ["https://dup.example.com", "https://dup.example.com"],
      }),
    });
    const result = await runTopicResearch({ workspaceId: "w", question: "Q" }, deps);
    expect(result.sources).toEqual(["https://dup.example.com"]);
  });

  it("規劃解析失敗（回空陣列）→ 回退單一子問題仍能跑完", async () => {
    const { deps, saved } = makeDeps({ plan: async () => [] });
    const result = await runTopicResearch(
      { workspaceId: "w", question: "回退測試問題" },
      deps,
    );
    expect(result.subQuestions).toEqual(["回退測試問題"]);
    expect(result.findings).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it("規劃拋錯 → 回退單一子問題仍能跑完", async () => {
    const { deps } = makeDeps({
      plan: async () => {
        throw new Error("planning LLM 掛了");
      },
    });
    const result = await runTopicResearch({ workspaceId: "w", question: "Q2" }, deps);
    expect(result.subQuestions).toEqual(["Q2"]);
    expect(result.findings).toHaveLength(1);
  });

  it("某子題研究失敗 → 部分結果，不整批崩，綜合與存 note 照常", async () => {
    const { deps, saved } = makeDeps({
      research: async (sq) => {
        if (sq.includes("子題B")) throw new Error("該子題逾時");
        return { findings: `ok:${sq}`, sources: [`https://ok/${encodeURIComponent(sq)}`] };
      },
    });
    const result = await runTopicResearch({ workspaceId: "w", question: "部分失敗題" }, deps);

    expect(result.findings).toHaveLength(3);
    const failed = result.findings.filter((f) => f.status === "error");
    const ok = result.findings.filter((f) => f.status === "ok");
    expect(failed).toHaveLength(1);
    expect(ok).toHaveLength(2);
    // 失敗子題不貢獻來源；成功的兩個各一 → 2 個來源
    expect(result.sources).toHaveLength(2);
    // 仍有存 note
    expect(saved).toHaveLength(1);
  });

  it("onProgress 會回報階段與完成數", async () => {
    const events: any[] = [];
    const { deps } = makeDeps({ onProgress: (p) => events.push(p) });
    await runTopicResearch({ workspaceId: "w", question: "進度題" }, deps);
    const stages = events.map((e) => e.stage);
    expect(stages).toContain("planned");
    expect(stages).toContain("researching");
    expect(stages).toContain("synthesized");
    // 最後一個 researching 事件 done 應等於 total
    const researching = events.filter((e) => e.stage === "researching");
    expect(researching[researching.length - 1].done).toBe(3);
  });
});

describe("researchRunner 模型分級", () => {
  it("三個階段各用對應的家族別名（不寫死版本號，CLI 升級自動跟上最新版）", async () => {
    const { planModel, researchStageModel, synthesisModel } = await import(
      "./researchRunner.js"
    );
    // 規劃：機械任務用 Haiku 家族
    expect(planModel()).toBe("haiku");
    // 研究：帶 web 工具查證用 Sonnet 家族
    expect(researchStageModel()).toBe("sonnet");
    // 綜合：高品質綜整用 Opus 家族
    expect(synthesisModel()).toBe("opus");
  });
});
