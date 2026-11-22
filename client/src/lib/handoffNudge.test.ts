import { describe, it, expect } from "vitest";
import { shouldNudge, handoffSwitchTarget, NUDGE_MESSAGES, NUDGE_CHARS } from "./handoffNudge";

describe("shouldNudge", () => {
  it("則數或字數達門檻才提醒", () => {
    expect(shouldNudge({ messageCount: NUDGE_MESSAGES - 1, totalChars: NUDGE_CHARS - 1 })).toBe(false);
    expect(shouldNudge({ messageCount: NUDGE_MESSAGES })).toBe(true);
    expect(shouldNudge({ messageCount: 3, totalChars: NUDGE_CHARS })).toBe(true);
  });
  it("按過不用或已交接 → 不提醒", () => {
    expect(shouldNudge({ messageCount: 999, dismissed: true })).toBe(false);
    expect(shouldNudge({ messageCount: 999, handedOff: true })).toBe(false);
  });
  it("門檻是 80 則／3 萬字", () => {
    expect(NUDGE_MESSAGES).toBe(80);
    expect(NUDGE_CHARS).toBe(30000);
  });
});

describe("handoffSwitchTarget", () => {
  it("正在看來源對話才切換", () => {
    expect(handoffSwitchTarget("a", { fromId: "a", toId: "b" })).toBe("b");
    expect(handoffSwitchTarget("c", { fromId: "a", toId: "b" })).toBeNull();
    expect(handoffSwitchTarget(undefined, { fromId: "a", toId: "b" })).toBeNull();
  });
});
