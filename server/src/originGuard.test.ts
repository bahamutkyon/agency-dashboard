import { describe, it, expect, afterEach } from "vitest";
import { isOriginAllowed } from "./originGuard.js";

describe("isOriginAllowed", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_ALLOWED_ORIGINS;
  });

  // ---- allowed ----
  it("no origin (native/curl/same-origin nav) → allowed", () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed("")).toBe(true);
  });

  it("localhost → allowed", () => {
    expect(isOriginAllowed("http://localhost:5190")).toBe(true);
    expect(isOriginAllowed("http://localhost")).toBe(true);
  });

  it("127.0.0.1 → allowed", () => {
    expect(isOriginAllowed("http://127.0.0.1:5190")).toBe(true);
  });

  it("IPv6 loopback ::1 → allowed", () => {
    expect(isOriginAllowed("http://[::1]:5190")).toBe(true);
  });

  it("Tailscale CGNAT 100.64.0.0/10 → allowed", () => {
    expect(isOriginAllowed("http://100.64.1.2:5190")).toBe(true);
    expect(isOriginAllowed("http://100.115.92.7:5190")).toBe(true);
  });

  it("Tailscale MagicDNS *.ts.net → allowed", () => {
    expect(isOriginAllowed("http://my-pc.tail1234.ts.net:5190")).toBe(true);
    expect(isOriginAllowed("https://my-pc.tail1234.ts.net")).toBe(true);
  });

  it("private LAN ranges → allowed", () => {
    expect(isOriginAllowed("http://192.168.1.50:5190")).toBe(true);
    expect(isOriginAllowed("http://10.1.2.3:5190")).toBe(true);
    expect(isOriginAllowed("http://172.16.5.5:5190")).toBe(true);
    expect(isOriginAllowed("http://172.31.255.1:5190")).toBe(true);
  });

  it("env DASHBOARD_ALLOWED_ORIGINS full-origin allowlist → allowed", () => {
    process.env.DASHBOARD_ALLOWED_ORIGINS = "https://dash.example.com, https://other.test";
    expect(isOriginAllowed("https://dash.example.com")).toBe(true);
    expect(isOriginAllowed("https://other.test")).toBe(true);
  });

  // ---- blocked ----
  it("https://evil.com (drive-by attacker) → blocked", () => {
    expect(isOriginAllowed("https://evil.com")).toBe(false);
  });

  it("public IP 8.8.8.8 → blocked", () => {
    expect(isOriginAllowed("http://8.8.8.8")).toBe(false);
  });

  it("public host not in .ts.net → blocked", () => {
    expect(isOriginAllowed("https://notlocalhost.example.org")).toBe(false);
  });

  it("172.32.x (outside 172.16/12) → blocked", () => {
    expect(isOriginAllowed("http://172.32.0.1:5190")).toBe(false);
  });

  it("hostname spoof e.g. evil.com.ts.net.attacker.com → blocked", () => {
    expect(isOriginAllowed("https://ts.net.attacker.com")).toBe(false);
  });

  it("malformed origin → blocked", () => {
    expect(isOriginAllowed("not a url")).toBe(false);
    expect(isOriginAllowed("javascript:alert(1)")).toBe(false);
  });

  it("origin not in env allowlist → blocked", () => {
    process.env.DASHBOARD_ALLOWED_ORIGINS = "https://dash.example.com";
    expect(isOriginAllowed("https://evil.example.com")).toBe(false);
  });
});
