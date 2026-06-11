import { describe, it, expect } from "vitest";
import { recordToolActivity } from "./agentManager.js";
import { listActivity } from "./store/activity.js";

describe("活動埋點", () => {
  it("recordToolActivity 把 tool_call 寫進 activity_log（summary 用 summarizeTool）", () => {
    recordToolActivity({ id: "sx", agentId: "a", workspaceId: "wX" },
      { type: "tool_call", payload: { toolUseId: "t", name: "Bash", input: { command: "ls -la" } } });
    const items = listActivity({ sessionId: "sx" });
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("tool_call");
    expect(items[0].summary).toContain("ls -la");
  });
  it("tool_result 寫 activity_log 含 status + detail", () => {
    recordToolActivity({ id: "sy", agentId: "a", workspaceId: "wX" },
      { type: "tool_result", payload: { toolUseId: "t", status: "error", text: "boom" } });
    const r = listActivity({ sessionId: "sy" })[0];
    expect(r.kind).toBe("tool_result");
    expect(r.status).toBe("error");
    expect(r.detail).toContain("boom");
  });
  it("非工具事件回 null（不寫）", () => {
    const r = recordToolActivity({ id: "sz", agentId: "a", workspaceId: "wX" }, { type: "delta", payload: "x" });
    expect(r).toBeNull();
    expect(listActivity({ sessionId: "sz" }).length).toBe(0);
  });
});
