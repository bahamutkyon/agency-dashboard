import { Router } from "express";
import { listDelegationsWithProgress, getDelegation, finishDelegation } from "../store/delegations.js";
import { agentManager } from "../agentManager.js";

export const delegationsRouter = Router();

/**
 * GET /api/delegations
 * Query params:
 *   ?workspace=<id>    — 過濾工作區
 *   ?pmSession=<id>    — 過濾 PM session
 *   ?inFlight=1        — 只回 status in (queued, running)
 *   ?limit=<n>         — 最多 N 筆（預設 50，上限 200）
 *
 * 回傳的 in-flight execute 項目額外帶 progress:
 *   { toolCalls: number; lastActivityAt: number|null; lastAction: string|null }
 */
delegationsRouter.get("/", (req, res) => {
  const workspaceId = req.query.workspace ? String(req.query.workspace) : undefined;
  const pmSessionId = req.query.pmSession ? String(req.query.pmSession) : undefined;
  const inFlightOnly = String(req.query.inFlight || "") === "1";
  const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 50) : 50;

  const rows = listDelegationsWithProgress({ workspaceId, pmSessionId, inFlightOnly }, limit);
  res.json(rows);
});

delegationsRouter.post("/:id/cancel", async (req, res) => {
  const dlg = getDelegation(req.params.id);
  if (!dlg) return res.status(404).json({ error: "派工不存在" });
  // Try to stop the sub-session if it exists; ignore errors (session may already be done)
  if (dlg.subSessionId) {
    try {
      agentManager.stop(dlg.subSessionId);
    } catch (e: any) {
      console.warn("[delegations] cancel: stop sub-session failed", e?.message);
    }
  }
  finishDelegation(dlg.id, { status: "failed", resultExcerpt: "使用者取消" });
  res.json({ ok: true });
});
