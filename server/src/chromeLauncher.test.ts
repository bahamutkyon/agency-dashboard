import { describe, it, expect } from "vitest";
import { findPortConflict } from "./chromeLauncher.js";

describe("findPortConflict — 跨工作區 CDP port 唯一性", () => {
  const wss = [
    { id: "a", name: "甲", chromeCdpPort: 9333 },
    { id: "b", name: "乙", chromeCdpPort: 9334 },
    { id: "c", name: "丙" }, // 沒設 port
  ];

  it("別的工作區已用同一個 port → 回傳那個工作區", () => {
    expect(findPortConflict(wss, 9334, "a")).toEqual({ id: "b", name: "乙" });
  });

  it("只有自己用這個 port → null（不算衝突）", () => {
    expect(findPortConflict(wss, 9333, "a")).toBeNull();
  });

  it("沒人用這個 port → null", () => {
    expect(findPortConflict(wss, 9999, "a")).toBeNull();
  });

  it("沒設 port 的工作區不會被誤判（undefined 不比對）", () => {
    expect(findPortConflict(wss, undefined as any, "a")).toBeNull();
  });
});
