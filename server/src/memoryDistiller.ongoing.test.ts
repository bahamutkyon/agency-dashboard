import { describe, it, expect, vi, beforeEach } from "vitest";

const setAgentMemory = vi.fn();
let modelOutput = "";
let lastPrompt = "";
let sessionTitle = "👨‍💼 專案經理";
vi.mock("./store.js", () => ({
  getSession: () => ({ id: "s1", title: sessionTitle, messages: [
    { role: "user", content: "電容怎麼定價", ts: 1 }, { role: "assistant", content: "等你拍照", ts: 2 }] }),
  getAgentMemory: () => ({ content: "## 與使用者進行中的事（停在哪／等誰）\n- 電容定價 — 等拍照 — 使用者\n\n## 偏好\n- 簡潔" }),
  setAgentMemory: (...a: unknown[]) => setAgentMemory(...a),
}));
vi.mock("./agentLoader.js", () => ({ loadAgents: () => [{ id: "agents-orchestrator", name: "智能體編排者" }] }));
vi.mock("./claudeOneShot.js", () => ({
  runClaudeOneShot: async (_args: string[], opts: { input: string }) => {
    lastPrompt = opts.input;
    return { ok: true, stdout: JSON.stringify({ result: modelOutput }) };
  },
}));

import { distillAgentMemory } from "./memoryDistiller.js";

describe("distillAgentMemory 保住「進行中的事」", () => {
  beforeEach(() => { setAgentMemory.mockClear(); sessionTitle = "👨‍💼 專案經理"; });

  it("新版弄丟區塊 → 不寫入，保留舊版", async () => {
    modelOutput = "## 偏好\n- 簡潔\n## 每週行情\n- 一堆數字";
    const r = await distillAgentMemory("s1", "ws", "agents-orchestrator");
    expect(r.ok).toBe(false);
    expect(setAgentMemory).not.toHaveBeenCalled();
  });

  it("新版保留區塊 → 正常寫入", async () => {
    modelOutput = "## 與使用者進行中的事（停在哪／等誰）\n- 電容定價 — 等拍照 — 使用者\n\n## 偏好";
    const r = await distillAgentMemory("s1", "ws", "agents-orchestrator");
    expect(r.ok).toBe(true);
    expect(setAgentMemory).toHaveBeenCalled();
  });

  it("排程場次：提示要求原封不動照抄該區塊", async () => {
    sessionTitle = "[排程 2026/7/1 05:00:00] LP 行情";
    modelOutput = "## 與使用者進行中的事（停在哪／等誰）\n- 電容定價";
    await distillAgentMemory("s1", "ws", "agents-orchestrator");
    expect(lastPrompt).toContain("原封不動照抄舊版");
  });
});
