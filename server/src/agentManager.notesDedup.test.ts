/**
 * agentManager.send() — session 級筆記去重
 *
 * 驗證：
 * 1. 同 session 第二次 send 對同一筆記不重複注入（augmented 不帶 <context> tag）
 * 2. 跨 session（不同 sessionId）去重不互相影響
 * 3. stop() 後去重記錄清除（同 sessionId 重建後可再次注入）
 */
import { describe, it, expect, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";
import { upsertSession, deleteSession, DEFAULT_WORKSPACE_ID } from "./store.js";
import { upsertNote, deleteNote } from "./store.js";
import type { SendResult } from "./agentSession.js";

const createdSessionIds: string[] = [];
const createdNoteIds: string[] = [];

// 固定 noteId，body 含關鍵字讓 BM25 確保命中
const NOTE_ID = "dedup-test-note-001";
const NOTE_QUERY = "台灣就業市場分析台灣就業台灣就業";

function seedSession(id: string) {
  const now = Date.now();
  upsertSession({
    id,
    workspaceId: DEFAULT_WORKSPACE_ID,
    agentId: "coder",
    title: "dedup-test",
    provider: "claude",
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  createdSessionIds.push(id);
}

function seedNote() {
  upsertNote({
    id: NOTE_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    title: "台灣就業市場分析報告",
    body: "台灣就業市場研究：台灣就業整體穩健，科技業需求高漲，製造業面臨轉型壓力。台灣就業率維持在 96% 以上。",
    pinned: false,
    createdAt: 1000,
    updatedAt: 1000,
  });
  createdNoteIds.push(NOTE_ID);
}

/** 假 session：有 workspaceId → 觸發 notes 注入；provider codex → 跳過 MCP refresh */
function makeFakeSession(id: string, sendResult: SendResult = "sent") {
  const calls: string[] = [];
  const fake: any = {
    id,
    provider: "codex" as const, // 跳過 MCP refresh
    status: "idle",
    mcpConfigJson: null,
    workspaceId: DEFAULT_WORKSPACE_ID,
    send: (text: string): SendResult => { calls.push(text); return sendResult; },
    stop: () => { fake.status = "closed"; },
    removeAllListeners: () => {},
  };
  return { fake, calls };
}

afterEach(() => {
  for (const id of createdSessionIds) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  createdSessionIds.length = 0;
  for (const id of createdNoteIds) {
    try { deleteNote(id); } catch { /* ignore */ }
  }
  createdNoteIds.length = 0;
});

describe("agentManager.send() 筆記去重", () => {
  it("第一次 send 含相關筆記時，augmented 帶 <context> tag", () => {
    seedNote();
    const sessId = "dedup-sess-first-001";
    seedSession(sessId);
    const mgr = new AgentManager();
    const { fake, calls } = makeFakeSession(sessId);
    (mgr as any).sessions.set(sessId, fake);

    mgr.send(sessId, NOTE_QUERY);

    // 第一次應注入 context
    const sentText = calls[0] ?? "";
    expect(sentText).toContain('<context source="筆記:');
  });

  it("同 session 第二次 send 相同筆記 → 不重複注入（無 <context> tag）", () => {
    seedNote();
    const sessId = "dedup-sess-second-001";
    seedSession(sessId);
    const mgr = new AgentManager();
    const { fake, calls } = makeFakeSession(sessId);
    (mgr as any).sessions.set(sessId, fake);

    mgr.send(sessId, NOTE_QUERY);
    mgr.send(sessId, NOTE_QUERY); // 第二次，同一筆記

    // 第一次有 context
    expect(calls[0]).toContain('<context source="筆記:');
    // 第二次不再有 context
    expect(calls[1]).not.toContain('<context source="筆記:');
  });

  it("不同 session 的去重彼此獨立（sessA 已注入不影響 sessB）", () => {
    seedNote();
    const sessA = "dedup-sess-a-001";
    const sessB = "dedup-sess-b-001";
    seedSession(sessA);
    seedSession(sessB);
    const mgr = new AgentManager();
    const { fake: fakeA, calls: callsA } = makeFakeSession(sessA);
    const { fake: fakeB, calls: callsB } = makeFakeSession(sessB);
    (mgr as any).sessions.set(sessA, fakeA);
    (mgr as any).sessions.set(sessB, fakeB);

    mgr.send(sessA, NOTE_QUERY); // A 已注入
    mgr.send(sessB, NOTE_QUERY); // B 是新 session，應注入

    expect(callsA[0]).toContain('<context source="筆記:');
    expect(callsB[0]).toContain('<context source="筆記:'); // B 獨立，也要注入
  });

  it("stop() 後同 sessionId 重新注入可以清楚（去重記錄被清除）", () => {
    seedNote();
    const sessId = "dedup-sess-stop-001";
    seedSession(sessId);
    const mgr = new AgentManager();
    const { fake, calls } = makeFakeSession(sessId);
    (mgr as any).sessions.set(sessId, fake);

    mgr.send(sessId, NOTE_QUERY); // 第一次注入
    expect(calls[0]).toContain('<context source="筆記:');

    mgr.send(sessId, NOTE_QUERY); // 第二次：已注入過，不重複
    expect(calls[1]).not.toContain('<context source="筆記:');

    // stop 清除去重記錄
    mgr.stop(sessId);

    // 同 sessId 重新建立（模擬 session restart）
    const { fake: fake2, calls: calls2 } = makeFakeSession(sessId);
    (mgr as any).sessions.set(sessId, fake2);
    mgr.send(sessId, NOTE_QUERY);
    // 去重記錄已被 stop() 清除，所以應再次注入
    expect(calls2[0]).toContain('<context source="筆記:');
  });
});
