import { describe, it, expect } from "vitest";
import { autoScrollMode } from "./chatScroll";

const base = { initialPending: false, prevCount: 5, count: 5, lastRole: "assistant", distanceFromBottom: 500 };

describe("autoScrollMode", () => {
  it("剛打開對話、歷史載入進來 → 直接跳到最底（不管目前位置）", () => {
    expect(autoScrollMode({ ...base, initialPending: true, prevCount: 0, count: 40, distanceFromBottom: 9000 })).toBe("jump");
  });
  it("歷史還沒載入（0 則）→ 不動，等載入", () => {
    expect(autoScrollMode({ ...base, initialPending: true, prevCount: 0, count: 0 })).toBe("none");
  });
  it("自己剛送出訊息 → 捲到底，即使原本在上面翻舊訊息", () => {
    expect(autoScrollMode({ ...base, prevCount: 5, count: 6, lastRole: "user" })).toBe("smooth");
  });
  it("貼近底部時有新回覆 → 跟著捲", () => {
    expect(autoScrollMode({ ...base, distanceFromBottom: 40 })).toBe("smooth");
  });
  it("往上翻舊訊息時有新回覆 → 不打擾", () => {
    expect(autoScrollMode({ ...base, count: 6, lastRole: "assistant", distanceFromBottom: 500 })).toBe("none");
  });
});
