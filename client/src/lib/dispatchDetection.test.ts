import { describe, it, expect } from "vitest";
import { detectDispatch, dispatchFingerprint, dispatchStorageKey, type DispatchMsg } from "./dispatchDetection";

const PM = "agents-orchestrator";
const u = (content: string): DispatchMsg => ({ role: "user", content });
const a = (content: string): DispatchMsg => ({ role: "assistant", content });

const block = (body: string) => `=== DISPATCH ===\n${body}\n=== END DISPATCH ===`;
const oneConsult = block("- agentId: marketing-content-creator\n  mode: consult\n  task: 寫一篇貼文");

describe("detectDispatch", () => {
  it("非 orchestrator agent 一律回 null", () => {
    expect(detectDispatch([a(oneConsult)], "marketing-content-creator")).toBeNull();
  });

  it("PM 最新一則就是 DISPATCH → 偵測為待批准", () => {
    const items = detectDispatch([u("幫我發文"), a(oneConsult)], PM);
    expect(items).toEqual([{ agentId: "marketing-content-creator", mode: "consult", task: "寫一篇貼文" }]);
  });

  it("【核心 bug】DISPATCH 後 PM 已有後續回覆 → 回 null（卡片不該再跳）", () => {
    const msgs = [u("幫我發文"), a(oneConsult), a("已整合同事回覆：以下是文案…")];
    expect(detectDispatch(msgs, PM)).toBeNull();
  });

  it("DISPATCH→整合回覆後，使用者又發話（最新 assistant 仍是整合）→ 維持 null", () => {
    const msgs = [a(oneConsult), a("已整合回覆"), u("謝謝，再幫我改一下")];
    expect(detectDispatch(msgs, PM)).toBeNull();
  });

  it("DISPATCH 後只有使用者插話、PM 尚未回 → 仍視為待批准", () => {
    const msgs = [a(oneConsult), u("等等我想一下")];
    expect(detectDispatch(msgs, PM)).toEqual([
      { agentId: "marketing-content-creator", mode: "consult", task: "寫一篇貼文" },
    ]);
  });

  it("多輪派工：回傳最新那一輪，不是舊的", () => {
    const older = block("- agentId: old-agent\n  mode: consult\n  task: 舊任務");
    const newer = block("- agentId: new-agent\n  mode: execute\n  task: 新任務");
    const msgs = [a(older), a("舊的整合回覆"), u("再派一次"), a(newer)];
    expect(detectDispatch(msgs, PM)).toEqual([
      { agentId: "new-agent", mode: "execute", task: "新任務" },
    ]);
  });

  it("解析 execute 模式與多項目", () => {
    const body = "- agentId: a1\n  mode: execute\n  task: t1\n- agentId: a2\n  mode: consult\n  task: t2";
    expect(detectDispatch([a(block(body))], PM)).toEqual([
      { agentId: "a1", mode: "execute", task: "t1" },
      { agentId: "a2", mode: "consult", task: "t2" },
    ]);
  });

  it("缺 task 的項目被丟棄；全空 → null", () => {
    expect(detectDispatch([a(block("- agentId: a1\n  mode: consult"))], PM)).toBeNull();
  });

  it("沒有任何 DISPATCH 標記 → null", () => {
    expect(detectDispatch([a("普通回覆"), u("hi")], PM)).toBeNull();
  });

  it("空訊息陣列 → null", () => {
    expect(detectDispatch([], PM)).toBeNull();
  });
});

describe("dispatchFingerprint / dispatchStorageKey", () => {
  const items = [{ agentId: "a1", mode: "consult" as const, task: "t1" }];

  it("相同內容指紋穩定", () => {
    expect(dispatchFingerprint(items)).toBe(dispatchFingerprint([{ ...items[0] }]));
  });

  it("不同內容指紋相異", () => {
    expect(dispatchFingerprint(items)).not.toBe(
      dispatchFingerprint([{ agentId: "a1", mode: "execute", task: "t1" }]),
    );
  });

  it("storageKey 帶 sessionId；null items 回 null", () => {
    expect(dispatchStorageKey("s1", items)).toBe(`dispatched:s1:${dispatchFingerprint(items)}`);
    expect(dispatchStorageKey("s1", null)).toBeNull();
  });
});
