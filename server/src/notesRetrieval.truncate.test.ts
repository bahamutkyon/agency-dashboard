/**
 * formatNotesAsContext — per-note 截斷（1500 字）+ 總量上限（4000 字）
 *
 * 驗證：
 * 1. 短於 1500 字的筆記不被截斷
 * 2. 超過 1500 字的筆記截斷並附「…（已截斷，完整內容在研究成果庫）」
 * 3. 多筆筆記總量超過 4000 字時，超出部分的筆記被丟掉（整塊不加入）
 * 4. 空筆記陣列回空字串（既有行為不變）
 */
import { describe, it, expect } from "vitest";
import { formatNotesAsContext, buildNotesContext } from "./notesRetrieval.js";
import type { Note } from "./store.js";

function makeNote(id: string, body: string, title = `Note ${id}`): Note {
  return {
    id,
    workspaceId: "default",
    title,
    body,
    pinned: false,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("formatNotesAsContext 截斷規則", () => {
  it("空陣列回空字串", () => {
    expect(formatNotesAsContext([])).toBe("");
  });

  it("筆記 body 短於 1500 字 → 不截斷", () => {
    const n = makeNote("n1", "短內容");
    const out = formatNotesAsContext([n]);
    expect(out).toContain("短內容");
    expect(out).not.toContain("已截斷");
  });

  it("筆記 body 超過 1500 字 → 截斷並附截斷標記", () => {
    const longBody = "A".repeat(2000);
    const n = makeNote("n2", longBody);
    const out = formatNotesAsContext([n]);
    // 截斷標記存在
    expect(out).toContain("…（已截斷，完整內容在研究成果庫）");
    // 不包含完整 2000 字
    expect(out).not.toContain("A".repeat(1501));
    // 應含前 1500 字
    expect(out).toContain("A".repeat(1500));
  });

  it("多筆筆記總量超過 4000 字 → 超出部分被丟掉（不截斷單筆塞進去）", () => {
    // 每筆各約 1500 字 → 前兩筆加 header/footer 會接近 4000，第三筆被丟掉
    const body1 = "B".repeat(1500);
    const body2 = "C".repeat(1500);
    const body3 = "D".repeat(1500);
    const notes = [
      makeNote("a1", body1, "Note A"),
      makeNote("a2", body2, "Note B"),
      makeNote("a3", body3, "Note C"),
    ];
    const out = formatNotesAsContext(notes);
    expect(out).toContain("B".repeat(100)); // 第一筆存在
    // 第三筆應被丟掉
    expect(out).not.toContain("Note C");
  });

  it("格式仍是 <context source=...> 包裹", () => {
    const n = makeNote("fmt", "內容", "測試筆記");
    const out = formatNotesAsContext([n]);
    expect(out).toMatch(/^<context source="筆記:測試筆記">/);
    expect(out).toContain("</context>");
  });
});

describe("buildNotesContext 回報實際納入清單", () => {
  it("全部納入時 included 等於輸入", () => {
    const notes = [makeNote("a", "短一", "A"), makeNote("b", "短二", "B")];
    const { included } = buildNotesContext(notes);
    expect(included.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("超過總量上限被丟掉的 note 不在 included（只標記真的注入的）", () => {
    const notes = [
      makeNote("a1", "B".repeat(1500), "Note A"),
      makeNote("a2", "C".repeat(1500), "Note B"),
      makeNote("a3", "D".repeat(1500), "Note C"),
    ];
    const { text, included } = buildNotesContext(notes);
    // 第三筆被丟掉 → 不在 included，也不在 text
    expect(included.map((n) => n.id)).not.toContain("a3");
    expect(text).not.toContain("Note C");
    // 前兩筆納入
    expect(included.map((n) => n.id)).toContain("a1");
  });

  it("空陣列回空字串與空清單", () => {
    const { text, included } = buildNotesContext([]);
    expect(text).toBe("");
    expect(included).toEqual([]);
  });
});
