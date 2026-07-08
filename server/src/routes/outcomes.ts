import { Router } from "express";
import {
  listOutcomes, createOutcomeCheck, recordResult, cancelOutcome, deleteOutcomeCheck,
  type OutcomeStatus,
} from "../store/outcomes.js";
import { DEFAULT_WORKSPACE_ID } from "../store.js";

export const outcomesRouter = Router();

function ws(req: any): string {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : DEFAULT_WORKSPACE_ID;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/outcomes?workspace=<id>&status=<pending|notified|done|cancelled>
 * 回傳該工作區的成效回訪清單（可依 status 過濾）。
 */
outcomesRouter.get("/", (req, res) => {
  const workspaceId = ws(req);
  const status = req.query.status ? (String(req.query.status) as OutcomeStatus) : undefined;
  res.json(listOutcomes(workspaceId, status));
});

/**
 * POST /api/outcomes?workspace=<id>
 * Body: { description, dueInDays? | dueAt?, delegationId?, goalId? }
 *   dueAt（絕對毫秒）優先；否則用 dueInDays（可小數，預設 7 天）。
 */
outcomesRouter.post("/", (req, res) => {
  const workspaceId = ws(req);
  const { description, dueInDays, dueAt, delegationId, goalId } = req.body || {};
  if (!description || typeof description !== "string" || !description.trim()) {
    return res.status(400).json({ error: "description 必填" });
  }
  let due: number;
  if (typeof dueAt === "number" && Number.isFinite(dueAt)) {
    due = dueAt;
  } else {
    const days = typeof dueInDays === "number" && Number.isFinite(dueInDays) && dueInDays > 0 ? dueInDays : 7;
    due = Date.now() + days * DAY_MS;
  }
  const oc = createOutcomeCheck({
    workspaceId,
    description: description.trim(),
    dueAt: due,
    delegationId: typeof delegationId === "string" ? delegationId : undefined,
    goalId: typeof goalId === "string" ? goalId : undefined,
  });
  res.status(201).json(oc);
});

/**
 * PATCH /api/outcomes/:id/result?workspace=<id>
 * Body: { result } — 填結果 → done。工作區隔離：跨區 → 404。
 */
outcomesRouter.patch("/:id/result", (req, res) => {
  const { result } = req.body || {};
  if (typeof result !== "string" || !result.trim()) {
    return res.status(400).json({ error: "result 必填" });
  }
  const updated = recordResult(req.params.id, result.trim(), ws(req));
  if (!updated) return res.status(404).json({ error: "回訪不存在" });
  res.json(updated);
});

/**
 * PATCH /api/outcomes/:id/cancel?workspace=<id>
 * 取消回訪 → cancelled。工作區隔離：跨區 → 404。
 */
outcomesRouter.patch("/:id/cancel", (req, res) => {
  const updated = cancelOutcome(req.params.id, ws(req));
  if (!updated) return res.status(404).json({ error: "回訪不存在" });
  res.json(updated);
});

/**
 * DELETE /api/outcomes/:id?workspace=<id>
 * 工作區隔離：id 不屬於當前工作區 → 404。
 */
outcomesRouter.delete("/:id", (req, res) => {
  if (!deleteOutcomeCheck(req.params.id, ws(req))) return res.status(404).json({ error: "回訪不存在" });
  res.json({ ok: true });
});
