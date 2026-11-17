import { describe, it, expect } from "vitest";
import { applyDelta, applyFinal, type MergeMsg } from "./chatMerge";

const u = (c: string): MergeMsg => ({ role: "user", content: c, ts: 0 });

describe("chatMerge", () => {
  it("串流中插入補充訊息：串流內容仍更新在原本那則，不會多出一則重複回覆", () => {
    let m: MergeMsg[] = [u("問題")];
    m = applyDelta(m, "回覆前半");
    m = [...m, u("補充")];          // 使用者在回覆中送出補充
    m = applyDelta(m, "回覆前半＋後半");
    expect(m.map((x) => x.content)).toEqual(["問題", "回覆前半＋後半", "補充"]);
  });

  it("最終訊息取代串流中的那則（即使後面已有補充）", () => {
    let m: MergeMsg[] = [u("問題")];
    m = applyDelta(m, "部分");
    m = [...m, u("補充")];
    m = applyFinal(m, "完整回覆");
    expect(m.map((x) => [x.content, !!x.partial])).toEqual([["問題", false], ["完整回覆", false], ["補充", false]]);
  });

  it("沒有串流中的訊息時，新增一則", () => {
    expect(applyDelta([u("q")], "a").map((x) => x.content)).toEqual(["q", "a"]);
    expect(applyFinal([u("q")], "a").map((x) => x.content)).toEqual(["q", "a"]);
  });
});
