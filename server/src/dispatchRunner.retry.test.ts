import { describe, it, expect, vi } from "vitest";
import { runOneWithRetry, runConsult, runDispatchByMode } from "./dispatchRunner.js";
import type { ConsultResult } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";

const item: DispatchItem = { agentId: "a1", mode: "consult", task: "任務甲" };

function res(status: ConsultResult["status"], output = "內容"): ConsultResult {
  return { agentId: item.agentId, task: item.task, output: status === "ok" ? output : "", status, subSessionId: "sub-x" };
}

describe("runOneWithRetry — 派工失敗自癒", () => {
  it("第一次 ok → 只跑一次，attempts=1", async () => {
    const runOne = vi.fn().mockResolvedValue(res("ok"));
    const r = await runOneWithRetry(runOne, item, "ws1", 1000);
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("ok");
    expect(r.attempts).toBe(1);
  });

  it("第一次 error → 自動重試一次，第二次 ok → 回 ok，attempts=2", async () => {
    const runOne = vi.fn()
      .mockResolvedValueOnce(res("error"))
      .mockResolvedValueOnce(res("ok", "第二次成功"));
    const r = await runOneWithRetry(runOne, item, "ws1", 1000);
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("ok");
    expect(r.output).toBe("第二次成功");
    expect(r.attempts).toBe(2);
  });

  it("連續 error → 最多跑 maxAttempts 次後回最後一次 error", async () => {
    const runOne = vi.fn().mockResolvedValue(res("error"));
    const r = await runOneWithRetry(runOne, item, "ws1", 1000, { maxAttempts: 2 });
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("error");
    expect(r.attempts).toBe(2);
  });

  it("timeout 不重試（時間預算已耗盡、部分輸出已救回）", async () => {
    const runOne = vi.fn().mockResolvedValue({ ...res("timeout"), output: "跑到一半的內容" });
    const r = await runOneWithRetry(runOne, item, "ws1", 1000);
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("timeout");
    expect(r.output).toBe("跑到一半的內容");
  });

  it("runOne 拋錯（如 spawn 失敗）→ 不往上炸，轉成 error 結果並重試", async () => {
    const runOne = vi.fn()
      .mockRejectedValueOnce(new Error("spawn 失敗"))
      .mockResolvedValueOnce(res("ok", "重試成功"));
    const r = await runOneWithRetry(runOne, item, "ws1", 1000);
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("ok");
    expect(r.output).toBe("重試成功");
  });

  it("連續拋錯 → 回 error 結果（含錯誤訊息），絕不 reject", async () => {
    const runOne = vi.fn().mockRejectedValue(new Error("一直炸"));
    const r = await runOneWithRetry(runOne, item, "ws1", 1000);
    expect(r.status).toBe("error");
    expect(r.output).toContain("一直炸");
    expect(r.attempts).toBe(2);
  });
});

describe("runConsult 整合重試", () => {
  it("批次中單項先 error 後 ok → 整批保序完成且該項 ok", async () => {
    const items: DispatchItem[] = [
      { agentId: "a1", mode: "consult", task: "任務甲" },
      { agentId: "a2", mode: "consult", task: "任務乙" },
    ];
    const calls: string[] = [];
    const runOne = vi.fn(async (it: DispatchItem) => {
      calls.push(it.agentId);
      // a1 第一次 error、第二次 ok；a2 一次 ok
      if (it.agentId === "a1" && calls.filter((c) => c === "a1").length === 1) {
        return { agentId: it.agentId, task: it.task, output: "", status: "error" as const, subSessionId: "s1" };
      }
      return { agentId: it.agentId, task: it.task, output: `${it.agentId} 回覆`, status: "ok" as const, subSessionId: "s2" };
    });
    const out = await runConsult(items, "ws1", { concurrency: 2, perItemTimeoutMs: 1000 }, runOne);
    expect(out[0].agentId).toBe("a1");
    expect(out[0].status).toBe("ok");
    expect(out[1].status).toBe("ok");
    expect(calls.filter((c) => c === "a1")).toHaveLength(2); // a1 重試了一次
  });

  it("runOne 拋錯的項不會炸掉整批（其餘項照常完成）", async () => {
    const items: DispatchItem[] = [
      { agentId: "boom", mode: "consult", task: "會炸" },
      { agentId: "fine", mode: "consult", task: "正常" },
    ];
    const runOne = vi.fn(async (it: DispatchItem) => {
      if (it.agentId === "boom") throw new Error("模擬 spawn 掛掉");
      return { agentId: it.agentId, task: it.task, output: "好", status: "ok" as const, subSessionId: "s" };
    });
    const out = await runConsult(items, "ws1", { concurrency: 2, perItemTimeoutMs: 1000 }, runOne);
    expect(out[0].status).toBe("error");
    expect(out[0].output).toContain("模擬 spawn 掛掉");
    expect(out[1].status).toBe("ok");
  });
});

describe("runDispatchByMode 整合重試", () => {
  it("execute 項 error → 不機械重試（有副作用，重跑可能重複執行），失敗如實整合", async () => {
    const items: DispatchItem[] = [{ agentId: "ex1", mode: "execute", task: "執行任務" }];
    const runExec = vi.fn(async (it: DispatchItem) => (
      { agentId: it.agentId, task: it.task, output: "", status: "error" as const, subSessionId: "s" }
    ));
    const text = await runDispatchByMode(items, "ws1", { concurrency: 1, consultTimeoutMs: 500, executeTimeoutMs: 500 }, undefined, runExec);
    expect(runExec).toHaveBeenCalledTimes(1); // 只跑一次，不重試
    expect(text).toContain("（error）");
  });

  it("execute 項拋錯 → 轉單項 error 結果、不炸整批、也不重試", async () => {
    const items: DispatchItem[] = [
      { agentId: "ex1", mode: "execute", task: "會炸的任務" },
      { agentId: "ex2", mode: "execute", task: "正常任務" },
    ];
    const runExec = vi.fn(async (it: DispatchItem) => {
      if (it.agentId === "ex1") throw new Error("spawn 失敗");
      return { agentId: it.agentId, task: it.task, output: "完成", status: "ok" as const, subSessionId: "s" };
    });
    const text = await runDispatchByMode(items, "ws1", { concurrency: 2, consultTimeoutMs: 500, executeTimeoutMs: 500 }, undefined, runExec);
    expect(runExec).toHaveBeenCalledTimes(2); // 各一次（炸的那項不重試）
    expect(text).toContain("派工執行拋錯");
    expect(text).toContain("完成");
  });
});
