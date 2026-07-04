/**
 * agentManager.send() — appendMessage 時機一致化（無「落庫未送」）
 *
 * 舊行為：appendMessage 在 busy 檢查之前就把使用者訊息寫入 DB，之後 AgentSession
 * 若 busy 就丟棄 → 「DB 有這句、模型永遠收不到」的永久分岔。
 *
 * 新行為：先 s.send()（會排隊或送出），只有被接受（sent/queued，兩者都保證最終送達）
 * 才 appendMessage 落庫；被拒（rejected：佇列爆滿）則不落庫，維持 DB↔模型一致。
 *
 * 用真實 store（如其他 store 測試）+ 注入假 AgentSession 控制 send() 回傳值，
 * 避免真的 spawn CLI。
 */
import { describe, it, expect, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";
import { upsertSession, getSession, deleteSession, DEFAULT_WORKSPACE_ID } from "./store.js";
import type { SendResult } from "./agentSession.js";

const createdSessionIds: string[] = [];

function seedSession(id: string) {
  const now = Date.now();
  upsertSession({
    id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    agentId: "agents-orchestrator",
    title: "timing-test",
    provider: "claude",
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  createdSessionIds.push(id);
}

/** 假 session：可控 send() 回傳；無 workspaceId → 跳過 MCP refresh 與 notes 注入。 */
function makeFakeSession(sendResult: SendResult) {
  const calls: string[] = [];
  const fake = {
    provider: "claude" as const,
    status: "busy" as string,
    send: (text: string): SendResult => { calls.push(text); return sendResult; },
  };
  return { fake, calls };
}

afterEach(() => {
  for (const id of createdSessionIds) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  createdSessionIds.length = 0;
});

describe("agentManager.send() appendMessage 時機", () => {
  it("被接受（queued）→ 落庫一次 + s.send 被呼叫（busy 也會排隊送達）", () => {
    const id = "timing-queued";
    seedSession(id);
    const mgr = new AgentManager();
    const { fake, calls } = makeFakeSession("queued");
    (mgr as any).sessions.set(id, fake);

    const res = mgr.send(id, "外包回報內容");

    expect(res.ok).toBe(true);
    expect(calls).toEqual(["外包回報內容"]); // 確實送給了 session（排隊）
    const rec = getSession(id);
    const userMsgs = (rec?.messages || []).filter((m) => m.role === "user" && m.content === "外包回報內容");
    expect(userMsgs.length).toBe(1); // 落庫一次
  });

  it("被接受（sent）→ 落庫一次", () => {
    const id = "timing-sent";
    seedSession(id);
    const mgr = new AgentManager();
    const { fake } = makeFakeSession("sent");
    (mgr as any).sessions.set(id, fake);

    const res = mgr.send(id, "一般訊息");

    expect(res.ok).toBe(true);
    const rec = getSession(id);
    expect((rec?.messages || []).filter((m) => m.content === "一般訊息").length).toBe(1);
  });

  it("被拒（rejected：佇列爆滿）→ 不落庫、ok=false（無落庫未送）", () => {
    const id = "timing-rejected";
    seedSession(id);
    const mgr = new AgentManager();
    const { fake } = makeFakeSession("rejected");
    (mgr as any).sessions.set(id, fake);

    const res = mgr.send(id, "被拒的訊息");

    expect(res.ok).toBe(false);
    const rec = getSession(id);
    // 關鍵：既然沒送出（rejected），DB 就不該有這句 → 不製造「落庫未送」
    expect((rec?.messages || []).some((m) => m.content === "被拒的訊息")).toBe(false);
  });
});
