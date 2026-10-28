import { describe, it, expect } from "vitest";
import {
  modelFor, parseEffort, deepEffort, orchestratorEffort, agentEffort,
  effortForAgent, effortArgs, ORCHESTRATOR_AGENT_ID,
} from "./models.js";

describe("modelFor（家族別名，不寫死版本號）", () => {
  it("預設：fast=haiku、balanced=sonnet、deep=opus", () => {
    expect(modelFor("fast", {})).toBe("haiku");
    expect(modelFor("balanced", {})).toBe("sonnet");
    expect(modelFor("deep", {})).toBe("opus");
  });

  it("任何預設都不是 Fable（-p 模式下 Fable 走 usage credits 會不經詢問直接扣）", () => {
    for (const t of ["fast", "balanced", "deep"] as const) {
      expect(modelFor(t, {}).toLowerCase()).not.toContain("fable");
    }
  });

  it("環境變數可覆蓋（含釘版用的完整 model id），前後空白忽略", () => {
    expect(modelFor("deep", { DASHBOARD_MODEL_DEEP: " claude-opus-4-7 " })).toBe("claude-opus-4-7");
    expect(modelFor("fast", { DASHBOARD_MODEL_FAST: "sonnet" })).toBe("sonnet");
  });

  it("空字串覆蓋 → 退回預設", () => {
    expect(modelFor("balanced", { DASHBOARD_MODEL_BALANCED: "  " })).toBe("sonnet");
  });
});

describe("parseEffort", () => {
  it("未設定 → fallback", () => {
    expect(parseEffort(undefined, "high")).toBe("high");
    expect(parseEffort(undefined)).toBeUndefined();
  });
  it("合法等級（不分大小寫）", () => {
    for (const lv of ["low", "medium", "high", "xhigh", "max"]) {
      expect(parseEffort(lv.toUpperCase(), "low")).toBe(lv);
    }
  });
  it("default / auto / 空字串 → undefined（明確交給模型預設）", () => {
    for (const raw of ["default", "auto", "", " "]) {
      expect(parseEffort(raw, "high")).toBeUndefined();
    }
  });
  it("打錯字 → fallback（不把未知值帶進 CLI 參數）", () => {
    expect(parseEffort("hihg", "high")).toBe("high");
    expect(parseEffort("ultra", undefined)).toBeUndefined();
  });
});

describe("各層 effort 預設", () => {
  it("deep 層（研究綜整/能力學習）預設 high", () => {
    expect(deepEffort({})).toBe("high");
    expect(deepEffort({ DASHBOARD_EFFORT_DEEP: "xhigh" })).toBe("xhigh");
  });
  it("專案經理預設 high；一般 agent 預設不指定", () => {
    expect(orchestratorEffort({})).toBe("high");
    expect(agentEffort({})).toBeUndefined();
    expect(agentEffort({ DASHBOARD_EFFORT_AGENT: "medium" })).toBe("medium");
  });
  it("effortForAgent 依 agentId 分流", () => {
    expect(effortForAgent(ORCHESTRATOR_AGENT_ID, {})).toBe("high");
    expect(effortForAgent("marketing-content-creator", {})).toBeUndefined();
    expect(effortForAgent(ORCHESTRATOR_AGENT_ID, { DASHBOARD_EFFORT_PM: "default" })).toBeUndefined();
  });
});

describe("effortArgs", () => {
  it("有等級 → --effort 參數；undefined → 不帶任何參數（保留 CLI 預設）", () => {
    expect(effortArgs("high")).toEqual(["--effort", "high"]);
    expect(effortArgs(undefined)).toEqual([]);
  });
});
