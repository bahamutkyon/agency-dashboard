/**
 * A1 + B5 — executeDispatch 的 consult ack 與部分核可回饋
 *
 * A1：consult 核可後、開始跑 runConsult 前，立刻插一則 role:"system" 說明訊息並廣播
 *     （type:"system-note"），且**不經** agentManager.send（不觸發 PM 的 LLM 回合）。
 * B5：opts.approvalNote 會被前置到 consult 的 feedback（CONSULT_RESULTS）訊息，PM 得知被拿掉的項。
 *
 * runConsult / startExecute 以 vi.mock 取代（不 spawn）；loadAgents 以 mock 提供名稱；
 * agentManager.send 以 spyOn 取代避免真送。訊息落庫直接讀 sqlite 驗證。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("./dispatchRunner.js", () => ({
  runConsult: vi.fn(async () => []),
  startExecute: vi.fn(() => []),
}));
vi.mock("./agentLoader.js", () => ({
  loadAgents: () => [
    { id: "designer", name: "設計師", category: "design", description: "" },
    { id: "developer", name: "工程師", category: "eng", description: "" },
  ],
}));

import { executeDispatch } from "./routes/sessions.js";
import { agentManager } from "./agentManager.js";
import { db } from "./db.js";

let sendSpy: any;
beforeAll(() => { sendSpy = vi.spyOn(agentManager, "send").mockReturnValue({ ok: true } as any); });
afterAll(() => { sendSpy?.mockRestore(); });
beforeEach(() => { sendSpy.mockClear(); });

function systemMessages(sessionId: string): string[] {
  return (db.prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'system' ORDER BY id").all(sessionId) as any[])
    .map((r) => String(r.content));
}
function makeIo() {
  const roomEmit = vi.fn();
  return { io: { emit: vi.fn(), to: vi.fn(() => ({ emit: roomEmit })) }, roomEmit };
}

describe("A1 consult ack（非 LLM 系統訊息）", () => {
  it("插入 role=system 說明訊息並廣播 system-note，且不經 agentManager.send", async () => {
    const pm = `pm_a1_${Date.now().toString(36)}`;
    const { io, roomEmit } = makeIo();
    await executeDispatch(pm, [{ agentId: "designer", mode: "consult", task: "做圖" }], io);

    const sys = systemMessages(pm);
    const ack = sys.find((c) => c.includes("已交辦給"));
    expect(ack).toBeTruthy();
    expect(ack).toContain("設計師");
    expect(ack).toContain("正在等回覆");

    // socket 廣播 system-note
    const noteEmit = roomEmit.mock.calls.find(
      (c) => c[0] === "session:event" && c[1]?.type === "system-note",
    );
    expect(noteEmit).toBeTruthy();
    expect(noteEmit![1].payload.content).toContain("已交辦給");

    // ack 不可經由 agentManager.send（那會觸發 LLM）；send 只該送 feedback
    const ackViaSend = sendSpy.mock.calls.some((c: any) => String(c[1]).includes("已交辦給"));
    expect(ackViaSend).toBe(false);
    // feedback 確實有送（CONSULT_RESULTS）
    const feedbackSent = sendSpy.mock.calls.some((c: any) => c[0] === pm && String(c[1]).includes("[[CONSULT_RESULTS]]"));
    expect(feedbackSent).toBe(true);
  });
});

describe("B5 部分核可回饋前置到 feedback", () => {
  it("opts.approvalNote 出現在 consult feedback 訊息開頭區", async () => {
    const pm = `pm_b5_${Date.now().toString(36)}`;
    const { io } = makeIo();
    const approvalNote = "使用者僅核可其中 1 項：designer；developer 未核可";
    await executeDispatch(pm, [{ agentId: "designer", mode: "consult", task: "做圖" }], io, { approvalNote });

    const feedback = sendSpy.mock.calls.find((c: any) => c[0] === pm && String(c[1]).includes("[[CONSULT_RESULTS]]"));
    expect(feedback).toBeTruthy();
    expect(String(feedback![1])).toContain("developer 未核可");
  });
});
