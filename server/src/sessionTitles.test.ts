import { describe, it, expect } from "vitest";
import { isDefaultTitle, ORCHESTRATOR_ID, ORCHESTRATOR_TITLE, displayTitle } from "./sessionTitles.js";

describe("isDefaultTitle", () => {
  it("專案經理的預設標題「👨‍💼 專案經理」算預設（舊判斷拿「智能體編排者」比對，從沒命名成功）", () => {
    expect(isDefaultTitle(ORCHESTRATOR_TITLE, ORCHESTRATOR_ID, "智能體編排者")).toBe(true);
  });
  it("agent 顯示名、「X 對話」算預設", () => {
    expect(isDefaultTitle("SEO 專家", "seo", "SEO 專家")).toBe(true);
    expect(isDefaultTitle("seo 對話", "seo", "SEO 專家")).toBe(true);
  });
  it("自訂標題、排程與派工標題不算預設", () => {
    expect(isDefaultTitle("M83421 電容定價", ORCHESTRATOR_ID, "智能體編排者")).toBe(false);
    expect(isDefaultTitle("[排程] 週報", ORCHESTRATOR_ID, "智能體編排者")).toBe(false);
    expect(isDefaultTitle("🛠️ 外包執行 · 做圖", "x", "X")).toBe(false);
  });
});

describe("displayTitle", () => {
  it("專案經理不加前綴（歷史/分頁已標示是專案經理）", () => {
    expect(displayTitle("電容定價", ORCHESTRATOR_ID, "智能體編排者")).toBe("電容定價");
  });
  it("其他 agent 維持「名稱 · 標題」，已含名稱不重複", () => {
    expect(displayTitle("關鍵字", "seo", "SEO 專家")).toBe("SEO 專家 · 關鍵字");
    expect(displayTitle("SEO 專家 談關鍵字", "seo", "SEO 專家")).toBe("SEO 專家 談關鍵字");
  });
});
