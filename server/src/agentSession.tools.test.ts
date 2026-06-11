import { describe, it, expect } from "vitest";
import { AgentSession } from "./agentSession.js";

function collect(evts: any[], s: AgentSession) { s.on("event", (e) => evts.push(e)); }

describe("agentSession 工具事件捕捉", () => {
  it("assistant 含 tool_use → emit tool_call（含 name/input），text 照常 message", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "assistant", message: { content: [
      { type: "text", text: "我來跑測試" },
      { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } },
    ] } });
    const call = evts.find((e) => e.type === "tool_call");
    expect(call).toBeTruthy();
    expect(call.payload).toMatchObject({ toolUseId: "tu1", name: "Bash" });
    expect(call.payload.input).toMatchObject({ command: "npm test" });
    expect(evts.find((e) => e.type === "message")?.payload.content).toBe("我來跑測試");
  });
  it("assistant 純 tool_use 無 text → 只 emit tool_call、不 emit 空 message", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "assistant", message: { content: [
      { type: "tool_use", id: "tu0", name: "Read", input: { file_path: "/x" } },
    ] } });
    expect(evts.filter((e) => e.type === "tool_call").length).toBe(1);
    expect(evts.find((e) => e.type === "message")).toBeUndefined();
  });
  it("user 含 tool_result → emit tool_result（status ok/text）", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu1", is_error: false, content: [{ type: "text", text: "全部通過" }] },
    ] } });
    const r = evts.find((e) => e.type === "tool_result");
    expect(r).toBeTruthy();
    expect(r.payload).toMatchObject({ toolUseId: "tu1", status: "ok" });
    expect(r.payload.text).toContain("全部通過");
  });
  it("tool_result is_error → status error", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu2", is_error: true, content: "command failed" },
    ] } });
    expect(evts.find((e) => e.type === "tool_result")?.payload.status).toBe("error");
  });
  it("tool_result 字串 content 也能取文字", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu3", content: "純字串輸出" },
    ] } });
    expect(evts.find((e) => e.type === "tool_result")?.payload.text).toContain("純字串輸出");
  });
  it("tool_result 含 image → 既有 tool_image 不回歸 + 也 emit tool_result", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu4", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        { type: "text", text: "截圖完成" },
      ] },
    ] } });
    expect(evts.find((e) => e.type === "tool_image")).toBeTruthy(); // 既有不回歸
    expect(evts.find((e) => e.type === "tool_result")?.payload.text).toContain("截圖完成");
  });
});
