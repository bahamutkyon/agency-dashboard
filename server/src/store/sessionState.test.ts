import { describe, it, expect } from "vitest";
import { db } from "../db.js";
import { upsertSession, listSessionsWithCounts } from "./sessions.js";
import { setManualState, setAutoDigest, getSessionState, setHandoffFrom, setHandoffDoc, setHandedOffTo } from "./sessionState.js";

let n = 0;
function mk(ws = "w_state"): string {
  const id = `st_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: ws, agentId: "agents-orchestrator", title: "t", createdAt: 1, updatedAt: 1, messages: [] } as any);
  return id;
}

describe("session state（C1/C2）", () => {
  it("手動標記完成；之後自動摘要不能覆蓋", () => {
    const id = mk();
    setManualState(id, "done");
    setAutoDigest(id, "停在等拍照", "waiting_user");
    const s = getSessionState(id)!;
    expect(s.state).toBe("done");
    expect(s.stateSource).toBe("manual");
    expect(s.stoppedAt).toBe("停在等拍照"); // 停在哪仍更新
  });

  it("手動標記後使用者又講了話 → 自動摘要可以覆蓋（對話重啟了）", () => {
    const id = mk();
    setManualState(id, "done", 1000);
    db.prepare("INSERT INTO messages (session_id, role, content, ts) VALUES (?, 'user', '再問一下', ?)").run(id, 2000);
    setAutoDigest(id, "又在討論", "open");
    expect(getSessionState(id)!.state).toBe("open");
    expect(getSessionState(id)!.stateSource).toBe("auto");
  });

  it("清除手動狀態（重新開啟）", () => {
    const id = mk();
    setManualState(id, "done");
    setManualState(id, null);
    expect(getSessionState(id)!.state).toBeNull();
  });

  it("列表帶出狀態、停在哪、待批准數、執行中派工數、交接來源", () => {
    const id = mk("w_list");
    const prev = mk("w_list");
    setAutoDigest(id, "等你決定定價", "waiting_user");
    setHandoffFrom(id, prev);
    db.prepare("INSERT INTO pending_actions (id, session_id, workspace_id, kind, risk, summary, status, created_at) VALUES (?, ?, 'w_list', 'dispatch', 'high', 's', 'pending', 1)").run(`pa_${id}`, id);
    db.prepare("INSERT INTO delegations (id, pm_session_id, workspace_id, agent_id, mode, task, status, created_at) VALUES (?, ?, 'w_list', 'a', 'execute', 't', 'running', 1)").run(`dl_${id}`, id);
    const row = listSessionsWithCounts("w_list").find((x) => x.id === id)!;
    expect(row).toMatchObject({ state: "waiting_user", stoppedAt: "等你決定定價", pendingCount: 1, runningDelegations: 1, handoffFrom: prev });
  });
});

describe("交接單欄位", () => {
  it("setHandoffDoc / setHandedOffTo 可讀回", () => {
    const id = mk();
    expect(getSessionState(id)!.handoffDoc).toBeNull();
    expect(getSessionState(id)!.handedOffTo).toBeNull();
    setHandoffDoc(id, "🎯 目標：x");
    setHandedOffTo(id, "new_1");
    expect(getSessionState(id)!.handoffDoc).toBe("🎯 目標：x");
    expect(getSessionState(id)!.handedOffTo).toBe("new_1");
  });
});
