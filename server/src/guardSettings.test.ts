/**
 * guardSettings.ts 單元測試 — 驗證 claude hooks settings 檔的生成、寫檔、逃生開關。
 *
 * 核心不變式：
 *  - buildGuardSettings 產出的物件結構符合 claude `--settings` 的 PreToolUse hook 格式
 *  - command 字串跨平台安全（node/腳本/url/token 全用雙引號包）
 *  - initGuardSettings 寫出的檔案能 JSON.parse 回同結構
 *  - SHELLWARD_GATE=off → 逃生開關：不寫檔、getGuardSettingsPath() 回 null
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import { GUARD_TOKEN } from "./guard.js";
import {
  buildGuardSettings,
  initGuardSettings,
  getGuardSettingsPath,
  getHookScriptPath,
} from "./guardSettings.js";

const ORIG_GATE = process.env.SHELLWARD_GATE;

afterEach(() => {
  // 還原環境變數，避免污染其他測試
  if (ORIG_GATE === undefined) delete process.env.SHELLWARD_GATE;
  else process.env.SHELLWARD_GATE = ORIG_GATE;
});

describe("buildGuardSettings", () => {
  it("結構符合 claude PreToolUse hook 格式（matcher=Bash、type=command）", () => {
    const s = buildGuardSettings(5191) as any;
    expect(Array.isArray(s.hooks.PreToolUse)).toBe(true);
    const entry = s.hooks.PreToolUse[0];
    expect(entry.matcher).toBe("Bash");
    expect(Array.isArray(entry.hooks)).toBe(true);
    const hook = entry.hooks[0];
    expect(hook.type).toBe("command");
    expect(typeof hook.timeout).toBe("number");
    expect(typeof hook.command).toBe("string");
  });

  it("command 字串含 hook 腳本路徑 + guardUrl(含 port) + GUARD_TOKEN + node 執行檔", () => {
    const s = buildGuardSettings(5191) as any;
    const cmd: string = s.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toContain(getHookScriptPath());
    expect(cmd).toContain("http://127.0.0.1:5191/api/guard/check");
    expect(cmd).toContain(GUARD_TOKEN);
    expect(cmd).toContain(process.execPath);
  });

  it("command 四個片段各自用雙引號包（跨平台引號安全）", () => {
    const s = buildGuardSettings(5191) as any;
    const cmd: string = s.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toContain(`"${process.execPath}"`);
    expect(cmd).toContain(`"${getHookScriptPath()}"`);
    expect(cmd).toContain(`"http://127.0.0.1:5191/api/guard/check"`);
    expect(cmd).toContain(`"${GUARD_TOKEN}"`);
  });

  it("port 反映在 guardUrl", () => {
    const s = buildGuardSettings(9999) as any;
    const cmd: string = s.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toContain("http://127.0.0.1:9999/api/guard/check");
  });
});

describe("getHookScriptPath", () => {
  it("推算出的 hook 腳本絕對路徑實際存在（tsx 跑 src 下）", () => {
    const p = getHookScriptPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(p.endsWith("shellward-gate.mjs")).toBe(true);
  });
});

describe("initGuardSettings（非 off）", () => {
  it("寫出的檔案能 JSON.parse 回同結構；getGuardSettingsPath 回該路徑", () => {
    delete process.env.SHELLWARD_GATE; // 預設 shadow → 會寫檔
    initGuardSettings(5191);
    const p = getGuardSettingsPath();
    expect(p).not.toBeNull();
    expect(fs.existsSync(p!)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(p!, "utf8"));
    const expected = buildGuardSettings(5191);
    expect(parsed).toEqual(expected);
  });
});

describe("SHELLWARD_GATE=off 逃生開關", () => {
  it("off 時 initGuardSettings 不寫檔、getGuardSettingsPath 回 null", () => {
    process.env.SHELLWARD_GATE = "off";
    initGuardSettings(5191);
    expect(getGuardSettingsPath()).toBeNull();
  });
});
