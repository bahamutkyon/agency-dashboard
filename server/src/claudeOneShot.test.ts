import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runClaudeOneShot } from "./claudeOneShot.js";

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
});
