/**
 * Origin guard — anti drive-by (CSRF/RCE) protection that still allows the
 * user's real access paths: localhost, Tailscale, and private LAN.
 *
 * Threat model: a malicious web page open in the user's browser can issue
 * `fetch()` / websocket handshakes against http://127.0.0.1:5191. The browser
 * ALWAYS attaches an `Origin: https://evil.com` header on such cross-site
 * requests. Legitimate access (local browser tab, phone over Tailscale, LAN)
 * carries a localhost / Tailscale / private Origin — or, for native clients
 * (curl) and same-origin navigations, no Origin at all.
 *
 * So: allow no-Origin + localhost + Tailscale(100.64/10, *.ts.net) + RFC1918,
 * plus any explicit full origins in DASHBOARD_ALLOWED_ORIGINS. Block the rest.
 *
 * IP/CIDR matching is reused from remoteAccess.ts (single source of truth).
 */
import { matchesCidr, normalizeIp } from "./remoteAccess.js";

// Private + Tailscale CGNAT ranges (host must be a literal IP to match these).
const PRIVATE_CIDRS = [
  "10.0.0.0/8",
  "192.168.0.0/16",
  "172.16.0.0/12",
  "100.64.0.0/10", // Tailscale CGNAT
];

function envAllowList(): string[] {
  return (process.env.DASHBOARD_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Decide whether a request Origin is trusted.
 *
 * @param origin the raw value of the `Origin` request header (may be undefined)
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin → not a cross-site browser request. GET navigations, curl and
  // native clients send none; cross-site attack fetches ALWAYS send one.
  if (!origin) return true;

  // Explicit full-origin allowlist (compare before URL parsing so operators
  // can whitelist exact strings such as tunnels / custom domains).
  if (envAllowList().includes(origin)) return true;

  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false; // malformed / non-http scheme → untrusted
  }
  if (!host) return false;

  // URL() wraps IPv6 literals in brackets ("[::1]"); strip them.
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");

  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;

  // Tailscale MagicDNS names, e.g. my-pc.tailXXXX.ts.net
  if (h === "ts.net" || h.endsWith(".ts.net")) return true;

  // Private / CGNAT IP literals
  const ip = normalizeIp(h);
  for (const cidr of PRIVATE_CIDRS) {
    if (matchesCidr(ip, cidr)) return true;
  }

  return false;
}
