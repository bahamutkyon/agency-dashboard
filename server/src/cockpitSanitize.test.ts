import { describe, it, expect } from "vitest";
import { sanitizeBriefingRow } from "./cockpitSanitize.js";
import type { BriefingRow, BriefingSection } from "./cockpitTypes.js";

function mkRow(sections: BriefingSection[]): BriefingRow {
  return {
    id: "b1",
    date: "2026-07-06",
    content: { date: "2026-07-06", generatedAt: 1, sections },
    raw: "raw",
    status: "ok",
    createdAt: Date.now(),
  };
}

describe("sanitizeBriefingRow — 批准/駁回後簡報自癒", () => {
  it("action 的 proposalIds 全部已處理 → 整個 item 移除", () => {
    const row = mkRow([
      {
        kind: "decisions",
        title: "待拍板",
        items: [
          { title: "建議批准", body: "3 條提案", action: { type: "approve", proposalIds: ["a", "b"] } },
          { title: "無 action 的照舊", body: "純資訊" },
        ],
      },
    ]);
    const out = sanitizeBriefingRow(row, new Set<string>()); // 沒有任何 pending
    expect(out.content!.sections[0].items).toHaveLength(1);
    expect(out.content!.sections[0].items[0].title).toBe("無 action 的照舊");
  });

  it("部分 proposalIds 仍 pending → 保留 item 並縮減 ids", () => {
    const row = mkRow([
      {
        kind: "decisions",
        title: "待拍板",
        items: [{ title: "建議批准", body: "b", action: { type: "approve", proposalIds: ["a", "b", "c"] } }],
      },
    ]);
    const out = sanitizeBriefingRow(row, new Set(["b"]));
    expect(out.content!.sections[0].items).toHaveLength(1);
    expect(out.content!.sections[0].items[0].action!.proposalIds).toEqual(["b"]);
  });

  it("section 內 items 清空 → 整個 section 移除", () => {
    const row = mkRow([
      {
        kind: "decisions",
        title: "待拍板",
        items: [{ title: "建議批准", body: "b", action: { type: "approve", proposalIds: ["a"] } }],
      },
      { kind: "status", title: "近況", items: [{ title: "t", body: "b" }] },
    ]);
    const out = sanitizeBriefingRow(row, new Set<string>());
    expect(out.content!.sections).toHaveLength(1);
    expect(out.content!.sections[0].kind).toBe("status");
  });

  it("全部仍 pending → 內容不變", () => {
    const row = mkRow([
      {
        kind: "decisions",
        title: "待拍板",
        items: [{ title: "建議批准", body: "b", action: { type: "approve", proposalIds: ["a", "b"] } }],
      },
    ]);
    const out = sanitizeBriefingRow(row, new Set(["a", "b"]));
    expect(out.content!.sections[0].items[0].action!.proposalIds).toEqual(["a", "b"]);
  });

  it("content 為 null（parse_failed）→ 原樣返回不炸", () => {
    const row: BriefingRow = { id: "x", date: "d", content: null, raw: "junk", status: "parse_failed", createdAt: 1 };
    expect(sanitizeBriefingRow(row, new Set())).toBe(row);
  });

  it("不改動原物件（immutable）", () => {
    const row = mkRow([
      {
        kind: "decisions",
        title: "待拍板",
        items: [{ title: "建議批准", body: "b", action: { type: "approve", proposalIds: ["a"] } }],
      },
    ]);
    sanitizeBriefingRow(row, new Set<string>());
    expect(row.content!.sections[0].items).toHaveLength(1); // 原本的沒被動到
  });
});
