import { describe, it, expect } from "vitest";
import { buildCategoryLearningPrompt, buildAgentLearningPrompt } from "./capabilityPrompts.js";

describe("buildCategoryLearningPrompt", () => {
  it("含類別名稱與 domain 標記指示", () => {
    const p = buildCategoryLearningPrompt("行銷部");
    expect(p).toContain("行銷部");
    expect(p).toContain("=== LEARN kind=domain ===");
    expect(p).toContain("5-8");
  });
});

describe("buildAgentLearningPrompt", () => {
  it("含 agent 名稱、描述與 craft 標記指示", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "專注抖音平台的短視頻營銷專家", "");
    expect(p).toContain("抖音策略師");
    expect(p).toContain("專注抖音平台的短視頻營銷專家");
    expect(p).toContain("=== LEARN kind=craft ===");
  });

  it("類記憶為空時不出現「類共通能力」段落", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "描述", "");
    expect(p).not.toContain("類共通能力");
  });

  it("類記憶非空時帶入「類共通能力」段落與內容", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "描述", "- [2026-05-21] 要懂演算法");
    expect(p).toContain("類共通能力");
    expect(p).toContain("要懂演算法");
  });
});
