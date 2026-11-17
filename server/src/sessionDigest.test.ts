import { describe, it, expect, vi } from "vitest";
import { parseDigest, maybeDigestOnReclaim } from "./sessionDigest.js";
import { upsertSession, appendMessage } from "./store.js";
import { getSessionState } from "./store/sessionState.js";

describe("parseDigest", () => {
  it("解析 STOPPED_AT / STATE", () => {
    expect(parseDigest("STOPPED_AT: 兩套定價表備好，等你拍外殼照片\nSTATE: waiting_user"))
      .toEqual({ stoppedAt: "兩套定價表備好，等你拍外殼照片", state: "waiting_user" });
  });
  it("STATE 不認得或缺 STOPPED_AT → null；超長截 80 字", () => {
    expect(parseDigest("STOPPED_AT: x\nSTATE: maybe")).toBeNull();
    expect(parseDigest("STATE: done")).toBeNull();
    expect(parseDigest(`STOPPED_AT: ${"字".repeat(200)}\nSTATE: open`)!.stoppedAt.length).toBe(80);
  });
});

let n = 0;
function mk(title: string, agentId = "agents-orchestrator", msgs = 2): string {
  const id = `dg_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: "w_dg", agentId, title, createdAt: 1, updatedAt: 1, messages: [] } as any);
  for (let i = 0; i < msgs; i++) appendMessage(id, { role: i % 2 ? "assistant" : "user", content: `m${i}`, ts: 100 + i });
  return id;
}

describe("maybeDigestOnReclaim", () => {
  const run = () => vi.fn(async () => "STOPPED_AT: 等你決定\nSTATE: waiting_user");

  it("互動式專案經理對話 → 跑摘要並存下", async () => {
    const r = run(); const id = mk("電容定價");
    await maybeDigestOnReclaim(id, r);
    expect(r).toHaveBeenCalledOnce();
    expect(getSessionState(id)).toMatchObject({ stoppedAt: "等你決定", state: "waiting_user" });
  });

  it("排程場次、非專案經理、太短 → 不跑（不花錢）", async () => {
    const r = run();
    await maybeDigestOnReclaim(mk("[排程 2026/7/1] LP"), r);
    await maybeDigestOnReclaim(mk("x", "seo"), r);
    await maybeDigestOnReclaim(mk("y", "agents-orchestrator", 1), r);
    expect(r).not.toHaveBeenCalled();
  });

  it("上次摘要後沒有新訊息 → 不重跑", async () => {
    const r = run(); const id = mk("z");
    await maybeDigestOnReclaim(id, r);
    await maybeDigestOnReclaim(id, r);
    expect(r).toHaveBeenCalledOnce();
  });

  it("模型失敗不拋錯", async () => {
    const id = mk("w");
    await expect(maybeDigestOnReclaim(id, async () => { throw new Error("boom"); })).resolves.toBeUndefined();
  });
});
