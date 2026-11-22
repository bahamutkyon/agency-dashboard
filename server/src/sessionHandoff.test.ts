import { describe, it, expect } from "vitest";
import { buildHandoff, handoffPromptBlock } from "./sessionHandoff.js";
import { upsertSession, appendMessage } from "./store.js";
import { setAutoDigest, setHandoffDoc } from "./store/sessionState.js";

let n = 0;
function mk(title: string, msgs: [string, string][]): string {
  const id = `ho_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: "w_ho", agentId: "agents-orchestrator", title, createdAt: 1, updatedAt: 1, messages: [] } as any);
  msgs.forEach(([role, content], i) => appendMessage(id, { role: role as any, content, ts: 100 + i }));
  return id;
}

describe("buildHandoff", () => {
  it("有新鮮的「停在哪」摘要 → 用摘要", () => {
    const id = mk("電容定價", [["user", "怎麼定價"], ["assistant", "等你拍照"]]);
    setAutoDigest(id, "兩套定價表備好，等你拍外殼照片", "waiting_user", 10_000);
    expect(buildHandoff(id)).toMatchObject({ fromTitle: "電容定價", summary: "兩套定價表備好，等你拍外殼照片", source: "digest" });
  });

  it("還沒摘要（或摘要後又有新訊息）→ 退回最後一則專案經理回覆的節錄", () => {
    const id = mk("代購評估", [["user", "q"], ["assistant", "A".repeat(500)]]);
    const h = buildHandoff(id)!;
    expect(h.source).toBe("excerpt");
    expect(h.summary.length).toBeLessThanOrEqual(301);
  });

  it("不存在或沒有回覆 → null", () => {
    expect(buildHandoff("__none__")).toBeNull();
    expect(buildHandoff(mk("空", [["user", "q"]]))).toBeNull();
  });

  it("注入段落提醒：跟上一場無關就忽略", () => {
    const block = handoffPromptBlock({ fromId: "x", fromTitle: "電容定價", summary: "等拍照", source: "digest" });
    expect(block).toContain("電容定價");
    expect(block).toContain("等拍照");
    expect(block).toContain("無關");
  });
});

describe("buildHandoff：完整交接單", () => {
  it("有交接單 → 優先於摘要，source=doc、內容完整", () => {
    const id = mk("長對話", [["user", "q"], ["assistant", "a"]]);
    setAutoDigest(id, "停在等拍照", "waiting_user", 10_000);
    const doc = ["🎯 目標：定價", "✅ 已決定：不走 FBA", "細節".repeat(400)].join("\n");
    setHandoffDoc(id, doc);
    expect(buildHandoff(id)).toMatchObject({ source: "doc", summary: doc, fromTitle: "長對話" });
  });
  it("有交接單但沒有任何專案經理回覆也能帶", () => {
    const id = mk("只有使用者", [["user", "q"]]);
    setHandoffDoc(id, "🎯 目標：x");
    expect(buildHandoff(id)?.source).toBe("doc");
  });
  it("doc 版注入段落：明說是交接單、已決定的不要重問", () => {
    const block = handoffPromptBlock({ fromId: "x", fromTitle: "長對話", summary: "🎯 目標：定價", source: "doc" });
    expect(block).toContain("交接單");
    expect(block).toContain("🎯 目標：定價");
    expect(block).toContain("不要重問");
  });
});
