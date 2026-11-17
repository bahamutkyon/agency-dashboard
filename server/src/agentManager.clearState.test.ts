/** agentManager.send()：使用者回話 → 清掉舊的「等你回覆／擱置」狀態（接線測試，不只測輔助函式）。 */
import { describe, it, expect, afterEach } from "vitest";
import { AgentManager } from "./agentManager.js";
import { upsertSession, deleteSession, DEFAULT_WORKSPACE_ID } from "./store.js";
import { setAutoDigest, setManualState, getSessionState } from "./store/sessionState.js";

const ids: string[] = [];
afterEach(() => { for (const id of ids) { try { deleteSession(id); } catch { /* */ } } ids.length = 0; });

function seed(id: string) {
  upsertSession({ id, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "t", provider: "claude", createdAt: 1, updatedAt: 1, messages: [] });
  ids.push(id);
}

describe("agentManager.send() 清掉舊狀態", () => {
  it("等你回覆 → 回話後清空", () => {
    seed("cs-wait");
    setAutoDigest("cs-wait", "等你選 A/B", "waiting_user");
    const mgr = new AgentManager();
    (mgr as any).sessions.set("cs-wait", { provider: "claude", status: "idle", send: () => "sent" });
    expect(mgr.send("cs-wait", "選 A").ok).toBe(true);
    expect(getSessionState("cs-wait")).toMatchObject({ state: null, stoppedAt: null });
  });

  it("擱置中的對話被回話 → 自動拉回", () => {
    seed("cs-park");
    setManualState("cs-park", "parked");
    const mgr = new AgentManager();
    (mgr as any).sessions.set("cs-park", { provider: "claude", status: "idle", send: () => "queued" });
    mgr.send("cs-park", "我想開始做了");
    expect(getSessionState("cs-park")!.state).toBeNull();
  });
});
