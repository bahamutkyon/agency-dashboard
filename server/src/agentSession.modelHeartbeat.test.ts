/**
 * AgentSession — 實際模型回報與思考期間的存活訊號（2026-10）。
 *
 * 1. CLI 回報的模型（system/init、message_start、assistant.message.model）要記下來並發 model 事件，
 *    才知道同事們實際跑在哪個模型（別名、帳號預設、使用者全域設定都會影響）。
 * 2. adaptive thinking 想事情時 CLI 只送 thinking_delta 這類串流事件，沒有任何可顯示的字。
 *    要發（節流的）heartbeat，否則「看活動」的逾時與 busy 看門狗會把長思考誤判成卡住。
 * 3. --model 覆蓋（DASHBOARD_MODEL_PM / AGENT）要帶進 spawn 參數。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnArgs: string[][] = [];
vi.mock("./claudeProcess.js", () => ({
  spawnClaude: (args: string[]) => {
    spawnArgs.push(args);
    const child: any = new EventEmitter();
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdin = { write: () => {} };
    child.kill = () => {};
    return child;
  },
}));

import { AgentSession } from "./agentSession.js";

function collect(s: AgentSession) {
  const evts: any[] = [];
  s.on("event", (e) => evts.push(e));
  return evts;
}
const route = (s: AgentSession, evt: any) => (s as any).routeClaudeEvent(evt);

beforeEach(() => { spawnArgs.length = 0; });

describe("實際模型回報", () => {
  it("system/init 帶的 model → 記到 session.model 並發 model 事件（只發一次）", () => {
    const s = new AgentSession("agent-a");
    const evts = collect(s);
    route(s, { type: "system", subtype: "init", model: "claude-opus-5-5", session_id: "x" });
    route(s, { type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text: "hi" }] } });
    expect(s.model).toBe("claude-opus-5-5");
    expect(evts.filter((e) => e.type === "model")).toEqual([{ type: "model", payload: "claude-opus-5-5" }]);
  });

  it("中途換模型（例如 fallback）→ 再發一次 model 事件", () => {
    const s = new AgentSession("agent-a");
    const evts = collect(s);
    route(s, { type: "stream_event", event: { type: "message_start", message: { model: "claude-opus-5-5" } } });
    route(s, { type: "assistant", message: { model: "claude-sonnet-5-5", content: [] } });
    expect(evts.filter((e) => e.type === "model").map((e) => e.payload)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(s.model).toBe("claude-sonnet-5-5");
  });

  it("沒有 model 欄位的事件不影響", () => {
    const s = new AgentSession("agent-a");
    route(s, { type: "assistant", message: { content: [{ type: "text", text: "x" }] } });
    expect(s.model).toBeUndefined();
  });
});

describe("思考期間的 heartbeat", () => {
  it("thinking_delta / input_json_delta → 發 heartbeat，且 5 秒內只發一次", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const s = new AgentSession("agent-a");
      const evts = collect(s);
      route(s, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "嗯…" } } });
      route(s, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "再想" } } });
      route(s, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } } });
      expect(evts.filter((e) => e.type === "heartbeat")).toHaveLength(1);
      vi.setSystemTime(1_000_000 + AgentSession.HEARTBEAT_INTERVAL_MS);
      route(s, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } } });
      expect(evts.filter((e) => e.type === "heartbeat")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("文字 delta 照舊發 delta（不是 heartbeat）", () => {
    const s = new AgentSession("agent-a");
    const evts = collect(s);
    route(s, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "答案" } } });
    expect(evts.map((e) => e.type)).toEqual(["delta"]);
    expect(evts[0].payload).toBe("答案");
  });
});

describe("--model / --effort 參數", () => {
  it("modelOverride 與 effort 帶進 spawn 參數；沒設就不帶", () => {
    const a = new AgentSession("agent-a");
    a.modelOverride = "opus";
    a.effort = "high";
    a.send("hi");
    const argsA = spawnArgs[spawnArgs.length - 1];
    expect(argsA).toContain("--model");
    expect(argsA[argsA.indexOf("--model") + 1]).toBe("opus");
    expect(argsA[argsA.indexOf("--effort") + 1]).toBe("high");

    const b = new AgentSession("agent-b");
    b.send("hi");
    const argsB = spawnArgs[spawnArgs.length - 1];
    expect(argsB).not.toContain("--model");
    expect(argsB).not.toContain("--effort");
  });
});
