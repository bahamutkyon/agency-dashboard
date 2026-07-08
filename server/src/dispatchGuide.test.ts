/**
 * dispatchGuide 守護測試 —— 文案瘦身後，必要段落必須仍存在。
 * dispatchGuide 是 routes/sessions.ts orchestrator route 內的本地模板字串（不 export），
 * 故直接讀原始碼斷言關鍵段落／限制常數，防止未來瘦身或重構誤刪。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "routes", "sessions.ts"), "utf8");

/** 抽出 dispatchGuide 模板字串內容（原始碼字面，含跳脫字元）。 */
function extractGuide(): string {
  const startMark = "const dispatchGuide = `";
  const start = src.indexOf(startMark);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n`;", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start + startMark.length, end);
}

describe("dispatchGuide 必要段落守護（瘦身不可損語意）", () => {
  const guide = extractGuide();

  it("結構化契約欄位定義仍在：context / deliverable / accept", () => {
    expect(guide).toContain("context:");
    expect(guide).toContain("deliverable:");
    expect(guide).toContain("accept:");
    expect(guide).toContain("欄位規則");
  });

  it("DISPATCH 標記格式仍在", () => {
    expect(guide).toContain("=== DISPATCH ===");
    expect(guide).toContain("=== END DISPATCH ===");
    expect(guide).toContain("agentId:");
    expect(guide).toContain("mode: consult | execute");
  });

  it("consult vs execute vs workflow 判準仍在", () => {
    expect(guide).toContain("consult");
    expect(guide).toContain("execute");
    expect(guide).toContain("workflow");
    expect(guide).toContain("判準速記");
    // execute 的完成自驗證據區塊是驗收依據，不可刪
    expect(guide).toContain("完成自驗");
  });

  it("驗收退回流程仍在（收貨要驗收、退回重做）", () => {
    expect(guide).toContain("收貨要驗收");
    expect(guide).toContain("退回重做");
    expect(guide).toContain("誠實反映品質");
  });

  it("FOLLOWUP 成效回訪段仍在（格式＋上限 90）", () => {
    expect(guide).toContain("FOLLOWUP:");
    expect(guide).toContain("成效回訪");
    expect(guide).toContain("上限 90");
  });

  it("至少保留一個帶完整契約的完整範例", () => {
    // 範例需同時展示 task/context/deliverable/accept 四欄
    const exampleIdx = guide.indexOf("範例");
    expect(exampleIdx).toBeGreaterThan(-1);
    const example = guide.slice(exampleIdx);
    expect(example).toContain("task:");
    expect(example).toContain("context:");
    expect(example).toContain("deliverable:");
    expect(example).toContain("accept:");
  });

  it("workflow 段仍有最小 JSON 範例（含 steps 與 agentId）", () => {
    // 原始碼字面中反引號以 \` 跳脫，先還原再斷言 fence
    const unescaped = guide.replace(/\\`/g, "`");
    expect(unescaped).toContain("```workflow");
    expect(guide).toMatch(/"steps"/);
    expect(guide).toMatch(/"agentId"/);
  });

  it("瘦身守護：guide 長度不得再膨脹回 3,500 字以上", () => {
    // 瘦身後 ~2,900 字（原 ~4,100）。此上限防止未來慢慢長回去。
    expect(guide.length).toBeLessThan(3500);
  });
});

describe("GOAL_UPDATE 提示在 goalsBlock（動態注入）而非 guide", () => {
  it("goalsBlock 組裝碼仍含 GOAL_UPDATE 標記說明", () => {
    // GOAL_UPDATE 在 goalsBlock（有 active 目標才注入），確認瘦身沒誤刪。
    expect(src).toContain("GOAL_UPDATE:");
    expect(src).toContain("goalsBlock");
  });
});

describe("B4：PM 對話膨脹裁剪限制", () => {
  /** 只看 executeDispatch 函式本體——/batch/merge 的 25000 是另一功能，不在裁剪範圍。 */
  function extractExecuteDispatch(): string {
    const start = src.indexOf("export async function executeDispatch");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('sessionsRouter.post("/orchestrator/:sessionId/dispatch"', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }
  const fn = extractExecuteDispatch();

  it("consult feedback 總上限 10,000（原 25,000）", () => {
    expect(fn).toContain("labelled.slice(0, 10000)");
    expect(fn).not.toContain("labelled.slice(0, 25000)");
  });

  it("consult 每位 agent 回覆先各自截 3,000 字＋導流提示", () => {
    expect(fn).toContain("raw.length > 3000");
    expect(fn).toContain("raw.slice(0, 3000)");
  });

  it("EXEC_REPORT 改用 trimReportKeepSelfCheck（保留【完成自驗】，預設上限 6,000）", () => {
    // R4：不再裸 slice，改抽 helper——長文保留頭部＋尾端【完成自驗】證據段。
    expect(fn).toContain("trimReportKeepSelfCheck(d.output)");
    expect(fn).not.toContain("d.output.slice(0, 12000)");
    // 預設上限 6000 定義在 helper 簽名。
    expect(src).toContain("trimReportKeepSelfCheck(text: string, limit = 6000)");
  });

  it("截斷處導流到子對話的提示存在", () => {
    expect(fn).toContain("完整回覆見該同事的子對話");
  });
});
