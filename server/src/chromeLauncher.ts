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
import { spawn, execSync } from "node:child_process";
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

/** 用 CDP /json/version 探測該 port 是否已有 Chrome 在跑。 */
async function isCdpAlive(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
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

  // 給 Chrome 一點時間綁 port
  await new Promise((r) => setTimeout(r, 1800));
  const alive = await isCdpAlive(port);
  return { ok: true, port, profileDir, alreadyRunning: false, ...(alive ? {} : {}) };
}
