/**
 * POST /api/delegations/:id/cancel 端點測試
 *
 * 驗證：
 * 1. 取消存在的派工 → 200 {ok:true}，status=failed，resultExcerpt 含「取消」
 * 2. 不存在的派工 → 404
 * 3. agentManager.stop 拋錯時不崩潰，端點仍回 200
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";
import { app } from "../index.js";
import { createDelegation, getDelegation } from "../store/delegations.js";
import { agentManager } from "../agentManager.js";

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => { server?.close(); });

const baseInput = {
  pmSessionId: `pm_cancel_${Date.now().toString(36)}`,
  workspaceId: "ws-cancel-test",
  agentId: "developer",
  mode: "execute" as const,
  task: "test cancel task",
};

describe("POST /api/delegations/:id/cancel", () => {
  it("取消存在的派工 → 200 {ok:true}，status 變 failed，摘要含「取消」", async () => {
    const id = createDelegation({ ...baseInput });

    const r = await fetch(`${base}/api/delegations/${id}/cancel`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    const dlg = getDelegation(id);
    expect(dlg?.status).toBe("failed");
    expect(dlg?.resultExcerpt).toContain("取消");
    expect(dlg?.endedAt).toBeGreaterThan(0);
  });

  it("派工不存在 → 404", async () => {
    const r = await fetch(`${base}/api/delegations/__nonexistent_cancel__/cancel`, { method: "POST" });
    expect(r.status).toBe(404);
    const j = await r.json() as any;
    expect(j.error).toBeTruthy();
  });

  it("agentManager.stop 拋錯時不崩潰，端點仍回 200，派工仍標 failed", async () => {
    const id = createDelegation({ ...baseInput, subSessionId: "sub_fake_for_cancel_test" });

    // 強制 agentManager.stop 拋錯，驗證 catch 路徑不崩潰
    const spy = vi.spyOn(agentManager, "stop").mockImplementationOnce(() => {
      throw new Error("模擬 stop 失敗");
    });

    try {
      const r = await fetch(`${base}/api/delegations/${id}/cancel`, { method: "POST" });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });

      const dlg = getDelegation(id);
      expect(dlg?.status).toBe("failed");
      expect(dlg?.resultExcerpt).toContain("取消");
    } finally {
      spy.mockRestore();
    }
  });
});
