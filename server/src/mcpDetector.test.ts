import { describe, it, expect } from "vitest";
import { applyCdpEndpoint } from "./mcpDetector.js";

describe("applyCdpEndpoint — 把 playwright 接到專屬 Chrome 而不洗掉其他 args", () => {
  it("丟掉 --isolated、加上 --cdp-endpoint", () => {
    const out = applyCdpEndpoint({ command: "playwright-mcp", args: ["--isolated"] }, 9333);
    expect(out.args).toEqual(["--cdp-endpoint", "http://localhost:9333"]);
    expect(out.command).toBe("playwright-mcp"); // 其餘欄位原樣保留
  });

  it("保留其他自訂 args（例如 --viewport-size）", () => {
    const out = applyCdpEndpoint({ args: ["--isolated", "--viewport-size", "1280,720"] }, 9000);
    expect(out.args).toEqual(["--viewport-size", "1280,720", "--cdp-endpoint", "http://localhost:9000"]);
  });

  it("原本沒有 args 也能加", () => {
    const out = applyCdpEndpoint({ command: "x" }, 1234);
    expect(out.args).toEqual(["--cdp-endpoint", "http://localhost:1234"]);
  });

  it("已有舊的 --cdp-endpoint → 換成新的、不重複殘留", () => {
    const out = applyCdpEndpoint({ args: ["--cdp-endpoint", "http://localhost:1", "--headless"] }, 2);
    expect(out.args).toEqual(["--headless", "--cdp-endpoint", "http://localhost:2"]);
  });
});
