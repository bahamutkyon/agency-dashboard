// server/src/actionProtocol.test.ts
import { describe, it, expect } from "vitest";
import { parseActions, classifyRisk, HIGH_RISK_KINDS } from "./actionProtocol.js";

describe("classifyRisk", () => {
  it("四類高風險 + plan 為 high", () => {
    for (const k of ["plan", "dispatch", "external_send", "destructive", "spend"] as const) {
      expect(classifyRisk(k)).toBe("high");
    }
  });
  it("迴圈控制信號為 low", () => {
    expect(classifyRisk("next_step")).toBe("low");
    expect(classifyRisk("goal_done")).toBe("low");
    expect(classifyRisk("need_input")).toBe("low");
  });
  it("HIGH_RISK_KINDS 含全部五項", () => {
    expect(HIGH_RISK_KINDS.slice().sort()).toEqual(["destructive", "dispatch", "external_send", "plan", "spend"]);
  });
});

describe("parseActions", () => {
  it("解析單一 next_step 區塊", () => {
    const text = "做完了一步。\n=== ACTION ===\nkind: next_step\nrisk: low\nsummary: 已抓取首頁\ndetail: 取得 12 筆\n=== END ACTION ===";
    const r = parseActions(text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "next_step", risk: "low", summary: "已抓取首頁", detail: "取得 12 筆" });
  });
  it("缺 risk 時用 kind 推導", () => {
    const r = parseActions("=== ACTION ===\nkind: external_send\nsummary: 寄信給客戶\n=== END ACTION ===");
    expect(r[0].risk).toBe("high");
  });
  it("缺 summary 用 detail 首行", () => {
    const r = parseActions("=== ACTION ===\nkind: next_step\ndetail: 第一行細節\n第二行\n=== END ACTION ===");
    expect(r[0].summary).toBe("第一行細節");
  });
  it("未知 kind 視為 need_input", () => {
    const r = parseActions("=== ACTION ===\nkind: bogus\nsummary: x\n=== END ACTION ===");
    expect(r[0].kind).toBe("need_input");
  });
  it("dispatch kind 另解析出 dispatchItems", () => {
    const text = "=== ACTION ===\nkind: dispatch\nsummary: 請教兩位\ndetail:\n- agentId: marketing-trend-researcher\n  mode: consult\n  task: 本週選題\n=== END ACTION ===";
    const r = parseActions(text);
    expect(r[0].kind).toBe("dispatch");
    expect(r[0].dispatchItems).toEqual([{ agentId: "marketing-trend-researcher", mode: "consult", task: "本週選題" }]);
  });
  it("多區塊全解析", () => {
    const text = "=== ACTION ===\nkind: next_step\nsummary: a\n=== END ACTION ===\n中間\n=== ACTION ===\nkind: goal_done\nsummary: b\n=== END ACTION ===";
    expect(parseActions(text)).toHaveLength(2);
  });
  it("無區塊回空陣列", () => {
    expect(parseActions("一般回覆，沒有標記")).toEqual([]);
  });
});
