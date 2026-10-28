import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isAuthFailureText, noteClaudeResult, noteClaudeFailureText, getClaudeHealth,
  markOk, probeClaudeAuth, AUTH_REMEDY,
  _setClaudeHealthDepsForTest, _resetClaudeHealthForTest,
} from "./claudeHealth.js";

// 真實事故的原文（2026-09-02 起每天的每日簡報都是這行）
const REAL_ERROR = "Failed to authenticate: OAuth session expired and could not be refreshed";

describe("isAuthFailureText（窄比對：只認明確的登入錯誤）", () => {
  it("認得真實事故原文與常見變體", () => {
    for (const t of [
      REAL_ERROR,
      "OAuth token has expired. Please run /login",
      "Invalid API key · Please run /login",
      "API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}",
      "Not logged in",
      "Invalid bearer token",
    ]) {
      expect(isAuthFailureText(t), t).toBe(true);
    }
  });

  it("不誤判：逾時、額度、一般錯誤、空值", () => {
    for (const t of ["claude 逾時（180000ms）", "You've hit your session limit · resets 9pm", "Error: tool failed", "", null, undefined]) {
      expect(isAuthFailureText(t as any)).toBe(false);
    }
  });
});

describe("登入狀態機", () => {
  const notify = vi.fn();
  let now = 1_000;
  beforeEach(() => {
    _resetClaudeHealthForTest();
    notify.mockReset();
    now = 1_000;
    _setClaudeHealthDepsForTest({ notify, now: () => now });
  });
  afterEach(() => _resetClaudeHealthForTest());

  it("初始 unknown", () => {
    expect(getClaudeHealth().status).toBe("unknown");
  });

  it("is_error 的登入錯誤結果 → auth_failed，附修復步驟，只推播一次", () => {
    noteClaudeResult({ type: "result", is_error: true, result: REAL_ERROR, usage: { output_tokens: 0 } });
    now += 1000;
    noteClaudeResult({ type: "result", is_error: true, result: REAL_ERROR, usage: { output_tokens: 0 } });
    const h = getClaudeHealth();
    expect(h.status).toBe("auth_failed");
    expect(h.failures).toBe(2);
    expect(h.remedy).toBe(AUTH_REMEDY);
    expect(h.remedy).toContain("/login");
    expect(h.remedy).toContain("setup-token");
    expect(h.lastError).toContain("OAuth session expired");
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0].kind).toBe("Claude 登入失效");
  });

  it("is_error=false 但 0 輸出 token 的登入錯誤字樣（舊版記成 0 token 成功回合的情境）→ auth_failed", () => {
    noteClaudeResult({ type: "result", is_error: false, result: REAL_ERROR, usage: { output_tokens: 0 } });
    expect(getClaudeHealth().status).toBe("auth_failed");
  });

  it("正常回答剛好談到登入錯誤（有輸出 token、非 error）→ 不誤判", () => {
    noteClaudeResult({ type: "result", is_error: false, result: `你看到的「${REAL_ERROR}」代表要重新登入`, usage: { output_tokens: 120 } });
    expect(getClaudeHealth().status).toBe("ok");
  });

  it("恢復：auth_failed 之後任一成功 → ok，推「已恢復」", () => {
    noteClaudeResult({ type: "result", is_error: true, result: REAL_ERROR });
    noteClaudeResult({ type: "result", is_error: false, result: "OK", usage: { output_tokens: 2 } });
    const h = getClaudeHealth();
    expect(h.status).toBe("ok");
    expect(h.remedy).toBeNull();
    expect(h.failures).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0].kind).toBe("Claude 登入恢復");
  });

  it("非登入的錯誤結果不動狀態", () => {
    markOk();
    noteClaudeResult({ type: "result", is_error: true, result: "Error during execution: tool crashed" });
    expect(getClaudeHealth().status).toBe("ok");
  });

  it("非 claude 的結果（codex/gemini 合成 result）直接忽略", () => {
    noteClaudeResult({ provider: "codex", exit: 0 });
    noteClaudeResult(null);
    noteClaudeResult("Failed to authenticate");
    expect(getClaudeHealth().status).toBe("unknown");
  });

  it("noteClaudeFailureText：stderr 有登入錯誤才轉狀態", () => {
    noteClaudeFailureText("some random stderr");
    expect(getClaudeHealth().status).toBe("unknown");
    noteClaudeFailureText(`Error: ${REAL_ERROR}`);
    expect(getClaudeHealth().status).toBe("auth_failed");
  });

  it("推播丟錯不影響狀態機", () => {
    _setClaudeHealthDepsForTest({ notify: () => { throw new Error("telegram down"); } });
    expect(() => noteClaudeResult({ type: "result", is_error: true, result: REAL_ERROR })).not.toThrow();
    expect(getClaudeHealth().status).toBe("auth_failed");
  });
});

describe("probeClaudeAuth", () => {
  beforeEach(() => _resetClaudeHealthForTest());
  afterEach(() => _resetClaudeHealthForTest());

  it("記錄 lastProbe；成功探測（經判讀轉 ok）", async () => {
    _setClaudeHealthDepsForTest({
      notify: () => {},
      probe: async () => {
        noteClaudeResult({ type: "result", is_error: false, result: "OK", usage: { output_tokens: 2 } });
        return { ok: true };
      },
    });
    const h = await probeClaudeAuth();
    expect(h.status).toBe("ok");
    expect(h.lastProbe?.ok).toBe(true);
    expect(h.lastProbe?.error).toBeNull();
  });

  it("探測失敗但不是登入問題（例如逾時）→ 狀態不動，lastProbe 帶錯誤", async () => {
    _setClaudeHealthDepsForTest({ notify: () => {}, probe: async () => ({ ok: false, error: "claude 逾時（90000ms）" }) });
    const h = await probeClaudeAuth();
    expect(h.status).toBe("unknown");
    expect(h.lastProbe).toMatchObject({ ok: false, error: "claude 逾時（90000ms）" });
  });

  it("同時只跑一個：連點拿到同一個結果", async () => {
    let calls = 0;
    let release!: () => void;
    _setClaudeHealthDepsForTest({
      notify: () => {},
      probe: () => new Promise((r) => { calls++; release = () => r({ ok: true }); }),
    });
    const a = probeClaudeAuth();
    const b = probeClaudeAuth();
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  it("探測函式丟例外 → 不外拋，記成失敗", async () => {
    _setClaudeHealthDepsForTest({ notify: () => {}, probe: async () => { throw new Error("spawn ENOENT"); } });
    const h = await probeClaudeAuth();
    expect(h.lastProbe).toMatchObject({ ok: false });
    expect(h.lastProbe?.error).toContain("ENOENT");
  });
});
