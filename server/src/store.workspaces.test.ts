import { describe, it, expect, afterEach } from "vitest";
import { createWorkspace, updateWorkspace, getWorkspace, deleteWorkspace } from "./store.js";

describe("workspace workingDir", () => {
  const created: string[] = [];
  afterEach(() => { for (const id of created.splice(0)) deleteWorkspace(id); });

  it("updateWorkspace 寫入/讀回 workingDir", () => {
    const ws = createWorkspace({ name: "wd test" });
    created.push(ws.id);
    updateWorkspace(ws.id, { workingDir: "D:/some/path" });
    expect(getWorkspace(ws.id)?.workingDir).toBe("D:/some/path");
  });
});
