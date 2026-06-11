import { describe, it, expect } from "vitest";
import { logActivity, listActivity, pruneActivity, summarizeTool, ACTIVITY_DETAIL_CAP } from "./store/activity.js";

describe("store/activity", () => {
  it("logActivity 寫入 + listActivity 讀回（ts DESC）", () => {
    logActivity({ workspaceId: "w1", sessionId: "s1", kind: "tool_call", summary: "Bash: npm test" });
    logActivity({ workspaceId: "w1", sessionId: "s1", kind: "tool_result", summary: "完成", status: "ok" });
    const items = listActivity({ sessionId: "s1" });
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("tool_result");
    expect(items[0].status).toBe("ok");
  });
  it("detail 超過上限被截斷且記原長", () => {
    const long = "x".repeat(ACTIVITY_DETAIL_CAP + 500);
    logActivity({ workspaceId: "w1", sessionId: "sLong", kind: "tool_result", summary: "big", detail: long });
    const r = listActivity({ sessionId: "sLong" })[0];
    expect(r.detail!.length).toBe(ACTIVITY_DETAIL_CAP);
    expect(r.totalLen).toBe(long.length);
  });
  it("detail 未超上限 → totalLen 為 undefined", () => {
    logActivity({ workspaceId: "w1", sessionId: "sShort", kind: "tool_call", summary: "s", detail: "短內容" });
    const r = listActivity({ sessionId: "sShort" })[0];
    expect(r.detail).toBe("短內容");
    expect(r.totalLen).toBeUndefined();
  });
  it("listActivity 依 kind 篩選 + limit", () => {
    for (let i = 0; i < 5; i++) logActivity({ workspaceId: "w2", sessionId: "sf", kind: "tool_call", summary: `c${i}` });
    logActivity({ workspaceId: "w2", sessionId: "sf", kind: "dispatch", summary: "派工" });
    expect(listActivity({ sessionId: "sf", kind: "dispatch" }).length).toBe(1);
    expect(listActivity({ sessionId: "sf", limit: 2 }).length).toBe(2);
  });
  it("游標分頁 before", () => {
    const all = listActivity({ sessionId: "sf" });
    const mid = all[1].ts;
    const page = listActivity({ sessionId: "sf", before: mid });
    expect(page.every((r) => r.ts < mid)).toBe(true);
  });
  it("summarizeTool 依工具取關鍵欄位", () => {
    expect(summarizeTool("Bash", { command: "npm test" })).toContain("npm test");
    expect(summarizeTool("Write", { file_path: "/a/b.ts", content: "..." })).toContain("/a/b.ts");
    expect(summarizeTool("mcp__playwright__browser_navigate", { url: "http://x" })).toContain("playwright");
  });
  it("pruneActivity 回傳數字", () => {
    expect(typeof pruneActivity()).toBe("number");
  });
});
