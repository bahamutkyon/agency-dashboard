import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ShellwardClient, type SpawnShellwardFn } from "./shellwardClient.js";

/**
 * 假的 shellward 子程序：EventEmitter + stdout/stderr/stdin。
 * 攔截 client 寫進 stdin 的 newline-delimited JSON，
 * - 自動回應 initialize（模擬握手）
 * - 對 tools/call 交給 onToolCall 由測試決定怎麼回（或不回 → 測逾時）
 */
function makeFakeShellward(onToolCall?: (id: number, command: string, emit: (resp: any) => void) => void) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.killed = false;

  const emit = (resp: any) => {
    child.stdout.emit("data", JSON.stringify(resp) + "\n");
  };

  let buf = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method === "initialize") {
      emit({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "shellward", version: "0.5.16" },
        },
      });
    } else if (msg.method === "notifications/initialized") {
      // notification, no reply
    } else if (msg.method === "tools/call") {
      const command = msg.params?.arguments?.command ?? "";
      onToolCall?.(msg.id, command, emit);
    }
  };

  child.stdin = {
    write: (s: string | Buffer) => {
      buf += String(s);
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
      return true;
    },
    end: () => {},
    on: () => {},
  };
  child.kill = () => {
    child.killed = true;
    child.emit("close", 0);
  };
  return child;
}

/** 產生一個 check_command 的 shellward 回傳（result.content[0].text 是 JSON 字串）。 */
function verdictResponse(id: number, payload: any) {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  };
}

