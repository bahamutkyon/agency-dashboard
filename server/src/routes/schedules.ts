import { Router } from "express";
import { scheduler } from "../scheduler.js";
import { DEFAULT_WORKSPACE_ID } from "../store.js";

export const schedulesRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

schedulesRouter.get("/", (req, res) => {
  res.json(scheduler.list(ws(req)));
});

schedulesRouter.post("/", (req, res) => {
  try {
    const s = scheduler.create({ ...req.body, workspaceId: ws(req) || DEFAULT_WORKSPACE_ID });
    res.json(s);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

schedulesRouter.patch("/:id", (req, res) => {
  try {
    const s = scheduler.update(req.params.id, req.body);
    if (!s) return res.status(404).json({ error: "not found" });
    res.json(s);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

schedulesRouter.delete("/:id", (req, res) => {
  scheduler.delete(req.params.id);
  res.json({ ok: true });
});
