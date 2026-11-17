import { describe, it, expect } from "vitest";
import { db } from "../db.js";
import { upsertSession, listSessionsWithCounts, appendMessage } from "./sessions.js";
import { setManualState, setAutoDigest, getSessionState, clearStateOnUserActivity } from "./sessionState.js";
import { expireStalePendingActions } from "./autonomy.js";

let n = 0;
const mk = (ws: string) => {
  const id = `td_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: ws, agentId: "agents-orchestrator", title: "t", createdAt: 1, updatedAt: 1, messages: [] } as any);
  return id;
};

describe("整理掛單（後端）", () => {
  it("超過 14 天沒批准的動作 → expired；近期的不動", () => {
    const sid = mk("w_tidy");
    const old = Date.now() - 20 * 864e5, fresh = Date.now() - 1 * 864e5;
    db.prepare("INSERT INTO pending_actions (id, session_id, workspace_id, kind, risk, summary, status, created_at) VALUES (?, ?, 'w_tidy', 'plan', 'high', 's', 'pending', ?)").run(`old_${sid}`, sid, old);
    db.prepare("INSERT INTO pending_actions (id, session_id, workspace_id, kind, risk, summary, status, created_at) VALUES (?, ?, 'w_tidy', 'plan', 'high', 's', 'pending', ?)").run(`new_${sid}`, sid, fresh);
    expect(expireStalePendingActions(14)).toBeGreaterThanOrEqual(1);
    const st = (id: string) => (db.prepare("SELECT status FROM pending_actions WHERE id = ?").get(id) as any).status;
    expect(st(`old_${sid}`)).toBe("expired");
    expect(st(`new_${sid}`)).toBe("pending");
  });

  it("使用者回話 → 清掉「等你回覆／擱置／完成」與過時的停在哪", () => {
    for (const set of [(id: string) => setAutoDigest(id, "等你決定", "waiting_user"), (id: string) => setManualState(id, "parked")]) {
      const id = mk("w_tidy");
      set(id);
      clearStateOnUserActivity(id);
      expect(getSessionState(id)).toMatchObject({ state: null, stoppedAt: null });
    }
  });

  it("擱置（parked）是合法的手動狀態", () => {
    const id = mk("w_tidy");
    setManualState(id, "parked");
    expect(getSessionState(id)!.state).toBe("parked");
  });

  it("列表帶出最後一則專案經理回覆裡的 A/B/C 選項；最後是使用者說的就不帶", () => {
    const a = mk("w_opts"), b = mk("w_opts");
    appendMessage(a, { role: "user", content: "q", ts: 1 });
    appendMessage(a, { role: "assistant", content: "問題 1：\nA. 實體商品\nB. 服務\n\n我的建議：A", ts: 2 });
    appendMessage(b, { role: "assistant", content: "A. x\nB. y", ts: 1 });
    appendMessage(b, { role: "user", content: "選 A", ts: 2 });
    const list = listSessionsWithCounts("w_opts");
    expect(list.find((x) => x.id === a)!.lastOptions).toEqual([{ key: "A", label: "實體商品" }, { key: "B", label: "服務" }]);
    expect(list.find((x) => x.id === b)!.lastOptions).toBeNull();
  });
});