describe("ShellwardClient", () => {
  it("危險指令 → available:true, safe:false 帶 reason/ruleId", async () => {
    const child = makeFakeShellward((id, _cmd, emit) => {
      emit(verdictResponse(id, {
        safe: false,
        level: "CRITICAL",
        reason: "检测到危险命令: rm -rf /",
        rule_id: "rm_rf_root",
      }));
    });
    const spawn: SpawnShellwardFn = vi.fn(() => child as any);
    const client = new ShellwardClient({ spawn });

    const v = await client.checkCommand("rm -rf /");
    expect(v.available).toBe(true);
    if (v.available) {
      expect(v.safe).toBe(false);
      expect(v.reason).toContain("危险");
      expect(v.ruleId).toBe("rm_rf_root");
    }
  });

  it("安全指令 → available:true, safe:true", async () => {
    const child = makeFakeShellward((id, _cmd, emit) => {
      emit(verdictResponse(id, { safe: true, level: null, reason: null, rule_id: null }));
    });
    const spawn: SpawnShellwardFn = vi.fn(() => child as any);
    const client = new ShellwardClient({ spawn });

    const v = await client.checkCommand("git status");
    expect(v.available).toBe(true);
    if (v.available) expect(v.safe).toBe(true);
  });

  it("常駐重用：多次呼叫只 spawn 一次", async () => {
    const child = makeFakeShellward((id, _cmd, emit) => {
      emit(verdictResponse(id, { safe: true }));
    });
    const spawn = vi.fn(() => child as any) as unknown as SpawnShellwardFn;
    const client = new ShellwardClient({ spawn });

    await client.checkCommand("ls");
    await client.checkCommand("pwd");
    await client.checkCommand("whoami");
    expect((spawn as any).mock.calls.length).toBe(1);
  });

  it("並行多筆：id 對應正確不錯亂", async () => {
    // 依 command 決定回不同 verdict，且故意「延後、亂序」回覆以驗證 id 路由
    const pending: Array<{ id: number; command: string; emit: (r: any) => void }> = [];
    const child = makeFakeShellward((id, command, emit) => {
      pending.push({ id, command, emit });
    });
    const spawn: SpawnShellwardFn = vi.fn(() => child as any);
    const client = new ShellwardClient({ spawn });

    const pA = client.checkCommand("rm -rf /");   // 危險
    const pB = client.checkCommand("git status"); // 安全
    const pC = client.checkCommand("shutdown");   // 危險

    // 等三筆都送達 fake（握手完成後才會有 tools/call）
    await vi.waitFor(() => expect(pending.length).toBe(3));

    // 亂序回覆：先回 C，再回 A，最後回 B
    const byCmd = (c: string) => pending.find((p) => p.command === c)!;
    byCmd("shutdown").emit(verdictResponse(byCmd("shutdown").id, { safe: false, rule_id: "shutdown" }));
    byCmd("rm -rf /").emit(verdictResponse(byCmd("rm -rf /").id, { safe: false, rule_id: "rm_rf_root" }));
    byCmd("git status").emit(verdictResponse(byCmd("git status").id, { safe: true }));

    const [a, b, c] = await Promise.all([pA, pB, pC]);
    expect(a.available && a.safe === false && a.ruleId === "rm_rf_root").toBe(true);
    expect(b.available && b.safe === true).toBe(true);
    expect(c.available && c.safe === false && c.ruleId === "shutdown").toBe(true);
  });

  it("逾時（不回覆）→ available:false, reason 含 timeout，不吊死", async () => {
    const child = makeFakeShellward(() => { /* 故意不回 */ });
    const spawn: SpawnShellwardFn = vi.fn(() => child as any);
    const client = new ShellwardClient({ spawn, timeoutMs: 30 });

    const v = await client.checkCommand("sleep 999");
    expect(v.available).toBe(false);
    if (!v.available) expect(v.reason).toContain("timeout");
  });

  it("子程序死亡 → pending 收斂為 unavailable，下次呼叫自動重連（重 spawn）", async () => {
    let call = 0;
    const child1 = makeFakeShellward(() => { /* 第一次不回，等會兒殺掉 */ });
    const child2 = makeFakeShellward((id, _cmd, emit) => {
      emit(verdictResponse(id, { safe: true }));
    });
    const spawn = vi.fn(() => (++call === 1 ? child1 : child2) as any) as unknown as SpawnShellwardFn;
    const client = new ShellwardClient({ spawn, timeoutMs: 5000 });

    const p1 = client.checkCommand("git status");
    // 等握手 + tools/call 送達 child1 後，模擬子程序崩潰
    await vi.waitFor(() => expect((spawn as any).mock.calls.length).toBe(1));
    child1.emit("close", 1);

    const v1 = await p1;
    expect(v1.available).toBe(false);

    // 下次呼叫應自動重連（第二次 spawn）並正常回覆
    const v2 = await client.checkCommand("ls");
    expect((spawn as any).mock.calls.length).toBe(2);
    expect(v2.available).toBe(true);
    if (v2.available) expect(v2.safe).toBe(true);
  });

  it("spawn 失敗（error 事件）→ 一律 available:false（fail-closed 前提），不 throw", async () => {
    const spawn: SpawnShellwardFn = vi.fn(() => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr = new EventEmitter();
      child.stderr.setEncoding = () => {};
      child.stdin = { write: () => true, end: () => {}, on: () => {} };
      child.kill = () => {};
      setImmediate(() => child.emit("error", new Error("spawn shellward-mcp ENOENT")));
      return child as any;
    });
    const client = new ShellwardClient({ spawn, timeoutMs: 5000 });

    const v1 = await client.checkCommand("git status");
    expect(v1.available).toBe(false);
    // 再呼叫一次仍是 available:false（不崩、可持續 fail-closed）
    const v2 = await client.checkCommand("ls");
    expect(v2.available).toBe(false);
  });

  it("spawn 帶 SHELLWARD_* env 且不含 ACCESS_TOKEN", async () => {
    let capturedEnv: any;
    const child = makeFakeShellward((id, _cmd, emit) => emit(verdictResponse(id, { safe: true })));
    const spawn: SpawnShellwardFn = vi.fn((opts: any) => { capturedEnv = opts?.env; return child as any; });

    const original = process.env.ACCESS_TOKEN;
    process.env.ACCESS_TOKEN = "super-secret";
    try {
      const client = new ShellwardClient({ spawn });
      await client.checkCommand("ls");
    } finally {
      if (original === undefined) delete process.env.ACCESS_TOKEN;
      else process.env.ACCESS_TOKEN = original;
    }

    expect(capturedEnv).toBeTruthy();
    expect(capturedEnv.ACCESS_TOKEN).toBeUndefined();
    expect(capturedEnv.SHELLWARD_MODE).toBe("enforce");
    expect(capturedEnv.SHELLWARD_LOCALE).toBe("zh");
    expect(capturedEnv.SHELLWARD_THRESHOLD).toBe("60");
  });
});
