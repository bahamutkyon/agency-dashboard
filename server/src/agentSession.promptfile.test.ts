/**
 * --append-system-prompt-file 暫存檔機制測試。
 *
 * 目的：規避 Windows 命令列 32767 字元上限，PM session 可注入 213 agent
 * 完整 catalog (~42KB) 而不撞 spawn ENAMETOOLONG。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PROMPT_TMP_DIR, cleanupOrphanPromptFiles } from "./agentSession.js";

function writeFakeOrphan(content: string): string {
  if (!fs.existsSync(PROMPT_TMP_DIR)) fs.mkdirSync(PROMPT_TMP_DIR, { recursive: true });
  const p = path.join(PROMPT_TMP_DIR, `test-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

afterEach(() => {
  // 清掉測試中可能留下的 orphan
  cleanupOrphanPromptFiles();
});

describe("PROMPT_TMP_DIR 與暫存檔生命週期", () => {
  it("PROMPT_TMP_DIR 路徑包含預期 dir 名", () => {
    expect(PROMPT_TMP_DIR).toContain("agency-dashboard-prompts");
  });

  it("可以寫入超過 40KB 的 prompt 內容到暫存檔", () => {
    // 模擬 PM 系統提示：213 agent catalog × 200 字描述 + 其他 blocks ≈ 50KB
    const huge = "A".repeat(60 * 1024); // 60KB
    const p = writeFakeOrphan(huge);
    try {
      expect(fs.existsSync(p)).toBe(true);
      const stat = fs.statSync(p);
      expect(stat.size).toBeGreaterThan(50_000);
      const read = fs.readFileSync(p, "utf8");
      expect(read).toBe(huge);
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });

  it("cleanupOrphanPromptFiles 移除目錄內所有檔", () => {
    const files: string[] = [];
    for (let i = 0; i < 3; i++) {
      files.push(writeFakeOrphan(`orphan content ${i}`));
    }
    expect(files.every((f) => fs.existsSync(f))).toBe(true);

    cleanupOrphanPromptFiles();

    expect(files.every((f) => !fs.existsSync(f))).toBe(true);
  });

  it("cleanupOrphanPromptFiles 在目錄不存在時不丟錯", () => {
    cleanupOrphanPromptFiles();
    if (fs.existsSync(PROMPT_TMP_DIR)) fs.rmdirSync(PROMPT_TMP_DIR);
    // 再呼叫一次：目錄不存在
    expect(() => cleanupOrphanPromptFiles()).not.toThrow();
  });

  it("中文 prompt 正確寫入並讀回（避免編碼問題）", () => {
    const cn = "# 你目前可動用的團隊（213 位）\n- [marketing] `marketing-content-creator` — 內容創作者: 擅長多平臺內容策劃與創作的內容專家";
    const p = writeFakeOrphan(cn);
    try {
      const read = fs.readFileSync(p, "utf8");
      expect(read).toBe(cn);
      expect(read).toContain("內容創作者");
    } finally {
      try { fs.unlinkSync(p); } catch {}
    }
  });
});
