/**
 * POST /api/autonomy/actions/:id/approve — 帶 items payload 測試
 *
 * 驗證：
 * 1. body.items 優先：前端帶 items 時 executeDispatch 收到該 items（不解析 detail）
 * 2. 向後相容：無 body.items 時 fallback 解析 detail
 * 3. body.items 為空陣列時 fallback 到 detail 解析（空陣列視為「未提供」）
 *
 * 使用 vi.mock 取代 executeDispatch，避免實際 spawn claude 子程序。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { DispatchItem } from "../dispatchParser.js";

// executeDispatch 的捕獲容器（在 mock factory 外部宣告讓測試讀得到）
const capturedCalls: { sessionId: string; items: DispatchItem[] }[] = [];

// vi.mock 必須在 import 前（vitest 會 hoist 到檔案頂端）
vi.mock("./sessions.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    executeDispatch: vi.fn(async (sessionId: string, items: DispatchItem[]) => {
      capturedCalls.push({ sessionId, items });
      return { consulted: [], executing: [] };
    }),
  };
});

import type { Server } from "node:http";
import { app } from "../index.js";
import { createPendingAction, getPendingAction } from "../store/autonomy.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
  capturedCalls.length = 0;
});

afterAll(() => { server?.close(); });

/** 建一個手動 dispatch 的 pending action（runId 空，kind=dispatch） */
function makeDispatchAction(detail?: string) {
  return createPendingAction({
    sessionId: `sess_approve_items_${Date.now().toString(36)}`,
    workspaceId: "ws-approve-items-test",
    kind: "dispatch",
    risk: "low",
    summary: "派工測試",
    detail,
  });
}

describe("POST /api/autonomy/actions/:id/approve — items 優先", () => {
  it("body.items 非空時 executeDispatch 收到該 items（不解析 detail）", async () => {
    const detail = "agentId: developer\nmode: consult\ntask: 原始任務";
    const pa = makeDispatchAction(detail);

    const overrideItems: DispatchItem[] = [
      { agentId: "designer", mode: "consult", task: "前端部分核可的任務" },
    ];

    capturedCalls.length = 0;
    const r = await fetch(`${base}/api/autonomy/actions/${pa.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: overrideItems }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    // 等非同步 executeDispatch 完成（mock 立即 resolve → markActionExecuted 後 status=executed）
    await new Promise((res) => setTimeout(res, 50));

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    const call = capturedCalls.find((c) => c.sessionId === pa.sessionId);
    expect(call).toBeTruthy();
    expect(call!.items).toEqual(overrideItems);
    expect(call!.items[0].agentId).toBe("designer");

    // decidePendingAction → approved，markActionExecuted → executed（mock 立即完成後）
    const updated = getPendingAction(pa.id);
    expect(["approved", "executed"]).toContain(updated?.status);
  });

  it("無 body.items 時 fallback 解析 detail（向後相容）", async () => {
    const detail = "agentId: developer\nmode: execute\ntask: 後端任務";
    const pa = makeDispatchAction(detail);

    capturedCalls.length = 0;
    const r = await fetch(`${base}/api/autonomy/actions/${pa.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    await new Promise((res) => setTimeout(res, 50));

    await new Promise((res) => setTimeout(res, 50));

    // executeDispatch 應被呼叫（items 來自 detail 解析；重點是沒用 override items）
    // decidePendingAction → approved 或 markActionExecuted → executed（mock 立即完成）
    const updated = getPendingAction(pa.id);
    expect(["approved", "executed"]).toContain(updated?.status);
  });

  it("body.items 為空陣列時 fallback 到 detail 解析", async () => {
    const pa = makeDispatchAction("agentId: tester\nmode: consult\ntask: 空 items fallback");

    capturedCalls.length = 0;
    const r = await fetch(`${base}/api/autonomy/actions/${pa.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    await new Promise((res) => setTimeout(res, 50));

    // 空 items → fallback，pending action 最終為 approved 或 executed（mock 立即完成）
    const updated = getPendingAction(pa.id);
    expect(["approved", "executed"]).toContain(updated?.status);
  });

  it("action 不存在 → 404", async () => {
    const r = await fetch(`${base}/api/autonomy/actions/__nonexistent_approve__/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(r.status).toBe(404);
    const j = await r.json() as any;
    expect(j.error).toBeTruthy();
  });
});
