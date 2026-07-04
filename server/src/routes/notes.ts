import { Router } from "express";
import { listNotes, upsertNote, deleteNote as removeNote, DEFAULT_WORKSPACE_ID } from "../store.js";
import { v4 as uuid } from "uuid";

export const notesRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

notesRouter.get("/", (req, res) => {
  res.json(listNotes(ws(req)));
});

notesRouter.post("/", (req, res) => {
  const { title, body, pinned } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "title and body required" });
  const now = Date.now();
  const n = {
    id: uuid(), workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    title, body, pinned: !!pinned, createdAt: now, updatedAt: now,
  };
  upsertNote(n);
  res.json(n);
});

notesRouter.patch("/:id", (req, res) => {
  const all = listNotes();
  const cur = all.find((n) => n.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  // Whitelist only user-editable fields; never allow id/workspaceId/createdAt.
  const { title, body, pinned } = req.body || {};
  const next = {
    ...cur,
    ...(title !== undefined && { title: String(title) }),
    ...(body !== undefined && { body: String(body) }),
    ...(pinned !== undefined && { pinned: Boolean(pinned) }),
    updatedAt: Date.now(),
  };
  upsertNote(next);
  res.json(next);
});

notesRouter.delete("/:id", (req, res) => {
  removeNote(req.params.id);
  res.json({ ok: true });
});
