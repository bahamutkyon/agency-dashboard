/**
 * guard.ts 單元測試 — 用 setShellwardClient 注入 fake，不真跑 shellward。
 * 每個 it 都走「先看失敗、再看通過」的 TDD 循環。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { GuardVerdict } from "./shellwardClient.js";
import {
  setShellwardClient,
  evaluateGuard,
  listGuardDecisions,
} from "./guard.js";

// ── Fake client 工廠 ────────────────────────────────────────────────────────

type FakeChecker = { checkCommand(cmd: string): Promise<GuardVerdict> };

function alwaysVerdict(v: GuardVerdict): FakeChecker {
  return { checkCommand: async () => v };
}

/** 記錄 checkCommand 被呼叫的次數 */
function spyClient(v: GuardVerdict): FakeChecker & { calls: number } {
  const spy = { calls: 0, checkCommand: async (_cmd: string): Promise<GuardVerdict> => { spy.calls++; return v; } };
  return spy;
}

// ── beforeEach：重設為「安全的」假 client，避免測試跑到真 shellward ──────────

beforeEach(() => {
  setShellwardClient(alwaysVerdict({ available: true, safe: true }));
});

// ── 非 Bash 工具 ─────────────────────────────────────────────────────────────

describe("非 Bash 工具", () => {
  it("非 Bash → allow，不呼叫 shellward，不記錄", async () => {
    const spy = spyClient({ available: false, reason: "should not be called" });
    setShellwardClient(spy);

    const beforeLen = listGuardDecisions(500).length;
    const r = await evaluateGuard({ tool_name: "Read", tool_input: { path: "/etc/passwd" } });

    expect(r.decision).toBe("allow");
    expect(spy.calls).toBe(0);
    expect(listGuardDecisions(500).length).toBe(beforeLen); // 不新增記錄
  });

  it("Write 工具 → allow，不呼叫 shellward", async () => {
    const spy = spyClient({ available: false, reason: "no" });
    setShellwardClient(spy);

    const r = await evaluateGuard({ tool_name: "Write", tool_input: { path: "/etc/hosts", content: "evil" } });
    expect(r.decision).toBe("allow");
    expect(spy.calls).toBe(0);
  });
});

// ── Bash + safe ───────────────────────────────────────────────────────────────

describe("Bash + safe", () => {
  it("safe=true + enforce → allow", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "ls -la" } }, "enforce");
    expect(r.decision).toBe("allow");
    expect(r.reason).toBeUndefined();
  });

  it("safe=true + shadow → allow", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo hello" } }, "shadow");
    expect(r.decision).toBe("allow");
  });

  it("safe=true + shadow → wouldBlock=false 記錄", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    const before = listGuardDecisions(500).length;
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo ok" } }, "shadow");
    const entries = listGuardDecisions(500);
    const newest = entries[entries.length - 1];
    expect(entries.length).toBe(before + 1);
    expect(newest.wouldBlock).toBe(false);
  });
});

// ── Bash + safe=false ─────────────────────────────────────────────────────────

describe("Bash + safe=false", () => {
  it("safe=false + enforce → deny，有 reason", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: false, reason: "rm -rf detected", ruleId: "rm_rf_root" }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }, "enforce");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBeTruthy();
  });

  it("safe=false + shadow → allow（不擋）", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: false, reason: "dangerous" }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }, "shadow");
    expect(r.decision).toBe("allow");
  });

  it("safe=false + shadow → 記 wouldBlock=true", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: false, reason: "suspicious" }));
    const before = listGuardDecisions(500).length;
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }, "shadow");
    const entries = listGuardDecisions(500);
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1].wouldBlock).toBe(true);
  });

  it("safe=false + shadow → 記錄 decision=allow（不是 deny）", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: false }));
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "bad" } }, "shadow");
    const entries = listGuardDecisions(500);
    const newest = entries[entries.length - 1];
    expect(newest.decision).toBe("allow");
    expect(newest.wouldBlock).toBe(true);
  });
});

// ── available=false ───────────────────────────────────────────────────────────

describe("available=false（checker 不可用）", () => {
  it("available=false + enforce → deny，reason=checker unavailable", async () => {
    setShellwardClient(alwaysVerdict({ available: false, reason: "shellward not installed" }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "ls" } }, "enforce");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("checker unavailable");
  });

  it("available=false + shadow → allow（不擋）", async () => {
    setShellwardClient(alwaysVerdict({ available: false, reason: "shellward not installed" }));
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "ls" } }, "shadow");
    expect(r.decision).toBe("allow");
  });

  it("available=false + shadow → wouldBlock=true 記錄", async () => {
    setShellwardClient(alwaysVerdict({ available: false, reason: "unavailable" }));
    const before = listGuardDecisions(500).length;
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "ls" } }, "shadow");
    const entries = listGuardDecisions(500);
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1].wouldBlock).toBe(true);
  });
});

// ── off 模式 ─────────────────────────────────────────────────────────────────

describe("off 模式", () => {
  it("off → allow，不呼叫 shellward", async () => {
    const spy = spyClient({ available: false, reason: "should not be called" });
    setShellwardClient(spy);
    const r = await evaluateGuard({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }, "off");
    expect(r.decision).toBe("allow");
    expect(spy.calls).toBe(0);
  });

  it("off → 仍有記錄（方便稽核）", async () => {
    const spy = spyClient({ available: true, safe: true });
    setShellwardClient(spy);
    const before = listGuardDecisions(500).length;
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo hi" } }, "off");
    expect(listGuardDecisions(500).length).toBe(before + 1);
    expect(spy.calls).toBe(0); // 確認沒打 shellward
  });
});

// ── record / list ─────────────────────────────────────────────────────────────

describe("recordGuardDecision / listGuardDecisions", () => {
  it("listGuardDecisions(limit) 只回最近 n 筆", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    // 確保至少有幾筆記錄
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo a" } }, "shadow");
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo b" } }, "shadow");

    const total = listGuardDecisions(500).length;
    expect(total).toBeGreaterThan(0);

    // limit=1 應只回 1 筆
    const one = listGuardDecisions(1);
    expect(one.length).toBe(1);

    // 最後一筆是最新的
    const last = listGuardDecisions(500);
    expect(last[last.length - 1].commandSummary).toBe("echo b");
  });

  it("記錄含正確的 mode 欄位", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo mode" } }, "enforce");
    const entries = listGuardDecisions(500);
    const newest = entries[entries.length - 1];
    expect(newest.mode).toBe("enforce");
  });

  it("記錄含正確的 sessionId（若提供）", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: "echo sid" }, sessionId: "sess-abc" }, "shadow");
    const entries = listGuardDecisions(500);
    const newest = entries[entries.length - 1];
    expect(newest.sessionId).toBe("sess-abc");
  });

  it("command 摘要截斷 200 字元", async () => {
    setShellwardClient(alwaysVerdict({ available: true, safe: true }));
    const longCmd = "x".repeat(300);
    await evaluateGuard({ tool_name: "Bash", tool_input: { command: longCmd } }, "shadow");
    const entries = listGuardDecisions(500);
    const newest = entries[entries.length - 1];
    expect(newest.commandSummary.length).toBe(200);
  });
});
