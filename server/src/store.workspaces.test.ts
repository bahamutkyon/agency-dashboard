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

  it("帶 id 建立會沿用該 id", () => {
    const ws = createWorkspace({ name: "fixed id test", id: "__fixed_id_test__" });
    created.push(ws.id);
    expect(ws.id).toBe("__fixed_id_test__");
    expect(getWorkspace("__fixed_id_test__")?.name).toBe("fixed id test");
  });
});
