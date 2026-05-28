/**
 * 工作區專屬 Chrome 啟動器。
 *
 * 每個工作區可綁一個 CDP port，這裡負責用「該工作區專屬的 profile 目錄」
 * 開一個 Chrome（headed、持久 profile），playwright MCP 之後用 --cdp-endpoint
 * 連上它。不同工作區 = 不同 port + 不同 profile = 各自獨立登入、互不干擾。
 *
 * 安全：profile 目錄獨立於使用者日常 Chrome，agent 只碰得到你在「這個」
 * 工作區 Chrome 裡登入的帳號。請只登賣場/社群帳號，勿登 Gmail/網銀。
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
];

function findChrome(): string | null {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  try {
    const cmd = process.platform === "win32" ? "where chrome" : "which google-chrome";
    const first = execSync(cmd, { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (first && fs.existsSync(first)) return first;
  } catch { /* ignore */ }
  return null;
}

/** 探測該 port 上是否有 Chrome 在跑；有的話回傳它的 Browser 版本字串，否則 null。 */
async function cdpVersion(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    return j?.Browser || "unknown";
  } catch {
    return null;
  }
}

async function isCdpAlive(port: number): Promise<boolean> {
  return (await cdpVersion(port)) !== null;
}

/**
 * 我們在「這個 server 程序生命週期內」親手開的 Chrome，依 port 記著 handle，
 * 之後可以乾淨地關掉。server 重啟（tsx watch）會丟失這個 Map —— 那種情況
 * stopWorkspaceChrome 會退而求其次用「依 port 找 PID」來關。
 */
const launched = new Map<number, ChildProcess>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 跨工作區檢查 CDP port 唯一性。回傳「另一個」已占用同 port 的工作區，否則 null。
 * 純函式，方便測試。
 */
export function findPortConflict(
  workspaces: { id: string; name: string; chromeCdpPort?: number }[],
  port: number | undefined,
  selfId: string,
): { id: string; name: string } | null {
  if (!port) return null;
  for (const w of workspaces) {
    if (w.id !== selfId && w.chromeCdpPort === port) return { id: w.id, name: w.name };
  }
  return null;
}

export interface LaunchResult {
  ok: boolean;
  alreadyRunning?: boolean;
  port: number;
  profileDir?: string;
  error?: string;
}

export async function launchWorkspaceChrome(workspaceId: string, port: number): Promise<LaunchResult> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return { ok: false, port, error: "port 不合法（需 1024-65535）" };
  }
  // 已經開著就不重開，直接沿用（避免每次點按鈕又跳一個視窗）
  if (await isCdpAlive(port)) return { ok: true, alreadyRunning: true, port };

  const chrome = findChrome();
  if (!chrome) return { ok: false, port, error: "找不到 chrome.exe，請確認已安裝 Google Chrome" };

  const profileDir = path.join(os.homedir(), "AppData", "Local", "agent-chrome-profiles", workspaceId);
  fs.mkdirSync(profileDir, { recursive: true });

  const child = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--start-maximized",
    "--window-size=1920,1080",
    "--no-first-run",
    "--no-default-browser-check",
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  launched.set(port, child);
  child.on("exit", () => { if (launched.get(port) === child) launched.delete(port); });

  // #1 修正：不要固定等 1800ms 就回報成功（冷啟動/機器忙時可能還沒綁上 port，
  // 卻回 ok 讓使用者以為成功、實際 playwright 連不上）。改成輪詢「真的連得上」
  // 才算成功，最多等 ~8 秒；超時就誠實回失敗 + 可行動的提示。
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(400);
    if (await isCdpAlive(port)) return { ok: true, port, profileDir, alreadyRunning: false };
  }
  return {
    ok: false,
    port,
    profileDir,
    error: "Chrome 已啟動但 8 秒內沒綁上 CDP port —— 可能開太慢、port 被佔用，或被防火牆擋。稍等再按一次，或換個 port。",
  };
}

export interface StopResult {
  ok: boolean;
  port: number;
  killed: boolean;
  error?: string;
}

/**
 * 關閉某 port 上的專屬 Chrome。
 * 1) 優先關「我們親手開的」child（最乾淨）。
 * 2) server 重啟丟失 handle 時 → 退而求其次：先用 CDP 確認那 port 上「真的是
 *    Chrome」（避免誤殺剛好佔用該 port 的別的程序），再依 port 找 PID 殺掉。
 */
export async function stopWorkspaceChrome(port: number): Promise<StopResult> {
  const child = launched.get(port);
  if (child && child.pid && !child.killed) {
    try {
      killProcessTree(child.pid);
      launched.delete(port);
      return { ok: true, port, killed: true };
    } catch { /* 落到 by-port 路徑 */ }
  }

  const ver = await cdpVersion(port);
  if (!ver) return { ok: true, port, killed: false }; // 那 port 上根本沒東西，視為已關

  const pid = findPidByPort(port);
  if (!pid) return { ok: false, port, killed: false, error: "偵測到 CDP 但查不到 PID，無法自動關閉（請手動關該 Chrome 視窗）" };
  try {
    killProcessTree(pid);
    launched.delete(port);
    return { ok: true, port, killed: true };
  } catch (e: any) {
    return { ok: false, port, killed: false, error: e?.message || "關閉失敗" };
  }
}

function killProcessTree(pid: number) {
  if (process.platform === "win32") {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
  }
}

function findPidByPort(port: number): number | null {
  try {
    if (process.platform === "win32") {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        if (/LISTENING/i.test(line) && new RegExp(`[:.]${port}\\b`).test(line.split(/\s+/).filter(Boolean)[1] || "")) {
          const pid = Number(line.trim().split(/\s+/).pop());
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" });
      const pid = Number(out.split(/\r?\n/)[0]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch { /* ignore */ }
  return null;
}
