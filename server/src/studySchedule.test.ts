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
});
