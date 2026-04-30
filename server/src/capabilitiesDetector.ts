/**
 * Reads capabilities.manifest.json (project root) and compares against the
 * actual state on the user's machine. Powers `npm run doctor`,
 * `npm run setup:full`, and the CapabilitiesBadge UI.
 *
 * The manifest is the single source of truth for "what should a complete
 * dashboard machine have" — change it and doctor/setup/badge follow.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listInstalledMCPServers } from "./mcpDetector.js";
import { loadAgents } from "./agentLoader.js";

// Resolve manifest relative to this source file, not process.cwd() — the
// server runs with cwd=server/ but doctor.mjs runs with cwd=projectRoot/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "capabilities.manifest.json");
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

export interface CapabilityManifest {
  manifest_version: string;
  description: string;
  skills: {
    framework: string;
    source: string;
    target_dir: string;
    install: { method: string; note?: string };
    expected: { name: string; from: string; protected?: boolean; bundled?: string }[];
  };
  mcps: {
    name: string;
    tier: "baseline" | "recommended" | "optional";
    description: string;
    command?: string;
    command_hint?: string;
    install: { method: string; package?: string; python?: string; note?: string };
    env_required?: string[];
    env_recommended?: Record<string, string>;
    manual_setup_note?: string;
  }[];
  agents: {
    source: string;
    target_dir: string;
    expected_count: number;
    install: { method: string; repo: string; script: string; note?: string };
  };
  cli_tools: {
    name: string;
    tier: "required" | "optional";
    description: string;
    install: { method: string; package?: string; url?: string };
    verify: string;
  }[];
}

let cachedManifest: CapabilityManifest | null = null;

export function loadManifest(): CapabilityManifest {
  if (cachedManifest) return cachedManifest;
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`capabilities.manifest.json not found at ${MANIFEST_PATH}`);
  }
  cachedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  return cachedManifest!;
}

export interface SkillStatus {
  name: string;
  from: string;
  protected: boolean;
  installed: boolean;
}

export function detectSkills(): { expected: number; installed: number; items: SkillStatus[] } {
  const manifest = loadManifest();
  const installed = fs.existsSync(SKILLS_DIR)
    ? new Set(fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name))
    : new Set<string>();

  const items: SkillStatus[] = manifest.skills.expected.map((s) => ({
    name: s.name,
    from: s.from,
    protected: !!s.protected,
    installed: installed.has(s.name),
  }));
  const installedCount = items.filter((i) => i.installed).length;
  return { expected: items.length, installed: installedCount, items };
}

export interface MCPStatus {
  name: string;
  tier: "baseline" | "recommended" | "optional";
  description: string;
  installed: boolean;
  hasEnvKeys: boolean;
  manualSetupNote?: string;
  installCommand: string;
}

function buildInstallCommand(mcp: CapabilityManifest["mcps"][number]): string {
  const i = mcp.install;
  if (i.method === "npm-global") return `npm install -g ${i.package}`;
  if (i.method === "pip") {
    const pyCmd = process.platform === "win32" ? "py -3.11 -m pip" : "pip3";
    return `${pyCmd} install ${i.package}`;
  }
  return `(see docs for ${mcp.name})`;
}

export function detectMCPs(): { expected: number; installed: number; items: MCPStatus[] } {
  const manifest = loadManifest();
  const installedNames = new Set(listInstalledMCPServers().map((s) => s.name));

  const items: MCPStatus[] = manifest.mcps.map((m) => ({
    name: m.name,
    tier: m.tier,
    description: m.description,
    installed: installedNames.has(m.name),
    hasEnvKeys: (m.env_required?.length ?? 0) > 0,
    manualSetupNote: m.manual_setup_note,
    installCommand: buildInstallCommand(m),
  }));
  return { expected: items.length, installed: items.filter((i) => i.installed).length, items };
}

export function detectAgents(): { expected: number; installed: number; categoriesCount: number } {
  const manifest = loadManifest();
  try {
    const agents = loadAgents();
    const categories = new Set(agents.map((a) => a.category));
    return {
      expected: manifest.agents.expected_count,
      installed: agents.length,
      categoriesCount: categories.size,
    };
  } catch {
    return { expected: manifest.agents.expected_count, installed: 0, categoriesCount: 0 };
  }
}

export interface CLIStatus {
  name: string;
  tier: "required" | "optional";
  description: string;
  installed: boolean;
  installCommand: string;
}

export function detectCLITools(): CLIStatus[] {
  const manifest = loadManifest();
  return manifest.cli_tools.map((t) => {
    let installed = false;
    try {
      execSync(process.platform === "win32" ? `where ${t.name}` : `which ${t.name}`, {
        stdio: "ignore",
      });
      installed = true;
    } catch { /* not on PATH */ }
    let cmd: string;
    if (t.install.method === "npm-global") cmd = `npm install -g ${t.install.package}`;
    else if (t.install.method === "external") cmd = `see ${t.install.url}`;
    else cmd = "(see docs)";
    return {
      name: t.name,
      tier: t.tier,
      description: t.description,
      installed,
      installCommand: cmd,
    };
  });
}

export interface CapabilitiesSummary {
  manifest_version: string;
  skills: ReturnType<typeof detectSkills>;
  mcps: ReturnType<typeof detectMCPs>;
  agents: ReturnType<typeof detectAgents>;
  cli: CLIStatus[];
  health: {
    healthy: boolean;
    missing_count: number;
    missing_critical: number;  // baseline MCP / required CLI missing
  };
}

export function buildCapabilitiesSummary(): CapabilitiesSummary {
  const manifest = loadManifest();
  const skills = detectSkills();
  const mcps = detectMCPs();
  const agents = detectAgents();
  const cli = detectCLITools();

  const skillsMissing = skills.expected - skills.installed;
  const mcpsMissing = mcps.expected - mcps.installed;
  const agentsMissing = agents.expected - agents.installed > 5 ? 1 : 0;  // tolerate count drift
  const cliMissing = cli.filter((c) => !c.installed && c.tier === "optional").length;
  const cliRequiredMissing = cli.filter((c) => !c.installed && c.tier === "required").length;
  const baselineMissing = mcps.items.filter((m) => !m.installed && m.tier === "baseline").length;

  return {
    manifest_version: manifest.manifest_version,
    skills, mcps, agents, cli,
    health: {
      healthy: skillsMissing === 0 && mcpsMissing === 0 && agentsMissing === 0 && cliRequiredMissing === 0,
      missing_count: skillsMissing + mcpsMissing + agentsMissing + cliMissing + cliRequiredMissing,
      missing_critical: cliRequiredMissing + baselineMissing,
    },
  };
}
