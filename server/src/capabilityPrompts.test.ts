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

  it("agentBody 非空時帶入「完整角色設定」段落與內容", () => {
    const body = "## 我的職責\n- 設計低延遲韌體\n- 寫 ISR 處理 watchdog";
    const p = buildAgentLearningPrompt("嵌入式韌體工程師", "裸機開發", "", body);
    expect(p).toContain("完整角色設定");
    expect(p).toContain("watchdog");
  });

  it("agentBody 為空（未傳）時不出現「完整角色設定」段落（向後相容）", () => {
    const p = buildAgentLearningPrompt("嵌入式韌體工程師", "裸機開發", "");
    expect(p).not.toContain("完整角色設定");
  });
});
