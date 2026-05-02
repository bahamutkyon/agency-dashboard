/**
 * Remote access controller — opt-in 0.0.0.0 binding + IP allowlist + token auth.
 *
 * Off by default. Activated when ENABLE_REMOTE_ACCESS=true in process env.
 *
 * Three independent layers, each can be turned on individually:
 *   1. Bind host           — 127.0.0.1 (default) vs 0.0.0.0 (remote on)
 *   2. IP allowlist        — only when remote on; defaults to RFC1918 + Tailscale
 *   3. Access token        — opt-in; required when set; useful for tunnels
 *
 * No personal IPs / hostnames in this file. Everything comes from env.
 */
import type { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Inline .env.local loader — no extra deps. Looks at project root
// (one level up from server/) for .env.local first, then .env.
function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip wrapping single/double quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

(function loadEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(here, "..", "..");
    loadEnvFile(path.join(projectRoot, ".env.local"));
    loadEnvFile(path.join(projectRoot, ".env"));
  } catch { /* fall through */ }
})();

export interface RemoteAccessConfig {
  enabled: boolean;
  bindHost: string;
  allowRanges: string[];
  hasToken: boolean;
}

const DEFAULT_RANGES = [
  "127.0.0.1",
  "::1",
  "192.168.0.0/16",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "100.64.0.0/10",  // Tailscale CGNAT
];

function parseRanges(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_RANGES;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadRemoteConfig(): RemoteAccessConfig {
  const enabled = (process.env.ENABLE_REMOTE_ACCESS || "").toLowerCase() === "true";
  return {
    enabled,
    bindHost: enabled ? "0.0.0.0" : "127.0.0.1",
    allowRanges: parseRanges(process.env.ALLOW_RANGES),
    hasToken: !!process.env.ACCESS_TOKEN,
  };
}

// ============== IP matching ==============

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function matchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) {
    // single IP
    return ip === cidr;
  }
  const [base, prefixStr] = cidr.split("/");
  const prefix = +prefixStr;
  const ipNum = ipv4ToInt(ip);
  const baseNum = ipv4ToInt(base);
  if (ipNum === null || baseNum === null) return false;
  if (prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return "";
  // Express may give "::ffff:192.168.1.5" for IPv4 over IPv6
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

export function isIpAllowed(ip: string, ranges: string[]): boolean {
  const normalized = normalizeIp(ip);
  // IPv6 loopback handled directly; other IPv6 we permit ::1 only by default
  if (normalized === "::1" || normalized === "127.0.0.1") return true;
  for (const r of ranges) {
    if (matchesCidr(normalized, r)) return true;
  }
  return false;
}

// ============== Middleware ==============

export function buildRemoteAccessMiddleware(cfg: RemoteAccessConfig) {
  const token = process.env.ACCESS_TOKEN;

  return (req: Request, res: Response, next: NextFunction) => {
    // When remote access is OFF the server is bound to 127.0.0.1, so no
    // remote IP can reach us anyway — middleware is a no-op for safety.
    if (!cfg.enabled) return next();

    // Allow OPTIONS preflight without auth (CORS)
    if (req.method === "OPTIONS") return next();

    const ip = normalizeIp(req.ip || (req.socket?.remoteAddress ?? ""));

    // 1. IP allowlist
    if (!isIpAllowed(ip, cfg.allowRanges)) {
      console.warn(`[remoteAccess] denied IP=${ip} path=${req.path}`);
      return res.status(403).json({ error: "IP not allowed", ip });
    }

    // 2. Access token (when configured)
    if (token) {
      // Accept token via:
      //   - Authorization: Bearer <token>
      //   - X-Access-Token header
      //   - ?token=... query param (for first-time browser bookmark)
      //   - Cookie: agency_token=...
      const fromAuth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const fromHeader = (req.headers["x-access-token"] as string) || "";
      const fromQuery = (req.query.token as string) || "";
      const fromCookie = (req.headers.cookie || "")
        .split(";").map((s) => s.trim())
        .find((c) => c.startsWith("agency_token="))?.slice("agency_token=".length) || "";

      const provided = fromAuth || fromHeader || fromQuery || fromCookie;

      if (!provided || provided !== token) {
        // Allow the status endpoint without auth so the badge can render
        // a "needs auth" hint even before login.
        if (req.path === "/api/remote-access/status") return next();
        console.warn(`[remoteAccess] bad token from ${ip} path=${req.path}`);
        return res.status(401).json({ error: "missing or invalid access token" });
      }

      // Re-issue cookie so subsequent reqs carry it without query param
      if (fromQuery && !fromCookie) {
        res.setHeader("Set-Cookie",
          `agency_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
      }
    }

    return next();
  };
}

/**
 * For the /api/remote-access/status endpoint — returns sanitised info
 * without leaking the actual token or per-request IPs.
 */
export function publicStatus(cfg: RemoteAccessConfig) {
  return {
    enabled: cfg.enabled,
    bindHost: cfg.bindHost,
    requiresToken: cfg.hasToken,
    allowedRangesCount: cfg.allowRanges.length,
    note: cfg.enabled
      ? "遠端存取已開啟。手機 / 平板 / 其他裝置可透過 LAN 或 Tailscale 存取。"
      : "遠端存取關閉。只有 localhost(127.0.0.1)能連線。",
  };
}
