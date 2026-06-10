import { describe, it, expect, vi } from "vitest";
import { runScheduledTier } from "./studyScheduler.js";

describe("runScheduledTier", () => {
  it("依 picker 取目標、用 worker 建 run", async () => {
    const worker = vi.fn().mockResolvedValue({ created: 1 });
    const picker = vi.fn().mockReturnValue(["a1", "a2"]);
    const r = await runScheduledTier("hot", 10, worker, () => {}, picker);
    expect(picker).toHaveBeenCalledWith("hot", 10);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(r.total).toBe(2);
  });
  it("空名單不建 run、不呼叫 worker", async () => {
    const worker = vi.fn();
    const r = await runScheduledTier("cold", 10, worker, () => {}, () => []);
    expect(worker).not.toHaveBeenCalled();
    expect(r.total).toBe(0);
  });
  it("worker 收到 (target, runId) 且 runId 為字串", async () => {
    const seen: { t: any; runId: any }[] = [];
    const worker = vi.fn().mockImplementation(async (t, runId) => {
      seen.push({ t, runId });
      return { created: 1 };
    });
    const r = await runScheduledTier("hot", 10, worker, () => {}, () => ["a1"]);
    expect(r.runId).toBeTruthy();
    expect(seen[0].runId).toBe(r.runId);
    expect(typeof seen[0].runId).toBe("string");
  });
});
