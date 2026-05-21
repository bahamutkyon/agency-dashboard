import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createWorkspace,
  upsertSession,
  listSessionsWithCounts,
  type SessionRecord,
} from "./store.js";
import { deleteWorkspace } from "./store.js";

// listSessionsWithCounts 必須用單一查詢回傳每個 session 的訊息數與最後一句預覽，
// 取代舊的「listSessions().map(getSession)」N+1 + 全訊息載入模式。
describe("listSessionsWithCounts", () => {
  let wsId: string;

  beforeAll(() => {
    const ws = createWorkspace({ name: "test-sessions-count" });
    wsId = ws.id;

    const base = (id: string, agentId: string, updatedAt: number): SessionRecord => ({
      id,
      workspaceId: wsId,
      agentId,
      title: id,
      provider: "claude",
      createdAt: 1000,
      updatedAt,
      messages: [],
      tags: [],
    });

    // session A：3 則訊息，較舊
    upsertSession({
      ...base("sess_A", "agent-x", 2000),
      messages: [
        { role: "user", content: "第一句", ts: 2001 },
        { role: "assistant", content: "第二句", ts: 2002 },
        { role: "user", content: "最後一句", ts: 2003 },
      ],
    });
    // session B：0 則訊息，較新
    upsertSession(base("sess_B", "agent-y", 3000));
  });

  afterAll(() => {
    deleteWorkspace(wsId);
  });

  it("回傳每個 session 的正確訊息數", () => {
    const rows = listSessionsWithCounts(wsId);
    const a = rows.find((r) => r.id === "sess_A");
    const b = rows.find((r) => r.id === "sess_B");
    expect(a?.messageCount).toBe(3);
    expect(b?.messageCount).toBe(0);
  });

  it("回傳最後一句訊息的預覽與角色", () => {
    const rows = listSessionsWithCounts(wsId);
    const a = rows.find((r) => r.id === "sess_A");
    expect(a?.lastSnippet).toBe("最後一句");
    expect(a?.lastRole).toBe("user");
  });

  it("空 session 的 lastSnippet 為 null", () => {
    const rows = listSessionsWithCounts(wsId);
    const b = rows.find((r) => r.id === "sess_B");
    expect(b?.lastSnippet).toBeNull();
    expect(b?.lastRole).toBeNull();
  });

  it("依 updatedAt 由新到舊排序", () => {
    const rows = listSessionsWithCounts(wsId);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf("sess_B")).toBeLessThan(ids.indexOf("sess_A"));
  });

  it("保留 session 基本欄位（agentId / provider / tags）", () => {
    const rows = listSessionsWithCounts(wsId);
    const a = rows.find((r) => r.id === "sess_A");
    expect(a?.agentId).toBe("agent-x");
    expect(a?.provider).toBe("claude");
    expect(Array.isArray(a?.tags)).toBe(true);
  });
});
