import { describe, it, expect, vi } from "vitest";
import { performHandoff, type HandoffDeps } from "./handoffService.js";
import { upsertSession, appendMessage } from "./store.js";
import { getSessionState } from "./store/sessionState.js";

let n = 0;
function mk(opts: { ws?: string; title?: string; projectId?: string; noMsg?: boolean } = {}): string {
  const id = `hs_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: opts.ws ?? "w_hs", agentId: "agents-orchestrator", title: opts.title ?? "長對話", projectId: opts.projectId, createdAt: 1, updatedAt: 1, messages: [] } as any);
  if (!opts.noMsg) appendMessage(id, { role: "user", content: "交接", ts: 100 });
  return id;
}
function deps(): HandoffDeps & { start: any; stop: any; emit: any } {
  return {
    start: vi.fn((_ws: string, _o: any) => { const id = mk({ title: "👨‍💼 專案經理", noMsg: true }); return id; }),
    stop: vi.fn(),
    emit: vi.fn(),
  };
}

describe("performHandoff", () => {
  it("存交接單、開新對話（同工作區/project、帶 handoffFrom）、舊對話標 done＋去向、emit", () => {
    const from = mk({ ws: "w_hs", projectId: "p1" });
    const d = deps();
    const r = performHandoff(from, "🎯 目標：x", d);
    expect(r.ok).toBe(true);
    expect(d.start).toHaveBeenCalledWith("w_hs", { projectId: "p1", handoffFrom: from });
    const st = getSessionState(from)!;
    expect(st.handoffDoc).toBe("🎯 目標：x");
    expect(st.handedOffTo).toBe(r.toId);
    expect(st.state).toBe("done");
    expect(st.stoppedAt).toBe("已交接到新對話");
    expect(d.emit).toHaveBeenCalledWith("session:handoff", { fromId: from, toId: r.toId, toTitle: "👨‍💼 專案經理" });
  });

  it("已交接過且新對話還在 → 只更新交接單、沿用同一場，不重開", () => {
    const from = mk();
    const d = deps();
    const first = performHandoff(from, "v1", d);
    const second = performHandoff(from, "v2", d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(second.toId).toBe(first.toId);
    expect(getSessionState(from)!.handoffDoc).toBe("v2");
    expect(d.stop).toHaveBeenCalledWith(first.toId);
  });

  it("沿用時新對話已開聊 → 不停程序", () => {
    const from = mk();
    const d = deps();
    const first = performHandoff(from, "v1", d);
    appendMessage(first.toId!, { role: "user", content: "開始", ts: 200 });
    performHandoff(from, "v2", d);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it("沿用時新對話已開聊 → 不改寫交接單（新對話拿到的是 v1，卡片與喚醒 prompt 不能悄悄換成 v2）", () => {
    const from = mk();
    const d = deps();
    const first = performHandoff(from, "v1", d);
    appendMessage(first.toId!, { role: "user", content: "開始", ts: 200 });
    const r = performHandoff(from, "v2", d);
    expect(r).toMatchObject({ ok: true, toId: first.toId, reused: true });
    expect(getSessionState(from)!.handoffDoc).toBe("v1");
  });

  it("開新對話失敗 → 交接單已存、舊對話不標 done、emit handoff_failed", () => {
    const from = mk();
    const d = deps();
    d.start = vi.fn(() => { throw new Error("spawn 失敗"); });
    const r = performHandoff(from, "v1", d);
    expect(r.ok).toBe(false);
    expect(getSessionState(from)!.handoffDoc).toBe("v1");
    expect(getSessionState(from)!.state).not.toBe("done");
    expect(d.emit).toHaveBeenCalledWith("session:handoff_failed", { fromId: from, error: "spawn 失敗" });
  });

  it("來源不存在 → ok:false，不呼叫 start", () => {
    const d = deps();
    expect(performHandoff("__none__", "x", d).ok).toBe(false);
    expect(d.start).not.toHaveBeenCalled();
  });
});
