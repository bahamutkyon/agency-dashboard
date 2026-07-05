/**
 * guardSettings.ts — 生成 claude `--settings` 用的 PreToolUse hook 設定檔
 *
 * 職責：
 * - 開機時（拿得到 port）產生一份 hooks settings JSON，寫到穩定暫存路徑
 * - spawn claude 子程序時用 `--settings <檔>` 注入，讓 Bash 工具在執行前
 *   先過 shellward-gate.mjs → POST /api/guard/check 檢查
 *
 * 逃生開關（SHELLWARD_GATE=off）：
 * - initGuardSettings 直接 return，不寫檔；getGuardSettingsPath() 回 null
 * - spawnClaudeChild 見 path=null → 不注入 --settings → 等同現況（完全停用）
 *
 * command 字串跨平台安全性：
 * - node 路徑用 process.execPath（絕對）、腳本用絕對路徑、guardUrl 走 127.0.0.1
 * - 四個片段全部用雙引號包起來，含空白的路徑也安全
 * - JSON.stringify 會處理 Windows 反斜線的跳脫，寫進檔案後 claude 讀回為原始值
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_TOKEN, gateMode } from "./guard.js";

// ── hook 腳本絕對路徑 ────────────────────────────────────────────────────────
//
// 本檔位於 server/src/guardSettings.ts（tsx 直接跑 src，無編譯輸出目錄）。
// hook 腳本位於 server/hooks/shellward-gate.mjs → 從 src/ 出發是 ../hooks/。
const _thisDir = path.dirname(fileURLToPath(import.meta.url));
const _hookScriptPath = path.resolve(_thisDir, "..", "hooks", "shellward-gate.mjs");

/** 回 hook 腳本（shellward-gate.mjs）的絕對路徑。 */
export function getHookScriptPath(): string {
  return _hookScriptPath;
}

// ── settings 物件組裝 ────────────────────────────────────────────────────────

/**
 * 組出 claude `--settings` 的 hooks 設定物件（不寫檔，供測試與 initGuardSettings 共用）。
 *
 * command 字串範例（Windows）：
 *   "C:\\...\\node.exe" "C:\\...\\shellward-gate.mjs" "http://127.0.0.1:5191/api/guard/check" "<token>"
 */
export function buildGuardSettings(port: number): object {
  const guardUrl = `http://127.0.0.1:${port}/api/guard/check`;
  const command = `"${process.execPath}" "${_hookScriptPath}" "${guardUrl}" "${GUARD_TOKEN}"`;
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              timeout: 10,
              command,
            },
          ],
        },
      ],
    },
  };
}

// ── 寫檔 / 路徑狀態 ──────────────────────────────────────────────────────────

/** 穩定暫存目錄（比照 agentSession 的 prompt 暫存檔放 os.tmpdir() 下）。 */
export const GUARD_SETTINGS_DIR = path.join(os.tmpdir(), "agency-dashboard-guard");

/** 已寫檔的 settings 路徑；未初始化或 off 模式 → null。 */
let _settingsPath: string | null = null;

/**
 * 開機初始化：產生 settings 檔並記下路徑。
 * - SHELLWARD_GATE=off → 逃生開關：不寫檔、path=null，spawn 時不注入 --settings。
 * - 其餘（shadow / enforce）→ 寫檔到穩定路徑，供 spawnClaudeChild 帶上。
 */
export function initGuardSettings(port: number): void {
  if (gateMode() === "off") {
    _settingsPath = null;
    return;
  }
  if (!fs.existsSync(GUARD_SETTINGS_DIR)) {
    fs.mkdirSync(GUARD_SETTINGS_DIR, { recursive: true });
  }
  const p = path.join(GUARD_SETTINGS_DIR, "settings.json");
  fs.writeFileSync(p, JSON.stringify(buildGuardSettings(port), null, 2), { encoding: "utf8" });
  _settingsPath = p;
  console.log(`[guardSettings] wrote PreToolUse hook settings → ${p}`);
  console.log(`[guardSettings] hook script → ${_hookScriptPath} (exists=${fs.existsSync(_hookScriptPath)})`);
}

/** 回已寫檔的 settings 路徑；未初始化或 off → null。 */
export function getGuardSettingsPath(): string | null {
  return _settingsPath;
}
