/**
 * Phase 2 + 3 測試：
 *   - craft / category 記憶 workspace 隔離（不同 ws 看不到對方的 workspace 條目）
 *   - global / legacy-global 跨 ws 可見
 *   - promoteCraftMemory / promoteCategoryMemory 升降 scope
 *   - buildCapabilityBlockFor 注入塊正確分節
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  appendCraftMemory, setCraftMemory, getCraftMemoryFor,
  appendCategoryMemory, setCategoryMemory, getCategoryMemoryFor,
  promoteCraftMemory, promoteCategoryMemory,
  listLegacyCraftEntries, listLegacyCategoryEntries,
  listCraftMemoryEntries,
} from "./learningStore.js";
import { buildCapabilityBlockFor } from "./learningInjector.js";
import { db } from "./db.js";

const AGENT = "test-ws-iso-agent";
const CAT = "test-ws-iso-cat";
const WS_A = "ws_test_A";
const WS_B = "ws_test_B";

function cleanup() {
  db.prepare("DELETE FROM agent_craft_memory WHERE agent_id = ?").run(AGENT);
  db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT);
}

afterEach(cleanup);

describe("Phase 2: craft memory workspace 隔離", () => {
  it("workspace=A 寫入，workspace=B 看不到", () => {
    setCraftMemory(AGENT, "A 工作區的手藝", "workspace", WS_A);
    const bA = getCraftMemoryFor(AGENT, WS_A);
    const bB = getCraftMemoryFor(AGENT, WS_B);
    expect(bA.workspace).toBe("A 工作區的手藝");
    expect(bB.workspace).toBe("");
  });

  it("global 條目跨 workspace 可見", () => {
    setCraftMemory(AGENT, "通用方法論", "global");
    const bA = getCraftMemoryFor(AGENT, WS_A);
    const bB = getCraftMemoryFor(AGENT, WS_B);
    expect(bA.global).toBe("通用方法論");
    expect(bB.global).toBe("通用方法論");
  });

  it("legacy-global 條目跨 workspace 可見", () => {
    setCraftMemory(AGENT, "遷移前舊記憶", "legacy-global");
    const bA = getCraftMemoryFor(AGENT, WS_A);
    expect(bA.legacyGlobal).toBe("遷移前舊記憶");
    expect(bA.global).toBe("");
    expect(bA.workspace).toBe("");
  });

  it("三種 scope 並存：global + ws-A workspace + legacy 在 A 視角下都看得到，但 B 看不到 ws-A 的", () => {
    setCraftMemory(AGENT, "通用", "global");
    setCraftMemory(AGENT, "A 專屬", "workspace", WS_A);
    setCraftMemory(AGENT, "遷移前", "legacy-global");

    const bA = getCraftMemoryFor(AGENT, WS_A);
    expect(bA.global).toBe("通用");
    expect(bA.workspace).toBe("A 專屬");
    expect(bA.legacyGlobal).toBe("遷移前");

    const bB = getCraftMemoryFor(AGENT, WS_B);
    expect(bB.global).toBe("通用");
    expect(bB.workspace).toBe(""); // 關鍵：B 看不到 A 的工作區條目
    expect(bB.legacyGlobal).toBe("遷移前");
  });

  it("setCraftMemory 空字串會刪除條目", () => {
    setCraftMemory(AGENT, "暫時內容", "workspace", WS_A);
    expect(getCraftMemoryFor(AGENT, WS_A).workspace).toBe("暫時內容");
    setCraftMemory(AGENT, "", "workspace", WS_A);
    expect(getCraftMemoryFor(AGENT, WS_A).workspace).toBe("");
  });

  it("scope='workspace' 必須指定 workspaceId（否則丟錯）", () => {
    expect(() => setCraftMemory(AGENT, "x", "workspace", "")).toThrow();
    expect(() => appendCraftMemory(AGENT, "x", "workspace", "")).toThrow();
  });

  it("scope='global'/'legacy-global' 不可指定 workspaceId", () => {
    expect(() => setCraftMemory(AGENT, "x", "global", WS_A)).toThrow();
    expect(() => setCraftMemory(AGENT, "x", "legacy-global", WS_A)).toThrow();
  });
});

describe("Phase 2: category memory workspace 隔離", () => {
  it("category 同樣三種 scope 隔離正確", () => {
    setCategoryMemory(CAT, "類通用", "global");
    setCategoryMemory(CAT, "A 類專屬", "workspace", WS_A);
    setCategoryMemory(CAT, "類 legacy", "legacy-global");

    const bA = getCategoryMemoryFor(CAT, WS_A);
    expect(bA.global).toBe("類通用");
    expect(bA.workspace).toBe("A 類專屬");
    expect(bA.legacyGlobal).toBe("類 legacy");

    const bB = getCategoryMemoryFor(CAT, WS_B);
    expect(bB.workspace).toBe(""); // B 看不到 A 的
  });
});

describe("Phase 2: buildCapabilityBlockFor 注入塊", () => {
  it("空 bundle → 回空字串", () => {
    const out = buildCapabilityBlockFor(
      { global: "", workspace: "", legacyGlobal: "" },
      { global: "", workspace: "", legacyGlobal: "" },
    );
    expect(out).toBe("");
  });

  it("三種 scope 都有時，注入塊分節清晰並標明 legacy 警告", () => {
    const out = buildCapabilityBlockFor(
      { global: "類 G", workspace: "類 W", legacyGlobal: "類 L" },
      { global: "craft G", workspace: "craft W", legacyGlobal: "craft L" },
    );
    expect(out).toContain("通用（跨工作區共享的方法論）");
    expect(out).toContain("本工作區專屬");
    expect(out).toContain("⚠️ legacy");
    expect(out).toContain("類 G");
    expect(out).toContain("類 W");
    expect(out).toContain("類 L");
    expect(out).toContain("craft G");
    expect(out).toContain("craft W");
    expect(out).toContain("craft L");
  });

  it("只有 workspace 條目時，不顯示通用/legacy 段", () => {
    const out = buildCapabilityBlockFor(
      { global: "", workspace: "", legacyGlobal: "" },
      { global: "", workspace: "工作區獨有", legacyGlobal: "" },
    );
    expect(out).toContain("本工作區專屬");
    expect(out).toContain("工作區獨有");
    expect(out).not.toContain("通用（跨工作區共享的方法論）");
    expect(out).not.toContain("⚠️ legacy");
  });
});

describe("Phase 3: promoteCraftMemory 升級 scope", () => {
  it("legacy-global → global：條目從 legacy 槽位搬到 global", () => {
    setCraftMemory(AGENT, "舊記憶", "legacy-global");
    promoteCraftMemory(AGENT, "legacy-global", "", "global", "");
    const b = getCraftMemoryFor(AGENT, WS_A);
    expect(b.global).toBe("舊記憶");
    expect(b.legacyGlobal).toBe("");
  });

  it("legacy-global → workspace=A：條目從 legacy 搬到 A 工作區", () => {
    setCraftMemory(AGENT, "舊記憶", "legacy-global");
    promoteCraftMemory(AGENT, "legacy-global", "", "workspace", WS_A);
    const bA = getCraftMemoryFor(AGENT, WS_A);
    const bB = getCraftMemoryFor(AGENT, WS_B);
    expect(bA.workspace).toBe("舊記憶");
    expect(bA.legacyGlobal).toBe("");
    expect(bB.workspace).toBe("");
    expect(bB.legacyGlobal).toBe(""); // 已搬走
  });

  it("listLegacyCraftEntries 列出 legacy 條目並可在升級後消失", () => {
    setCraftMemory(AGENT, "待重審 1", "legacy-global");
    const before = listLegacyCraftEntries().filter((e) => e.agentId === AGENT);
    expect(before).toHaveLength(1);
    promoteCraftMemory(AGENT, "legacy-global", "", "global", "");
    const after = listLegacyCraftEntries().filter((e) => e.agentId === AGENT);
    expect(after).toHaveLength(0);
  });
});

describe("Phase 3: promoteCategoryMemory 升級 scope", () => {
  it("legacy-global → global：可成功搬遷", () => {
    setCategoryMemory(CAT, "類 legacy", "legacy-global");
    promoteCategoryMemory(CAT, "legacy-global", "", "global", "");
    const b = getCategoryMemoryFor(CAT, WS_A);
    expect(b.global).toBe("類 legacy");
    expect(b.legacyGlobal).toBe("");
  });

  it("listLegacyCategoryEntries 列出 legacy 條目", () => {
    setCategoryMemory(CAT, "類 legacy 待重審", "legacy-global");
    const entries = listLegacyCategoryEntries().filter((e) => e.category === CAT);
    expect(entries).toHaveLength(1);
    expect(entries[0].scope).toBe("legacy-global");
  });
});

describe("listCraftMemoryEntries 完整列表", () => {
  it("回傳該 agent 的所有 scope/workspace 條目", () => {
    setCraftMemory(AGENT, "G", "global");
    setCraftMemory(AGENT, "A", "workspace", WS_A);
    setCraftMemory(AGENT, "B", "workspace", WS_B);
    setCraftMemory(AGENT, "L", "legacy-global");
    const list = listCraftMemoryEntries(AGENT);
    expect(list).toHaveLength(4);
    const byScope = new Map(list.map((e) => [`${e.scope}|${e.workspaceId}`, e.content]));
    expect(byScope.get("global|")).toBe("G");
    expect(byScope.get("workspace|" + WS_A)).toBe("A");
    expect(byScope.get("workspace|" + WS_B)).toBe("B");
    expect(byScope.get("legacy-global|")).toBe("L");
  });
});
