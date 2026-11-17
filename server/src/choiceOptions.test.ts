import { describe, it, expect } from "vitest";
import { parseChoiceOptions } from "./choiceOptions.js";

describe("parseChoiceOptions（從專案經理最後一則回覆抓 A/B/C 選項）", () => {
  it("抓出連續的 A/B/C 選項（多種標點）", () => {
    const t = "問題 2：LP audio 走到哪一步？\n\nA. 從零開始：作品有了\nB）有少量客人\nC、已經有通路\n\n我的建議：A 或 B";
    expect(parseChoiceOptions(t)).toEqual([
      { key: "A", label: "從零開始：作品有了" },
      { key: "B", label: "有少量客人" },
      { key: "C", label: "已經有通路" },
    ]);
  });
  it("Markdown 粗體與條列符號也認得；選項太長截 40 字", () => {
    const t = `- **A.** ${"很".repeat(60)}\n- **B.** 第二`;
    const r = parseChoiceOptions(t)!;
    expect(r.map((o) => o.key)).toEqual(["A", "B"]);
    expect([...r[0].label].length).toBeLessThanOrEqual(41);
  });
  it("只有一個、或不是從 A 開始 → 不算選項", () => {
    expect(parseChoiceOptions("A. 只有一個")).toBeNull();
    expect(parseChoiceOptions("B. x\nC. y")).toBeNull();
    expect(parseChoiceOptions("一般回覆，沒有選項")).toBeNull();
  });
  it("多組選項時取最後一組（最後問的那題）", () => {
    const t = "A. 舊1\nB. 舊2\n\n問題 2：\nA. 新1\nB. 新2\nC. 新3";
    expect(parseChoiceOptions(t)!.map((o) => o.label)).toEqual(["新1", "新2", "新3"]);
  });
});
