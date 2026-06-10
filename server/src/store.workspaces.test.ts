import { describe, it, expect } from "vitest";
import { createWorkspace, updateWorkspace, getWorkspace } from "./store/workspaces.js";

describe("workspace workingDir", () => {
  it("updateWorkspace 寫入/讀回 workingDir", () => {
    const ws = createWorkspace({ name: "wd test" });
    updateWorkspace(ws.id, { workingDir: "D:/some/path" });
    expect(getWorkspace(ws.id)?.workingDir).toBe("D:/some/path");
  });
});
