import { Router } from "express";
import { usageTracker } from "../usageTracker.js";
import { listInstalledMCPServers, BASELINE_MCPS } from "../mcpDetector.js";
import { buildCapabilitiesSummary } from "../capabilitiesDetector.js";
import { securityStats } from "../agentManager.js";
import { publicStatus as remotePublicStatus } from "../remoteAccess.js";
import { routePrompt } from "../smartRouter.js";
import { isCodexAvailable } from "../codexProcess.js";
import { isGeminiAvailable } from "../geminiProcess.js";
import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export function buildMiscRouter(remoteCfg: ReturnType<typeof import("../remoteAccess.js").loadRemoteConfig>) {
  const router = Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get("/usage", (_req, res) => res.json(usageTracker.summary()));

  // File upload — drag-and-drop from chat. Saves to server/data/uploads/ and
  // returns the absolute path so the client can mention it in the next prompt
  // (claude CLI can read paths via its Read tool / image support).
  router.post("/upload", (req, res) => {
    const { name, content, encoding } = req.body || {};
    if (!name || !content) return res.status(400).json({ error: "name and content required" });
    const safe = String(name).replace(/[^\w.一-鿿-]/g, "_").slice(0, 100);
    const filename = `${Date.now().toString(36)}_${safe}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    try {
      if (encoding === "base64") {
        fs.writeFileSync(filepath, Buffer.from(String(content), "base64"));
      } else {
        fs.writeFileSync(filepath, String(content), "utf8");
      }
      const stats = fs.statSync(filepath);
      res.json({ path: filepath, name, size: stats.size });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Security status — for the top-right protection indicator. Returns
  // whether shellward (or any baseline MCP) is configured + injection stats.
  router.get("/security/status", (_req, res) => {
    const installed = listInstalledMCPServers();
    const installedNames = new Set(installed.map((s) => s.name));
    const baselineCheck = BASELINE_MCPS.map((name) => ({
      name,
      configured: installedNames.has(name),
    }));
    const allConfigured = baselineCheck.every((b) => b.configured);
    res.json({
      healthy: allConfigured && BASELINE_MCPS.length > 0,
      baseline: baselineCheck,
      stats: {
        sessionsWithMcp: securityStats.sessionsWithMcp,
        sessionsWithoutMcp: securityStats.sessionsWithoutMcp,
        lastInjectionAt: securityStats.lastInjectionAt,
        lastMcpNames: securityStats.lastMcpNames,
        uptimeMs: Date.now() - securityStats.startedAt,
      },
    });
  });

  // Remote access status — for the 📱 indicator. Sanitised: never returns
  // the actual token, IPs, or hostname.
  router.get("/remote-access/status", (_req, res) => {
    res.json(remotePublicStatus(remoteCfg));
  });

  // Capabilities — full inventory of skills + MCPs + agents + CLI tools
  // vs the manifest. Powers the CapabilitiesBadge UI and is the same
  // source `npm run doctor` reads from.
  router.get("/capabilities", (_req, res) => {
    try {
      res.json(buildCapabilitiesSummary());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // MCP — list available servers from user's ~/.claude.json
  router.get("/mcp/servers", (_req, res) => {
    res.json(listInstalledMCPServers());
  });

  // Provider availability check
  router.get("/providers", (_req, res) => {
    res.json({
      available: {
        claude: true,
        codex: isCodexAvailable(),
        gemini: isGeminiAvailable(),
      },
    });
  });

  // Smart router: classify a prompt and recommend a provider.
  router.post("/route", async (req, res) => {
    const { prompt, defaultProvider } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    try {
      const decision = await routePrompt(prompt, defaultProvider || "claude");
      res.json(decision);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
