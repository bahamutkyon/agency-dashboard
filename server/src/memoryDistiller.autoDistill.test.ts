/**
 * memoryDistiller.maybeDistillOnReclaim — guard / dedup 行為
 *
 * 使用注入的 fake distiller（不打真 LLM），搭配 in-memory 測試 DB（VITEST 模式自動啟用）。
 *
 * 驗證：
 * 1. distilledFromSessionId === sessionId → 跳過（去重），distiller 不呼叫
 * 2. session messages.length < 2 → 跳過（短對話 guard），distiller 不呼叫
 * 3. session 不存在 → 跳過，distiller 不呼叫
 * 4. ≥ 2 訊息 + 未蒸餾過此 session → distiller 被呼叫一次（傳入正確 sessionId/workspaceId/agentId）
 * 5. 無 agent_memory 記錄（全新蒸餾）+ ≥ 2 訊息 → distiller 被呼叫
 * 6. distiller 回傳 ok:false → 函式不拋錯（fail-safe）
 * 7. distiller 拋錯 → 函式不拋錯（fail-safe wrapper 接住）
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  upsertSession, setAgentMemory, deleteSession, deleteAgentMemory,
} from "./store.js";
import { maybeDistillOnReclaim, type DistillResult } from "./memoryDistiller.js";

/** 每個 case 用唯一 workspace，避免 in-memory 共享 DB 跨 case 汙染 agent_memory */
const AGENT = "test-autoDistill-agent";
const WS = {
  dedup:    "ws-ad-dedup",
  short:    "ws-ad-short",
  notFound: "ws-ad-notfound",
  ok:       "ws-ad-ok",
  noMem:    "ws-ad-nomem",
  failOk:   "ws-ad-failok",
  throwOk:  "ws-ad-throwok",
};
const SESS = {
  dedup:    "sess-ad-dedup",
  short:    "sess-ad-short",
  notFound: "sess-ad-notfound",
  ok:       "sess-ad-ok",
  noMem:    "sess-ad-nomem",
  failOk:   "sess-ad-failok",
  throwOk:  "sess-ad-throwok",
};

function makeDistiller(result: DistillResult = { ok: true, newMemory: "蒸餾後記憶" }) {
  return vi.fn(async (_sid: string, _wsId: string, _aid: string): Promise<DistillResult> => result);
}

function seedSession(sessId: string, wsId: string, msgCount: number) {
  const messages = Array.from({ length: msgCount }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `訊息 ${i}`,
    ts: Date.now() + i,
  }));
  upsertSession({
    id: sessId,
    workspaceId: wsId,
    agentId: AGENT,
    title: "auto-distill-guard-test",
    provider: "claude",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages,
  });
}

afterEach(() => {
  for (const id of Object.values(SESS)) {
    try { deleteSession(id); } catch { /* ignore */ }
  }
  for (const ws of Object.values(WS)) {
    try { deleteAgentMemory(ws, AGENT); } catch { /* ignore */ }
  }
  vi.restoreAllMocks();
});

describe("maybeDistillOnReclaim — guard & dedup", () => {
  it("distilledFromSessionId === sessionId → 跳過（去重），distiller 不呼叫", async () => {
    seedSession(SESS.dedup, WS.dedup, 4);
    // 標記此 session 已蒸餾過
    setAgentMemory(WS.dedup, AGENT, "舊記憶", SESS.dedup);

    const distiller = makeDistiller();
    await maybeDistillOnReclaim(SESS.dedup, WS.dedup, AGENT, distiller);

    expect(distiller).not.toHaveBeenCalled();
  });

  it("session messages.length < 2 → 跳過（短對話 guard），distiller 不呼叫", async () => {
    seedSession(SESS.short, WS.short, 1); // 只有 1 則訊息

    const distiller = makeDistiller();
    await maybeDistillOnReclaim(SESS.short, WS.short, AGENT, distiller);

    expect(distiller).not.toHaveBeenCalled();
  });

  it("session 不存在 → 跳過，distiller 不呼叫", async () => {
    // 不建立 SESS.notFound，直接呼叫
    const distiller = makeDistiller();
    await maybeDistillOnReclaim(SESS.notFound, WS.notFound, AGENT, distiller);

    expect(distiller).not.toHaveBeenCalled();
  });

  it("≥ 2 訊息 + 未蒸餾過此 session → distiller 被呼叫一次，傳入正確參數", async () => {
    seedSession(SESS.ok, WS.ok, 4);
    // agent_memory 記的是另一個 session（不算去重）
    setAgentMemory(WS.ok, AGENT, "舊記憶", "some-other-session-id");

    const distiller = makeDistiller();
    await maybeDistillOnReclaim(SESS.ok, WS.ok, AGENT, distiller);

    expect(distiller).toHaveBeenCalledOnce();
    expect(distiller).toHaveBeenCalledWith(SESS.ok, WS.ok, AGENT);
  });

  it("無 agent_memory 記錄（全新蒸餾）+ ≥ 2 訊息 → distiller 被呼叫", async () => {
    seedSession(SESS.noMem, WS.noMem, 2);
    // 不設 agent_memory → getAgentMemory 回 null

    const distiller = makeDistiller();
    await maybeDistillOnReclaim(SESS.noMem, WS.noMem, AGENT, distiller);

    expect(distiller).toHaveBeenCalledOnce();
  });

  it("distiller 失敗（ok:false）→ 函式不拋錯（fail-safe）", async () => {
    seedSession(SESS.failOk, WS.failOk, 4);

    const distiller = makeDistiller({ ok: false, error: "LLM 逾時" });
    await expect(maybeDistillOnReclaim(SESS.failOk, WS.failOk, AGENT, distiller))
      .resolves.toBeUndefined();
  });

  it("distiller 拋錯 → 函式不拋錯（fail-safe wrapper 接住）", async () => {
    seedSession(SESS.throwOk, WS.throwOk, 4);

    const distiller = vi.fn(async () => { throw new Error("蒸餾器炸了"); }) as any;
    await expect(maybeDistillOnReclaim(SESS.throwOk, WS.throwOk, AGENT, distiller))
      .resolves.toBeUndefined();
  });
});
