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
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.warn("[mcp] failed to read ~/.claude.json:", e);
    return [];
  }
}

/**
 * Build an --mcp-config JSON string for the subset of servers a workspace
 * has enabled. Returns null if no servers selected (so caller can omit flag).
 */
export function buildMCPConfigForWorkspace(enabledNames: string[]): string | null {
  if (!enabledNames || enabledNames.length === 0) return null;
  if (!fs.existsSync(USER_CONFIG)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(USER_CONFIG, "utf8"));
    const allServers = raw.mcpServers || {};
    const subset: Record<string, any> = {};
    for (const n of enabledNames) {
      if (allServers[n]) subset[n] = allServers[n];
    }
    if (Object.keys(subset).length === 0) return null;
    return JSON.stringify({ mcpServers: subset });
  } catch {
    return null;
  }
}
