import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { app } from "../index.js";
import { db, DEFAULT_WORKSPACE_ID } from "../db.js";

// 路由 smoke 測試：VITEST 下 researchRouter 注入 fake 三階段（不打真 LLM），
// 存 note 走真庫。用 ephemeral 埠打真實路由。研究 note 在 afterAll 清掉。

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  db.exec("DELETE FROM notes WHERE id LIKE 'rnote_%'");
  server?.close();
});

// 輪詢 run 直到完成或逾時。
async function waitDone(id: string, timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${base}/api/research/${id}`);
    const j = (await r.json()) as any;
    if (j.status === "done" || j.status === "error") return j;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error("研究 run 逾時未完成");
}

describe("POST/GET /api/research", () => {
  it("question 空 → 400", async () => {
    const r = await fetch(`${base}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, question: "  " }),
    });
    expect(r.status).toBe(400);
  });

  it("POST 立即回 runId，背景跑完後 GET 拿到 done + result（帶正確 workspaceId）", async () => {
    const r = await fetch(`${base}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, question: "測試研究主題" }),
    });
    expect(r.status).toBe(200);
    const { runId } = (await r.json()) as { runId: string };
    expect(typeof runId).toBe("string");

    const done = await waitDone(runId);
    expect(done.status).toBe("done");
    expect(done.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(done.result).toBeTruthy();
    expect(done.result.question).toBe("測試研究主題");
    // fake plan 回 2 子題
    expect(done.result.subQuestions).toHaveLength(2);
    expect(done.result.findings).toHaveLength(2);
    expect(done.result.synthesis).toContain("模擬綜合結論");
    expect(done.result.noteId).toMatch(/^rnote_/);

    // 存進真研究成果庫、workspaceId 正確
    const note = db
      .prepare("SELECT * FROM notes WHERE id = ?")
      .get(done.result.noteId) as any;
    expect(note).toBeTruthy();
    expect(note.workspace_id).toBe(DEFAULT_WORKSPACE_ID);
    expect(note.title).toMatch(/^\[研究\] 測試研究主題/);
  });

  it("GET 不存在的 run → 404", async () => {
    const r = await fetch(`${base}/api/research/__nope__`);
    expect(r.status).toBe(404);
  });

  it("onProgress 回呼 → io.emit research:progress 被呼叫（注入 fake io）", async () => {
    // 暫時注入 fake io，驗證路由把 onProgress 接到 io.emit。
    const origIo = app.get("io");
    const fakeEmit = vi.fn();
    app.set("io", { emit: fakeEmit });
    try {
      const r = await fetch(`${base}/api/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: DEFAULT_WORKSPACE_ID, question: "socket emit 驗證" }),
      });
      expect(r.status).toBe(200);
      const { runId } = (await r.json()) as { runId: string };
      const done = await waitDone(runId);
      expect(done.status).toBe("done");

      // io.emit 被呼叫，且至少一次帶 research:progress
      const calls = fakeEmit.mock.calls.filter((args: any[]) => args[0] === "research:progress");
      expect(calls.length).toBeGreaterThan(0);

      // 最後一次 emit 應帶 status=done、runId 正確
      const last = calls[calls.length - 1];
      expect(last[0]).toBe("research:progress");
      expect(last[1]).toMatchObject({ runId, status: "done" });
    } finally {
      // 恢復原始 io（避免污染其他測試）
      app.set("io", origIo ?? null);
    }
  });
});
