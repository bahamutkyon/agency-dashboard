import { Router } from "express";
import { createProject, listProjects, getProject, renameProject, deleteProject, setProjectMemory } from "../store/projects.js";
import { DEFAULT_WORKSPACE_ID } from "../db.js";

export const projectsRouter = Router();

function ws(req: any): string {
  return String(req.query.workspace || req.get("x-workspace") || DEFAULT_WORKSPACE_ID);
}

projectsRouter.get("/", (req, res) => res.json({ projects: listProjects(ws(req)) }));

projectsRouter.post("/", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name 不可空" });
  res.json({ project: createProject({ workspaceId: ws(req), name }) });
});

projectsRouter.patch("/:id", (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: "專案不存在" });
  if (typeof req.body?.name === "string" && req.body.name.trim()) renameProject(p.id, req.body.name.trim());
  if (typeof req.body?.memory === "string") setProjectMemory(p.id, req.body.memory);
  res.json({ project: getProject(p.id) });
});

projectsRouter.delete("/:id", (req, res) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: "專案不存在" });
  deleteProject(req.params.id);
  res.json({ ok: true });
});
