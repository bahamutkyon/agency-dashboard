/**
 * routes/guard.ts — /api/guard 路由
 *
 * POST /check  — shellward hook 呼叫端點（需 x-guard-token header）
 * GET  /decisions — 最近 100 筆守衛決策（debug 用）
 *
 * 安全原則：
 * - token 不符 → 403（硬擋）
 * - body 壞掉/缺欄位 → fail-closed（enforce→deny；shadow→allow）
 * - 絕不回 500（所有例外路徑都有覆蓋）
 */
import { Router } from "express";
import { GUARD_TOKEN, evaluateGuard, listGuardDecisions, gateMode } from "../guard.js";

export const guardRouter = Router();

/**
 * POST /check
 * 驗 x-guard-token；body: { tool_name, tool_input?, sessionId? }
 * 回: { decision: "allow"|"deny", reason? }
 */
guardRouter.post("/check", async (req, res) => {
  // ── Token 驗證 ──────────────────────────────────────────────────────────
  if (req.headers["x-guard-token"] !== GUARD_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const body = req.body as Record<string, unknown> | null | undefined;

  // ── Body 驗證（fail-closed） ─────────────────────────────────────────────
  if (!body || typeof body !== "object" || typeof body.tool_name !== "string") {
    // 壞 body：不呼叫 shellward，依模式 fail-closed
    const mode = gateMode();
    if (mode === "enforce") {
      res.json({ decision: "deny", reason: "invalid request body" });
    } else {
      // shadow / off → allow（寧可放行也不 500）
      res.json({ decision: "allow" });
    }
    return;
  }

  // ── 正常流程 ────────────────────────────────────────────────────────────
  try {
    const result = await evaluateGuard({
      tool_name: body.tool_name as string,
      tool_input: body.tool_input as (Record<string, unknown> & { command?: string }) | undefined,
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    });
    res.json(result);
  } catch {
    // evaluateGuard 設計為永不 throw，但保險起見：絕不 500
    const mode = gateMode();
    if (mode === "enforce") {
      res.json({ decision: "deny", reason: "internal error" });
    } else {
      res.json({ decision: "allow" });
    }
  }
});

/**
 * GET /decisions
 * 回傳最近 100 筆守衛決策（debug / 管理介面用）
 */
guardRouter.get("/decisions", (_req, res) => {
  res.json(listGuardDecisions(100));
});
