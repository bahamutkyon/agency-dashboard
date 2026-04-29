/**
 * Reads the user's local Claude Code MCP configuration so the dashboard can:
 *   1. Show what MCP servers are available (read-only)
 *   2. Let each workspace opt-in to specific servers
 *   3. Pass the right --mcp-config to claude when starting a session
 *
 * Claude Code stores MCP config in ~/.claude.json (top-level `mcpServers`)
 * or per-project in the project's `.mcp.json`. We focus on the user-level
 * config since that's the most common case.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const USER_CONFIG = path.join(os.homedir(), ".claude.json");

export interface MCPServerInfo {
  name: string;
  type?: string;          // stdio / http / sse
  command?: string;       // for stdio servers
  url?: string;           // for http/sse servers
  hasAuth?: boolean;      // any env keys? hint that user might need to set creds
  baseline?: boolean;     // always-on — workspace toggle has no effect
}

export function listInstalledMCPServers(): MCPServerInfo[] {
  if (!fs.existsSync(USER_CONFIG)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"));
    const servers = raw.mcpServers || {};
    const out: MCPServerInfo[] = [];
    for (const [name, cfg] of Object.entries<any>(servers)) {
      const env = cfg?.env || {};
      out.push({
        name,
        type: cfg?.type || "stdio",
        command: cfg?.command,
        url: cfg?.url,
        hasAuth: Object.keys(env).length > 0,
        baseline: BASELINE_MCPS.includes(name),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.warn("[mcp] failed to read ~/.claude.json:", e);
    return [];
  }
}

/**
 * MCPs always loaded for every Claude session regardless of workspace settings.
 * shellward = baseline security middleware (prompt injection detection /
 * dangerous command blocking / data exfiltration prevention / PII guards).
 * Cannot be opted-out per-workspace — if user wants to disable globally they
 * need to remove the name here OR uninstall the MCP server entry from
 * ~/.claude.json. Forgetting to enable per-workspace == unprotected, so we
 * make it default-on instead.
 */
export const BASELINE_MCPS = ["shellward"];

export function isBaselineMcp(name: string): boolean {
  return BASELINE_MCPS.includes(name);
}

/**
 * Build an --mcp-config JSON string for a workspace. Always includes baseline
 * MCPs (shellward) plus any workspace-opted-in servers. Returns null if no
 * servers would end up in the config (so caller can omit the flag).
 */
export function buildMCPConfigForWorkspace(enabledNames: string[]): string | null {
  if (!fs.existsSync(USER_CONFIG)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"));
    const allServers = raw.mcpServers || {};
    const subset: Record<string, any> = {};

    // Baseline first — always-on regardless of workspace toggle state.
    for (const n of BASELINE_MCPS) {
      if (allServers[n]) subset[n] = allServers[n];
    }

    // Workspace opt-ins layered on top.
    for (const n of enabledNames || []) {
      if (allServers[n]) subset[n] = allServers[n];
    }

    if (Object.keys(subset).length === 0) return null;
    return JSON.stringify({ mcpServers: subset });
  } catch {
    return null;
  }
}
