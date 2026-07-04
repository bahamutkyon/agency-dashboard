/**
 * upsertSession / deleteSession — 交易原子性
 *
 * 驗證：
 * 1. upsertSession 帶 messages 時訊息完整寫入（交易正常路徑）
 * 2. 第二次 upsertSession 能正確替換全部訊息（DELETE + INSERT 原子）
 * 3. deleteSession 後 session 與 messages 都消失
 * 4. 既有 sessions 測試行為不受交易化影響（向後相容）
 */
import { describe, it, expect, afterEach } from "vitest";
import { upsertSession, getSession, appendMessage, deleteSession } from "./store.js";
import { createWorkspace, deleteWorkspace } from "./store.js";
import type { SessionRecord } from "./store.js";

const wsIds: string[] = [];
const sessionIds: string[] = [];

afterEach(() => {
  for (const id of sessionIds.splice(0)) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  for (const id of wsIds.splice(0)) {
    try { deleteWorkspace(id); } catch { /* ignore */ }
  }
});

function baseSession(id: string, wsId: string): SessionRecord {
  return {
    id,
    workspaceId: wsId,
    agentId: "test-agent",
    title: "Test Session",
    provider: "claude",
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    tags: [],
  };
}

describe("upsertSession — 訊息交易寫入", () => {
  it("帶 messages 的 upsertSession 寫入訊息完整", () => {
    const ws = createWorkspace({ name: "txn-test-ws" });
    wsIds.push(ws.id);
    const sid = `txn-sess-${Date.now()}`;
    sessionIds.push(sid);

    upsertSession({
      ...baseSession(sid, ws.id),
      messages: [
        { role: "user", content: "第一句", ts: 1001 },
        { role: "assistant", content: "第二句", ts: 1002 },
        { role: "user", content: "第三句", ts: 1003 },
      ],
    });

    const rec = getSession(sid);
    expect(rec?.messages).toHaveLength(3);
    expect(rec?.messages[0].content).toBe("第一句");
    expect(rec?.messages[2].content).toBe("第三句");
  });

  it("第二次 upsertSession 完整替換訊息（舊訊息不殘留）", () => {
    const ws = createWorkspace({ name: "txn-test-ws2" });
    wsIds.push(ws.id);
    const sid = `txn-sess2-${Date.now()}`;
    sessionIds.push(sid);

    // 第一次寫入 3 條
    upsertSession({
      ...baseSession(sid, ws.id),
      messages: [
        { role: "user", content: "舊訊息1", ts: 1001 },
        { role: "assistant", content: "舊訊息2", ts: 1002 },
        { role: "user", content: "舊訊息3", ts: 1003 },
      ],
    });

    // 第二次只傳 1 條（應完全替換）
    upsertSession({
      ...baseSession(sid, ws.id),
      updatedAt: 2000,
      messages: [
        { role: "user", content: "新訊息", ts: 2001 },
      ],
    });

    const rec = getSession(sid);
    expect(rec?.messages).toHaveLength(1);
    expect(rec?.messages[0].content).toBe("新訊息");
  });

  it("不帶 messages（空陣列）時不觸動既有訊息", () => {
    const ws = createWorkspace({ name: "txn-test-ws3" });
    wsIds.push(ws.id);
    const sid = `txn-sess3-${Date.now()}`;
    sessionIds.push(sid);

    // 先建 session 再用 appendMessage 加訊息
    upsertSession({ ...baseSession(sid, ws.id) });
    appendMessage(sid, { role: "user", content: "現有訊息", ts: 1001 });

    // upsertSession 不帶 messages（空陣列）→ 不應覆蓋
    upsertSession({ ...baseSession(sid, ws.id), title: "新標題", updatedAt: 2000 });

    const rec = getSession(sid);
    expect(rec?.title).toBe("新標題");
    expect(rec?.messages).toHaveLength(1);
    expect(rec?.messages[0].content).toBe("現有訊息");
  });
});

describe("deleteSession — 交易刪除", () => {
  it("deleteSession 同時移除 session 及所有 messages", () => {
    const ws = createWorkspace({ name: "txn-del-ws" });
    wsIds.push(ws.id);
    const sid = `txn-del-${Date.now()}`;

    upsertSession({
      ...baseSession(sid, ws.id),
      messages: [
        { role: "user", content: "hi", ts: 1001 },
        { role: "assistant", content: "hello", ts: 1002 },
      ],
    });

    // 確認寫入成功
    expect(getSession(sid)?.messages).toHaveLength(2);

    deleteSession(sid);

    // session 與 messages 都應消失
    expect(getSession(sid)).toBeUndefined();
  });

  it("deleteSession 不存在的 id 不拋錯", () => {
    expect(() => deleteSession("non-existent-session-id")).not.toThrow();
  });
});
