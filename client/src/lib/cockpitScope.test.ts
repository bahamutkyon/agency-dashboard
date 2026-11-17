import { describe, it, expect } from "vitest";
import { scopeBriefing } from "./cockpitScope";
import type { BriefingSection } from "./api";

const sections: BriefingSection[] = [
  { kind: "status", title: "近況", items: [
    { title: "LP", body: "", workspaceId: "ws_lp" },
    { title: "IP", body: "", workspaceId: "ws_ip" },
    { title: "IP2", body: "", workspaceId: "ws_ip" },
  ] },
  { kind: "learning", title: "學習", items: [
    { title: "批准", body: "", action: { type: "approve", proposalIds: ["p1"] } },
  ] },
];

describe("scopeBriefing", () => {
  it("在某工作區時：只留本工作區 + 不屬任何工作區的項目，其他工作區收進 others", () => {
    const r = scopeBriefing(sections, "ws_lp");
    expect(r.current.map((s) => s.items.map((i) => i.title))).toEqual([["LP"], ["批准"]]);
    expect(r.others.map((i) => i.item.title)).toEqual(["IP", "IP2"]);
    expect(r.others[0].sectionIdx).toBe(0);
    expect(r.others[0].itemIdx).toBe(1);
  });

  it("current 保留原始索引，供批准/駁回就地移除用", () => {
    const r = scopeBriefing(sections, "ws_lp");
    expect(r.current[1].entries[0]).toMatchObject({ sectionIdx: 1, itemIdx: 0 });
  });

  it("沒有本工作區項目的區塊整段不顯示", () => {
    const r = scopeBriefing(sections, "ws_other");
    expect(r.current.map((s) => s.title)).toEqual(["學習"]);
    expect(r.others).toHaveLength(3);
  });

  it("預設工作區 = 總覽，全部顯示、不折疊", () => {
    const r = scopeBriefing(sections, "default");
    expect(r.current.map((s) => s.items.length)).toEqual([3, 1]);
    expect(r.others).toHaveLength(0);
  });
});
