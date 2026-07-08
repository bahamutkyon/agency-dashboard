import { Router } from "express";
import { listGoals, createGoal, updateGoal, deleteGoal, type GoalStatus } from "../store/goals.js";
import { DEFAULT_WORKSPACE_ID } from "../store.js";

export const goalsRouter = Router();

function ws(req: any): string {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : DEFAULT_WORKSPACE_ID;
}

/**
 * GET /api/goals?workspace=<id>&status=<active|done|archived>
 * 回傳該工作區的目標清單（可依 status 過濾）。
 */
goalsRouter.get("/", (req, res) => {
  const workspaceId = ws(req);
  const status = req.query.status ? (String(req.query.status) as GoalStatus) : undefined;
  res.json(listGoals(workspaceId, status));
});

/**
 * POST /api/goals?workspace=<id>
 * Body: { title, metric?, currentValue?, targetValue?, deadline?, note? }
 */
goalsRouter.post("/", (req, res) => {
  const workspaceId = ws(req);
  const { title, metric, currentValue, targetValue, deadline, note } = req.body || {};
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title 必填" });
  }
  const goal = createGoal({ workspaceId, title, metric, currentValue, targetValue, deadline, note });
  res.status(201).json(goal);
});

/**
 * PATCH /api/goals/:id?workspace=<id>
 * Body: { title?, metric?, currentValue?, targetValue?, deadline?, status?, note? }
 * 工作區隔離：id 不屬於當前工作區 → 404（與 GET/POST 的隔離語意對齊）。
 */
goalsRouter.patch("/:id", (req, res) => {
  const { title, metric, currentValue, targetValue, deadline, status, note } = req.body || {};
  const updated = updateGoal(req.params.id, {
    title, metric, currentValue, targetValue, deadline, status, note,
  }, ws(req));
  if (!updated) return res.status(404).json({ error: "目標不存在" });
  res.json(updated);
});

/**
 * DELETE /api/goals/:id?workspace=<id>
 * 工作區隔離：id 不屬於當前工作區 → 404。
 */
goalsRouter.delete("/:id", (req, res) => {
  if (!deleteGoal(req.params.id, ws(req))) return res.status(404).json({ error: "目標不存在" });
  res.json({ ok: true });
});
