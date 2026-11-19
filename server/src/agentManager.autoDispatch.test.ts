import { describe, it, expect, vi, afterEach } from "vitest";
import { detectAndEnqueueDispatch, setDispatchAutoApprover } from "./agentManager.js";
import { listPending, getPendingAction } from "./store/autonomy.js";

const wrap = (body: string) => `計畫：\n=== DISPATCH ===\n${body}\n=== END DISPATCH ===`;
const sid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

afterEach(() => setDispatchAutoApprover(null));

describe("PM 派工：內部工作自動放行、對外動作才跳批准卡", () => {
  it("內部派工 → 交給 auto approver 執行，不彈批准卡", () => {
    const approver = vi.fn();
    setDispatchAutoApprover(approver);
    const io = { emit: vi.fn() };
    const s = sid("auto");
    detectAndEnqueueDispatch({ id: s, agentId: "agents-orchestrator", workspaceId: "w" }, wrap("- agentId: a\n  mode: execute\n  task: 查行情寫報告存檔"), io);
    expect(approver).toHaveBeenCalledTimes(1);
    const pa = getPendingAction(approver.mock.calls[0][0]);
    expect(pa?.sessionId).toBe(s);
    expect(io.emit).not.toHaveBeenCalledWith("autonomy:event", { sessionId: s, kind: "pending:new" });
  });

  it("對外派工 → 照舊入待批、彈卡，摘要寫出為什麼要批", () => {
    const approver = vi.fn();
    setDispatchAutoApprover(approver);
    const io = { emit: vi.fn() };
    const s = sid("ext");
    detectAndEnqueueDispatch({ id: s, agentId: "agents-orchestrator", workspaceId: "w" }, wrap("- agentId: a\n  mode: execute\n  task: 把 6 件電容上架到露天"), io);
    expect(approver).not.toHaveBeenCalled();
    const pend = listPending(s);
    expect(pend).toHaveLength(1);
    expect(pend[0].summary).toContain("需你批准");
    expect(pend[0].summary).toContain("上架");
    expect(io.emit).toHaveBeenCalledWith("autonomy:event", { sessionId: s, kind: "pending:new" });
  });

  it("沒註冊 approver（例如測試或未啟動）→ 退回舊行為：全部入待批", () => {
    const s = sid("noapp");
    detectAndEnqueueDispatch({ id: s, agentId: "agents-orchestrator", workspaceId: "w" }, wrap("- agentId: a\n  task: 查資料"));
    expect(listPending(s)).toHaveLength(1);
  });

  it("server 啟動時有註冊 auto approver（接線）", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(src).toMatch(/setDispatchAutoApprover\(/);
  });
});
