import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { runClaudeOneShot, setOneShotUsageRecorder } from "./claudeOneShot.js";

/**
 * 建一個假的 ChildProcess（EventEmitter + stdout/stderr/stdin），
 * 讓測試可以精準控制 error / close / data 事件，不必真的開 claude 子程序。
 */
function makeFakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  const stdinWrites: Buffer[] = [];
  child.stdin = {
    writes: stdinWrites,
    write: (b: Buffer) => { stdinWrites.push(b); },
    end: () => {},
    on: () => {},
  };
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

describe("runClaudeOneShot", () => {
  it("spawn 失敗（error 事件）不會 throw，回 ok:false 帶 error", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      // 模擬 ENOENT：spawn 後非同步發 error 事件
      setImmediate(() => child.emit("error", new Error("spawn claude ENOENT")));
      return child as any;
    });

    const result = await runClaudeOneShot(["-p"], { spawn, input: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("逾時回 ok:false 並 kill 子程序", async () => {
    const child = makeFakeChild();
    // 永不 close 的 child → 應由 timeout 收尾
    const spawn = vi.fn(() => child as any);

    const result = await runClaudeOneShot(["-p"], { spawn, timeoutMs: 20, input: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(child.killed).toBe(true);
  });

  it("正常結束（code 0）回 ok:true 帶 stdout", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit("data", '{"result":"ok"}');
        child.emit("close", 0);
      });
      return child as any;
    });

    const result = await runClaudeOneShot(["-p"], { spawn, input: "hi" });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('"result":"ok"');
  });

  it("非零離開碼回 ok:false 帶 error", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => {
        child.stderr.emit("data", "boom");
        child.emit("close", 1);
      });
      return child as any;
    });

    const result = await runClaudeOneShot(["-p"], { spawn, input: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("input 會寫進子程序 stdin", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => child.emit("close", 0));
      return child as any;
    });

    await runClaudeOneShot(["-p"], { spawn, input: "餵給模型的內容" });
    const written = Buffer.concat(child.stdin.writes).toString("utf8");
    expect(written).toBe("餵給模型的內容");
  });

  // Fix #5：spawn 時帶 sanitizedChildEnv，不洩漏 ACCESS_TOKEN
  it("spawn options 帶 env 且不含 ACCESS_TOKEN（縱深防禦一致性）", async () => {
    const child = makeFakeChild();
    let capturedOptions: any = undefined;
    const spawn = vi.fn((args, options) => {
      capturedOptions = options;
      setImmediate(() => child.emit("close", 0));
      return child as any;
    });

    const original = process.env.ACCESS_TOKEN;
    process.env.ACCESS_TOKEN = "super-secret-dashboard-token";
    try {
      await runClaudeOneShot(["-p"], { spawn, input: "hi" });
    } finally {
      if (original === undefined) delete process.env.ACCESS_TOKEN;
      else process.env.ACCESS_TOKEN = original;
    }

    // spawn 應帶 env（非 undefined）
    expect(capturedOptions).toBeTruthy();
    expect(capturedOptions?.env).toBeTruthy();
    // ACCESS_TOKEN 不應出現在子程序 env
    expect(capturedOptions?.env?.ACCESS_TOKEN).toBeUndefined();
  });
});

describe("source 用量記錄（成本歸因）", () => {
  // 每個測試後清除 recorder，避免跨測試污染
  afterEach(() => {
    setOneShotUsageRecorder(() => {});
  });

  it("帶 source 且 stdout 為含 usage 的 JSON → recorder 被以正確參數呼叫", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit("data", JSON.stringify({ result: "ok", total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 50 } }));
        child.emit("close", 0);
      });
      return child as any;
    });
    const recorder = vi.fn();
    setOneShotUsageRecorder(recorder);
    const result = await runClaudeOneShot(["-p"], { spawn, source: "titler" });
    expect(result.ok).toBe(true);
    expect(recorder).toHaveBeenCalledOnce();
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({ total_cost_usd: 0.01 }),
      "titler",
    );
  });

  it("帶 source 但 stdout 非 JSON → 不拋錯、結果照常 ok:true，recorder 不被呼叫", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit("data", "not-valid-json");
        child.emit("close", 0);
      });
      return child as any;
    });
    const recorder = vi.fn();
    setOneShotUsageRecorder(recorder);
    const result = await runClaudeOneShot(["-p"], { spawn, source: "titler" });
    expect(result.ok).toBe(true);
    // JSON.parse 失敗 → fail-safe 吞掉，recorder 不被呼叫
    expect(recorder).not.toHaveBeenCalled();
  });

  it("不帶 source → recorder 不被呼叫", async () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => {
      setImmediate(() => {
        child.stdout.emit("data", JSON.stringify({ result: "ok", total_cost_usd: 0.01 }));
        child.emit("close", 0);
      });
      return child as any;
    });
    const recorder = vi.fn();
    setOneShotUsageRecorder(recorder);
    await runClaudeOneShot(["-p"], { spawn }); // 不帶 source
    expect(recorder).not.toHaveBeenCalled();
  });
});
