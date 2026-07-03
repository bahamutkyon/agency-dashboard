import { describe, it, expect } from "vitest";
import { buildCockpitContext } from "./cockpitContext.js";
import { createWorkspace, updateWorkspace } from "./store.js";

describe("buildCockpitContext", () => {
  it("納入有內容的工作區、擷取記憶片段、略過空工作區", () => {
    const a = createWorkspace({ name: "甲事業" });
    updateWorkspace(a.id, { memory: "重點：本週要對帳" });
    const pack = buildCockpitContext();
    const wsA = pack.workspaces.find((w) => w.id === a.id);
    expect(wsA?.name).toBe("甲事業");
    expect(wsA?.memoryExcerpt).toContain("對帳");
    const empty = createWorkspace({ name: "空事業" });
    const pack2 = buildCockpitContext();
    expect(pack2.workspaces.find((w) => w.id === empty.id)).toBeUndefined();
  });
});
