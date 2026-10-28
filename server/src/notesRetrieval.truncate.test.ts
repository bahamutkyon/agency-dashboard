/**
 * formatNotesAsContext — per-note 截斷（NOTE_BODY_LIMIT）+ 總量上限（CONTEXT_TOTAL_LIMIT）
 *
 * 驗證：
 * 1. 短於 NOTE_BODY_LIMIT 的筆記不被截斷
 * 2. 超過 NOTE_BODY_LIMIT 的筆記截斷並附「…（已截斷，完整內容在研究成果庫）」
 * 3. 多筆筆記總量超過 CONTEXT_TOTAL_LIMIT 時，超出部分的筆記被丟掉（整塊不加入）
 * 4. 空筆記陣列回空字串（既有行為不變）
 * 以常數表達而非寫死數字：額度依模型世代調整時，測試守的是「規則」不是「某個數字」。
 */
import { describe, it, expect } from "vitest";
import { formatNotesAsContext, buildNotesContext, NOTE_BODY_LIMIT, CONTEXT_TOTAL_LIMIT } from "./notesRetrieval.js";
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

/** 讓「單篇滿額」的筆記剛好塞不下第 N 篇：每篇 NOTE_BODY_LIMIT 字。 */
const perNoteFull = (ch: string) => ch.repeat(NOTE_BODY_LIMIT);
/** 需要幾篇滿額筆記才會超過總量上限。 */
const notesToOverflow = Math.floor(CONTEXT_TOTAL_LIMIT / NOTE_BODY_LIMIT) + 1;

describe("額度設定合理", () => {
  it("總量上限至少容得下兩篇滿額筆記", () => {
    expect(CONTEXT_TOTAL_LIMIT).toBeGreaterThanOrEqual(NOTE_BODY_LIMIT * 2);
  });
});

describe("formatNotesAsContext 截斷規則", () => {
  it("空陣列回空字串", () => {
    expect(formatNotesAsContext([])).toBe("");
  });

  it("筆記 body 短於上限 → 不截斷", () => {
    const n = makeNote("n1", "短內容");
    const out = formatNotesAsContext([n]);
    expect(out).toContain("短內容");
    expect(out).not.toContain("已截斷");
  });

  it("筆記 body 超過上限 → 截斷並附截斷標記", () => {
    const longBody = "A".repeat(NOTE_BODY_LIMIT + 500);
    const n = makeNote("n2", longBody);
    const out = formatNotesAsContext([n]);
    // 截斷標記存在
    expect(out).toContain("…（已截斷，完整內容在研究成果庫）");
    // 不包含超過上限的部分
    expect(out).not.toContain("A".repeat(NOTE_BODY_LIMIT + 1));
    // 應含前 NOTE_BODY_LIMIT 字
    expect(out).toContain("A".repeat(NOTE_BODY_LIMIT));
  });

  it("多筆筆記總量超過上限 → 超出部分被丟掉（不截斷單筆塞進去）", () => {
    const letters = "BCDEFGHIJKLMNOPQ".split("");
    const notes = Array.from({ length: notesToOverflow }, (_, i) =>
      makeNote(`a${i}`, perNoteFull(letters[i]), `Note ${letters[i]}`));
    const out = formatNotesAsContext(notes);
    expect(out).toContain("B".repeat(100)); // 第一筆存在
    // 最後一筆應被丟掉
    expect(out).not.toContain(`Note ${letters[notesToOverflow - 1]}`);
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
    const notes = Array.from({ length: notesToOverflow }, (_, i) =>
      makeNote(`a${i}`, perNoteFull(String.fromCharCode(66 + i)), `Note ${i}`));
    const lastId = `a${notesToOverflow - 1}`;
    const { text, included } = buildNotesContext(notes);
    // 最後一筆被丟掉 → 不在 included，也不在 text
    expect(included.map((n) => n.id)).not.toContain(lastId);
    expect(text).not.toContain(`Note ${notesToOverflow - 1}`);
    // 第一筆納入
    expect(included.map((n) => n.id)).toContain("a0");
  });

  it("空陣列回空字串與空清單", () => {
    const { text, included } = buildNotesContext([]);
    expect(text).toBe("");
    expect(included).toEqual([]);
  });
});
