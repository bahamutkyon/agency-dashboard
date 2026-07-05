/**
 * guardToken.test.ts — loadOrCreateToken() 的 TDD 測試
 *
 * 驗證 token 跨重啟穩定、讀寫失敗 fail-safe 不 throw。
 * 透過 tokenPath 可注入臨時目錄，每個 test 隔離。
 */
import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadOrCreateToken } from "./guard.js";

// ── 測試用臨時目錄管理 ─────────────────────────────────────────────────────────

const tmpRoots: string[] = [];

function makeTmpTokenPath(): string {
  const dir = path.join(os.tmpdir(), `guard-tok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpRoots.push(dir);
  return path.join(dir, "token");
}

afterEach(() => {
  // 清除所有測試用暫存目錄
  for (const d of tmpRoots.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── 測試：第一次呼叫，檔案不存在 ─────────────────────────────────────────────

describe("loadOrCreateToken() — 首次呼叫（檔案不存在）", () => {
  it("回傳非空字串（UUID 格式）", () => {
    const tokenPath = makeTmpTokenPath();
    const token = loadOrCreateToken(tokenPath);
    expect(token).toBeTruthy();
    // UUID v4 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("寫入 token 檔案到指定路徑", () => {
    const tokenPath = makeTmpTokenPath();
    const token = loadOrCreateToken(tokenPath);
    expect(fs.existsSync(tokenPath)).toBe(true);
    expect(fs.readFileSync(tokenPath, "utf8").trim()).toBe(token);
  });

  it("自動建立中間目錄", () => {
    const tokenPath = makeTmpTokenPath();
    const dir = path.dirname(tokenPath);
    expect(fs.existsSync(dir)).toBe(false); // 確認目錄原本不存在
    loadOrCreateToken(tokenPath);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

// ── 測試：第二次呼叫（模擬重啟），讀回相同 token ─────────────────────────────

describe("loadOrCreateToken() — 第二次呼叫（模擬重啟）", () => {
  it("讀回與第一次相同的 token", () => {
    const tokenPath = makeTmpTokenPath();
    const first = loadOrCreateToken(tokenPath);
    const second = loadOrCreateToken(tokenPath);
    expect(second).toBe(first);
  });

  it("token 穩定：多次呼叫結果一致", () => {
    const tokenPath = makeTmpTokenPath();
    const tokens = [
      loadOrCreateToken(tokenPath),
      loadOrCreateToken(tokenPath),
      loadOrCreateToken(tokenPath),
    ];
    expect(new Set(tokens).size).toBe(1);
  });
});

// ── 測試：token 檔損壞或空白 ─────────────────────────────────────────────────

describe("loadOrCreateToken() — 檔案損壞或空白", () => {
  it("空白檔案 → 重新生成，不 throw", () => {
    const tokenPath = makeTmpTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "   \n", "utf8"); // 空白內容
    let token: string | undefined;
    expect(() => { token = loadOrCreateToken(tokenPath); }).not.toThrow();
    expect(token).toBeTruthy();
  });

  it("空白檔案後重新生成，覆寫並可再次讀回", () => {
    const tokenPath = makeTmpTokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "", "utf8");
    const token = loadOrCreateToken(tokenPath);
    // 應覆寫並可再讀回
    const second = loadOrCreateToken(tokenPath);
    expect(second).toBe(token);
  });
});

// ── 測試：寫檔失敗（不可寫路徑）→ fail-safe，回記憶體 token，不 throw ─────────

describe("loadOrCreateToken() — 寫檔失敗", () => {
  it("父路徑為普通檔案（無法建目錄）→ 不 throw，回非空 token", () => {
    // 在 tokenPath 的父目錄位置建一個普通檔案，使 mkdirSync 必定失敗
    const dir = path.join(os.tmpdir(), `guard-tok-blocker-${Date.now()}`);
    fs.writeFileSync(dir, "I am a file, not a directory", "utf8");
    tmpRoots.push(dir); // 讓 afterEach 清理
    const impossibleTokenPath = path.join(dir, "subdir", "token");

    let result: string | undefined;
    expect(() => { result = loadOrCreateToken(impossibleTokenPath); }).not.toThrow();
    expect(result).toBeTruthy();
  });
});
