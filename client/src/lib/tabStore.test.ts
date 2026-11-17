import { describe, it, expect, beforeEach } from "vitest";
import { saveTabs, loadTabs } from "./tabStore";

describe("tabStore（分頁依工作區保存）", () => {
  beforeEach(() => localStorage.clear());

  it("各工作區分開存，切回來還原；狀態一律重設為 idle", () => {
    saveTabs("ws_lp", [{ sessionId: "a", agentId: "x", agentName: "X", status: "busy" }]);
    saveTabs("ws_ip", [{ sessionId: "b", agentId: "y", agentName: "Y", status: "idle" }]);
    expect(loadTabs("ws_lp", new Set(["a", "b"]))).toEqual([{ sessionId: "a", agentId: "x", agentName: "X", status: "idle" }]);
    expect(loadTabs("ws_ip", new Set(["a", "b"])).map((t) => t.sessionId)).toEqual(["b"]);
  });

  it("已被刪除的對話不還原", () => {
    saveTabs("ws_lp", [{ sessionId: "gone", agentId: "x", agentName: "X", status: "idle" }]);
    expect(loadTabs("ws_lp", new Set())).toEqual([]);
  });

  it("壞資料不炸", () => {
    localStorage.setItem("agency:tabs:ws_lp", "{oops");
    expect(loadTabs("ws_lp", new Set(["a"]))).toEqual([]);
  });
});
