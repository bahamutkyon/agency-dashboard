/**
 * A4 + A3 — 手動派工核可/拒絕的決定路徑
 *
 * A4：重複核可只執行一次、第二次回 409；拒絕同樣 CAS，重複拒絕 / 先批准又拒絕回 409。
 * A3：手動派工拒絕會 agentManager.send() 餵回 PM 一則「使用者拒絕了這次派工」。
 *
 * executeDispatch 以 vi.mock 取代（避免 spawn claude）；agentManager.send 以 spyOn 取代。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { DispatchItem } from "../dispatchParser.js";

const capturedExec: { sessionId: string; items: DispatchItem[]; opts?: any }[] = [];
vi.mock("./sessions.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    executeDispatch: vi.fn(async (sessionId: string, items: DispatchItem[], _io: any, opts?: any) => {
      capturedExec.push({ sessionId, items, opts });
      return { consulted: [], executing: [] };
    }),
  };
});

import type { Server } from "node:http";
import { app } from "../index.js";
import { agentManager } from "../agentManager.js";
import { createPendingAction, getPendingAction } from "../store/autonomy.js";

let server: Server;
let base: string;
let sendSpy: any;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => { server?.close(); sendSpy?.mockRestore(); });

beforeEach(() => {
  capturedExec.length = 0;
  sendSpy?.mockRestore();
  sendSpy = vi.spyOn(agentManager, "send").mockReturnValue({ ok: true } as any);
});

function makeAction(detail: string) {
  return createPendingAction({
    sessionId: `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: "ws-decision-test", kind: "dispatch", risk: "high", summary: "派工測試", detail,
  });
}

const post = (path: string, body?: any) => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
});

describe("A4 重複核可防呆", () => {
  it("首次核可 200 執行、第二次核可 409 且不再執行", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖");
    const r1 = await post(`/api/autonomy/actions/${pa.id}/approve`);
    expect(r1.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));

    const r2 = await post(`/api/autonomy/actions/${pa.id}/approve`);
    expect(r2.status).toBe(409);
    expect((await r2.json() as any).error).toBe("此動作已處理過");

    // executeDispatch 只被呼叫一次
    const calls = capturedExec.filter((c) => c.sessionId === pa.sessionId);
    expect(calls).toHaveLength(1);
  });

  it("先批准後拒絕 → 拒絕回 409（亂序被擋）", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖");
    expect((await post(`/api/autonomy/actions/${pa.id}/approve`)).status).toBe(200);
    const rej = await post(`/api/autonomy/actions/${pa.id}/reject`);
    expect(rej.status).toBe(409);
  });
});

describe("A3 拒絕餵回 PM", () => {
  it("拒絕回 200 且 agentManager.send 收到拒絕說明（含 summary）", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖");
    const r = await post(`/api/autonomy/actions/${pa.id}/reject`);
    expect(r.status).toBe(200);
    expect(getPendingAction(pa.id)?.status).toBe("rejected");

    const call = sendSpy.mock.calls.find((c: any) => c[0] === pa.sessionId);
    expect(call).toBeTruthy();
    expect(String(call![1])).toContain("使用者拒絕了這次派工");
    expect(String(call![1])).toContain(pa.summary);
    expect(String(call![1])).toContain("不要重複提出同一份派工");
  });

  it("重複拒絕第二次回 409、不再餵 PM", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖");
    await post(`/api/autonomy/actions/${pa.id}/reject`);
    sendSpy.mockClear();
    const r2 = await post(`/api/autonomy/actions/${pa.id}/reject`);
    expect(r2.status).toBe(409);
    expect(sendSpy.mock.calls.find((c: any) => c[0] === pa.sessionId)).toBeFalsy();
  });
});

describe("B5 部分核可回饋透傳到 executeDispatch.opts", () => {
  it("送來 items 少於原清單 → opts.approvalNote 含被移除 agent", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖\n- agentId: developer\n  mode: execute\n  task: 寫程式");
    // 只核可 designer
    const r = await post(`/api/autonomy/actions/${pa.id}/approve`, { items: [{ agentId: "designer", mode: "consult", task: "做圖" }] });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 30));
    const call = capturedExec.find((c) => c.sessionId === pa.sessionId);
    expect(call?.opts?.approvalNote).toContain("developer");
    expect(call?.opts?.approvalNote).toContain("未核可");
  });

  it("完整核可（items 涵蓋全部）→ opts.approvalNote 為 undefined", async () => {
    const pa = makeAction("- agentId: designer\n  mode: consult\n  task: 做圖");
    const r = await post(`/api/autonomy/actions/${pa.id}/approve`, { items: [{ agentId: "designer", mode: "consult", task: "做圖" }] });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 30));
    const call = capturedExec.find((c) => c.sessionId === pa.sessionId);
    expect(call?.opts?.approvalNote).toBeUndefined();
  });
});
