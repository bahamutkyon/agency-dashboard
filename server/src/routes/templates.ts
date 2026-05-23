import { Router } from "express";
import { listTemplates, upsertTemplate, deleteTemplate as removeTemplate, DEFAULT_WORKSPACE_ID } from "../store.js";
import { v4 as uuid } from "uuid";

export const templatesRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

templatesRouter.get("/", (req, res) => {
  res.json(listTemplates(ws(req)));
});

templatesRouter.post("/", (req, res) => {
  const { name, body, agentId, tags } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: "name and body required" });
  const now = Date.now();
  const t = {
    id: uuid(), workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    name, body, agentId, tags: tags || [], createdAt: now, updatedAt: now,
  };
  upsertTemplate(t);
  res.json(t);
});

templatesRouter.patch("/:id", (req, res) => {
  const all = listTemplates();
  const cur = all.find((t) => t.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur, ...req.body, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() };
  upsertTemplate(next);
  res.json(next);
});

templatesRouter.delete("/:id", (req, res) => {
  removeTemplate(req.params.id);
  res.json({ ok: true });
});
