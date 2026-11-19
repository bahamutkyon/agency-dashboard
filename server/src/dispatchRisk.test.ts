import { describe, it, expect } from "vitest";
import { dispatchNeedsApproval } from "./dispatchRisk.js";
import type { DispatchItem } from "./dispatchParser.js";

const it_ = (task: string, extra: Partial<DispatchItem> = {}): DispatchItem => ({ agentId: "a", mode: "execute", task, ...extra });

describe("dispatchNeedsApproval：只有對外動作才要人批", () => {
  it("內部工作（查資料、寫報告存檔、諮詢）免批", () => {
    expect(dispatchNeedsApproval([it_("查證 eBay 成交價並寫成報告存到工作資料夾")]).needs).toBe(false);
    expect(dispatchNeedsApproval([{ agentId: "a", mode: "consult", task: "這份合約有哪些風險" }]).needs).toBe(false);
  });
  it("對外動作關鍵字 → 要批，並說出原因", () => {
    for (const t of ["把 6 件電容上架到露天", "發布這篇 Threads 貼文", "把提案寄出給客戶", "到官網下單 2 台", "刪除舊的商品頁", "用我的帳號登入 FB"]) {
      const r = dispatchNeedsApproval([it_(t)]);
      expect(r.needs, t).toBe(true);
      expect(r.reasons.length, t).toBeGreaterThan(0);
    }
  });
  it("否定語句不算（「不要發布」「先不上架」）", () => {
    expect(dispatchNeedsApproval([it_("寫好三篇貼文草稿，不要發布，存成 md")]).needs).toBe(false);
    expect(dispatchNeedsApproval([it_("整理上架文案，先不上架")]).needs).toBe(false);
  });
  it("關鍵字出現在 deliverable/context 也算", () => {
    expect(dispatchNeedsApproval([it_("處理這批商品", { deliverable: "全部在蝦皮成上架狀態" })]).needs).toBe(true);
  });
  it("PM 標 external: true 一律要批（即使沒關鍵字）", () => {
    const r = dispatchNeedsApproval([it_("回覆那位客人", { external: true })]);
    expect(r.needs).toBe(true);
    expect(r.reasons).toContain("專案經理標為對外");
  });
  it("多項裡任一項要批就整張要批", () => {
    expect(dispatchNeedsApproval([it_("查行情"), it_("上架到 FB Marketplace")]).needs).toBe(true);
  });
});
