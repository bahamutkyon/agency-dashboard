import { describe, it, expect } from "vitest";
import { AgentSession } from "./agentSession.js";

describe("AgentSession cwd", () => {
  it("建構子接受第 6 參數 cwd 並保存", () => {
    const s = new AgentSession("agents-orchestrator", undefined, undefined, undefined, "claude", "D:/work/ws1");
    expect((s as any).cwd).toBe("D:/work/ws1");
  });
  it("未傳 cwd → undefined（向後相容）", () => {
    const s = new AgentSession("agents-orchestrator");
    expect((s as any).cwd).toBeUndefined();
  });
});
