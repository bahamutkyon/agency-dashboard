import { Router } from "express";
import { usageTracker } from "../usageTracker.js";
import { listInstalledMCPServers, BASELINE_MCPS } from "../mcpDetector.js";
import { buildCapabilitiesSummary } from "../capabilitiesDetector.js";
import { securityStats } from "../agentManager.js";
import { publicStatus as remotePublicStatus } from "../remoteAccess.js";
import { routePrompt } from "../smartRouter.js";
import { isCodexAvailable } from "../codexProcess.js";
import { isGeminiAvailable } from "../geminiProcess.js";
import { gateMode, listGuardDecisions } from "../guard.js";
import { backgroundLimiterStats } from "../backgroundLimiter.js";
import { isNotifierConfigured, getNotifierLastResult, notify, discoverChatId, getNotifierStatus, writeNotifierConfig } from "../notifier.js";
import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export function buildMiscRouter(remoteCfg: ReturnType<typeof import("../remoteAccess.js").loadRemoteConfig>) {
  const router = Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get("/usage", (_req, res) => res.json(usageTracker.summary()));

  // 背景限流觀測端點 — 回傳 backgroundLimiter 的即時狀態（running/queued/backoffUntil/limit）。
  // 前端 DelegationsPanel 定期輪詢此端點顯示「背景槽 N/M 使用中 · 排隊 K」等資訊。
  router.get("/system/limiter", (_req, res) => res.json(backgroundLimiterStats()));

  // Telegram 推播狀態 — 擴充回傳：source/botTokenMasked/chatId/envLocked（絕不回完整 token）。
  router.get("/system/notifier", (_req, res) => {
    res.json(getNotifierStatus());
  });

  // 儲存/更新 Telegram 設定到 server/data/notifier.json（env 設定時回 409，格式錯回 400）。
  router.post("/system/notifier/config", (req, res) => {
    const status = getNotifierStatus();
    if (status.envLocked) {
      return res.status(409).json({ error: "環境變數已設定，檔案設定不會生效" });
    }

    const { botToken, chatId } = req.body || {};

    // 格式粗驗（只驗有值且非空字串的 token，空字串=清除不驗）
    if (botToken !== undefined && botToken !== "" && !/^\d+:[\w-]+$/.test(botToken)) {
      return res.status(400).json({ error: "botToken 格式不正確（應為 123456789:ABCdef-xyz 的形式，去 @BotFather /newbot 取得）" });
    }

    const result = writeNotifierConfig({
      ...(botToken !== undefined ? { botToken } : {}),
      ...(chatId !== undefined ? { chatId } : {}),
    });
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    res.json(result.status);
  });

  // 測試推播 — 設定完（data/notifier.json 或 env）後打這個驗證通不通。
  router.post("/system/notifier/test", async (_req, res) => {
    if (!isNotifierConfigured()) {
      return res.status(400).json({ error: "未設定推播：請在 server/data/notifier.json 填 botToken+chatId，或設 TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 環境變數" });
    }
    const ok = await notify({ kind: "測試", title: "Dashboard 推播測試", body: "看到這則訊息代表設定成功" });
    res.json({ ok });
  });

  // 自動抓 chat id — 已填 botToken、且已在 Telegram 跟 bot 說過話 → 抓最新 chat.id 寫回設定檔。
  // env 已設定時比照 /config 擋下（409）：寫回檔案的 chatId 不會生效，避免使用者誤以為設好了。
  router.post("/system/notifier/discover-chat", async (_req, res) => {
    if (getNotifierStatus().envLocked) {
      return res.status(409).json({ error: "環境變數已設定，檔案設定不會生效——請直接改 TELEGRAM_CHAT_ID 環境變數" });
    }
    const r = await discoverChatId();
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  });

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
  // whether shellward (or any baseline MCP) is configured + injection stats
  // + gate mode summary (shadow/enforce/off, checker availability, wouldBlock count).
  router.get("/security/status", (_req, res) => {
    const installed = listInstalledMCPServers();
    const installedNames = new Set(installed.map((s) => s.name));
    const baselineCheck = BASELINE_MCPS.map((name) => ({
      name,
      configured: installedNames.has(name),
    }));
    const allConfigured = baselineCheck.every((b) => b.configured);

    // Gate summary: derive checkerAvailable from recent decision verdicts.
    // - null  = no verdict data yet (e.g. server just started / gate=off)
    // - true  = all recent verdicts show available=true
    // - false = at least one recent verdict shows available=false
    const recent = listGuardDecisions(50);
    const withVerdict = recent.filter((d) => d.verdict !== null);
    let checkerAvailable: boolean | null = null;
    if (withVerdict.length > 0) {
      checkerAvailable = withVerdict.every((d) => d.verdict!.available !== false);
    }
    const recentWouldBlock = recent.filter((d) => d.wouldBlock).length;

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
      gate: {
        mode: gateMode(),
        checkerAvailable,
        recentDecisions: recent.length,
        recentWouldBlock,
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
