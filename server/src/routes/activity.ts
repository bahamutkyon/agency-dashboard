import { Router } from "express";
import { listActivity } from "../store/activity.js";

export const activityRouter = Router();

activityRouter.get("/", (req, res) => {
  const { workspaceId, sessionId, kind, limit, before } = req.query;
  const items = listActivity({
    workspaceId: workspaceId ? String(workspaceId) : undefined,
    sessionId: sessionId ? String(sessionId) : undefined,
    kind: kind ? String(kind) : undefined,
    limit: limit ? Number(limit) : undefined,
    before: before ? Number(before) : undefined,
  });
  const nextBefore = items.length ? items[items.length - 1].ts : undefined;
  res.json({ items, nextBefore });
});
