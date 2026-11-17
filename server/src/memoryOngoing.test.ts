import { describe, it, expect } from "vitest";
import { ONGOING_HEADER, dropsOngoingSection } from "./memoryOngoing.js";

describe("dropsOngoingSection（蒸餾後置檢查）", () => {
  const withSec = `${ONGOING_HEADER}\n- M83421 電容定價：等使用者拍外殼照片\n\n## 偏好\n- 簡潔`;
  it("舊版有「進行中的事」區塊、新版不見了 → 判定丟失（放棄這次蒸餾）", () => {
    expect(dropsOngoingSection(withSec, "## 偏好\n- 簡潔")).toBe(true);
  });
  it("新版保留區塊（內容可變）→ 沒丟", () => {
    expect(dropsOngoingSection(withSec, `${ONGOING_HEADER}\n- （目前沒有）\n\n## 偏好`)).toBe(false);
  });
  it("舊版本來就沒有這個區塊（第一次採用新格式）→ 不擋", () => {
    expect(dropsOngoingSection("## 偏好\n- 簡潔", "## 偏好")).toBe(false);
    expect(dropsOngoingSection("", "## 偏好")).toBe(false);
  });
  it("標題前後空白、全形括號差異仍認得", () => {
    expect(dropsOngoingSection(withSec, "##  與使用者進行中的事 (停在哪/等誰)\n- x")).toBe(false);
  });
});
