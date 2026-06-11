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
  // 驗證下沉 + failed closed：自訂路徑非法（指向 server 自身）時，resolveWorkspaceDir
  // 不應沿用危險路徑，而要退回預設沙箱，即使從未經過 PATCH 驗證。
  it("workingDir 非法（指向 server）→ 退回預設沙箱", () => {
    const evil = path.join(process.cwd(), "src");
    expect(resolveWorkspaceDir({ id: "ws1", workingDir: evil }))
      .toBe(path.join(process.cwd(), "data", "workspaces", "ws1"));
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
  // realAbs 主線：自訂路徑的祖先層層不存在時，逐層上溯到存在祖先做 realpath 再接回尾段，
  // 不應誤擋合法的外部深層路徑（此前無測試覆蓋這條主線）。
  it("validateWorkingDir：外部不存在的深層路徑 → OK(null)", () => {
    const deep = path.join(os.tmpdir(), "wd_deep_" + Date.now(), "a", "b", "c");
    expect(fs.existsSync(deep)).toBe(false);
    expect(validateWorkingDir(deep)).toBeNull();
  });
  // banned 的「先開沙箱、後關 data」順序依賴：data 下「非 workspaces」子目錄必須被擋，
  // 鎖住順序語義，避免日後重排 banned/沙箱例外時破功。
  it("validateWorkingDir：data 下非 workspaces 子目錄（如 data/logs）→ 回錯誤", () => {
    expect(validateWorkingDir(path.join(process.cwd(), "data", "logs"))).toBeTruthy();
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
      // 環境不允許建 junction → 跳過。明確 warn，避免在 CI 變成「0 斷言的假綠燈」。
      console.warn("[workspaceDir.test] 略過 symlink 逃逸測試：本環境無法建立 junction");
      return;
    }
    try {
      expect(validateWorkingDir(linkDir)).toBeTruthy(); // 字面在沙箱內，realpath 指向 server/src → 應擋
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
