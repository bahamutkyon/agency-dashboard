import { describe, it, expect, vi } from "vitest";
import { agentManager } from "./agentManager.js";

describe("agentManager 建立／重建 session 時通知（讓即時轉送重新接線）", () => {
  it("reattach 產生新物件時呼叫 onSessionRegistered 的 callback", () => {
    const cb = vi.fn();
    const off = agentManager.onSessionRegistered(cb);
    const s = agentManager.start("agents-orchestrator", "t", "", "default", false, "claude");
    expect(cb).toHaveBeenCalledWith(s.id);
    cb.mockClear();
    agentManager.stop(s.id);
    const again = agentManager.reattach(s.id);
    expect(again).toBeTruthy();
    expect(cb).toHaveBeenCalledWith(s.id);
    off();
    agentManager.stop(s.id);
  });
});

describe("接線：server 把 session 重建通知接到即時轉送", () => {
  it("index.ts 以 onSessionRegistered 呼叫 forwarding.sessionRegistered", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(src).toMatch(/onSessionRegistered\(\(id\) => forwarding\.sessionRegistered\(id\)\)/);
    expect(src).not.toMatch(/sessionForwards\.has\(/);
  });
});
