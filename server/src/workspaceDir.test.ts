import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { resolveWorkspaceDir, ensureWorkspaceDir, validateWorkingDir } from "./workspaceDir.js";

describe("workspaceDir", () => {
  it("無 workingDir → 預設沙箱 data/workspaces/<id>", () => {
    expect(resolveWorkspaceDir({ id: "ws1" })).toBe(path.join(process.cwd(), "data", "workspaces", "ws1"));
  });
  it("有 workingDir → 該絕對路徑", () => {
    const custom = path.join(os.tmpdir(), "wsX");
    expect(resolveWorkspaceDir({ id: "ws1", workingDir: custom })).toBe(path.resolve(custom));
  });
  it("ensureWorkspaceDir 會建立目錄", () => {
    const custom = path.join(os.tmpdir(), "ws_ensure_" + Date.now());
    const dir = ensureWorkspaceDir({ id: "ws1", workingDir: custom });
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("validateWorkingDir：server 目錄內 → 回錯誤", () => {
    expect(validateWorkingDir(path.join(process.cwd(), "src"))).toBeTruthy();
  });
  it("validateWorkingDir：server 目錄本身 → 回錯誤", () => {
    expect(validateWorkingDir(process.cwd())).toBeTruthy();
  });
  it("validateWorkingDir：repo 根 → 回錯誤", () => {
    expect(validateWorkingDir(path.resolve(process.cwd(), ".."))).toBeTruthy();
  });
  it("validateWorkingDir：data/workspaces 子目錄 → OK(null)", () => {
    expect(validateWorkingDir(path.join(process.cwd(), "data", "workspaces", "ws1"))).toBeNull();
  });
  it("validateWorkingDir：外部 tmp 路徑 → OK(null)", () => {
    expect(validateWorkingDir(path.join(os.tmpdir(), "proj"))).toBeNull();
  });
  // 安全關鍵：沙箱內放 symlink/junction 指向 dashboard，字面在沙箱內但 realpath 逃逸 → 必須被擋
  it("validateWorkingDir：沙箱內 junction 指向 server → realpath 防逃逸擋下", () => {
    const linkDir = path.join(process.cwd(), "data", "workspaces", "__symlink_escape_test__");
    const target = path.join(process.cwd(), "src");
    fs.rmSync(linkDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(linkDir), { recursive: true });
    try {
      fs.symlinkSync(target, linkDir, "junction"); // junction 在 Windows 免管理員權限
    } catch {
      return; // 環境不允許建 junction → 跳過（不誤判失敗）
    }
    try {
      expect(validateWorkingDir(linkDir)).toBeTruthy(); // 字面在沙箱內，realpath 指向 server/src → 應擋
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
