import { Router } from "express";
import { loadAgents } from "../agentLoader.js";
import {
  listWorkflows, getWorkflow, upsertWorkflow, deleteWorkflow as removeWorkflow,
  listRuns, getRun,
  DEFAULT_WORKSPACE_ID,
} from "../store.js";
import { workflowRunner } from "../workflowRunner.js";
import { importWorkflowYaml, exportWorkflowYaml } from "../yamlAdapter.js";
import { v4 as uuid } from "uuid";
import express from "express";

export const workflowsRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

workflowsRouter.get("/", (req, res) => {
  res.json(listWorkflows(ws(req)));
});

workflowsRouter.get("/:id", (req, res) => {
  const w = getWorkflow(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  res.json(w);
});

workflowsRouter.post("/", (req, res) => {
  const { name, description, steps } = req.body || {};
  if (!name || !Array.isArray(steps)) {
    return res.status(400).json({ error: "name and steps[] required" });
  }
  const now = Date.now();
  const w = {
    id: uuid(),
    workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    name, description: description || "",
    steps,
    createdAt: now, updatedAt: now,
  };
  upsertWorkflow(w);
  res.json(w);
});

workflowsRouter.patch("/:id", (req, res) => {
  const cur = getWorkflow(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur, ...req.body, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() };
  upsertWorkflow(next);
  res.json(next);
});

workflowsRouter.delete("/:id", (req, res) => {
  removeWorkflow(req.params.id);
  res.json({ ok: true });
});

workflowsRouter.post("/:id/run", async (req, res) => {
  try {
    const { initialInput, resumeRunId, fromStepId } = req.body || {};
    const run = await workflowRunner.run({
      workflowId: req.params.id,
      initialInput,
      resumeRunId,
      fromStepId,
    });
    res.json(run);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

workflowsRouter.post("/:id/validate", (req, res) => {
  res.json(workflowRunner.validate(req.params.id));
});

workflowsRouter.get("/:id/runs", (req, res) => {
  res.json(listRuns(req.params.id));
});

// Workflow YAML export — returns text/yaml file for download
workflowsRouter.get("/:id/yaml", (req, res) => {
  const wf = getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: "not found" });
  const yaml = exportWorkflowYaml(wf);
  res.setHeader("Content-Type", "application/x-yaml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${wf.name.replace(/[^\w-]/g, "_")}.yaml"`);
  res.send(yaml);
});

// Workflow YAML import — accept YAML body, create new workflow in workspace
workflowsRouter.post("/import-yaml", express.text({ type: "*/*", limit: "1mb" }), (req, res) => {
  try {
    const text = typeof req.body === "string" ? req.body : (req.body?.yaml || "");
    if (!text || text.length < 10) return res.status(400).json({ error: "YAML 內容為空" });
    const parsed = importWorkflowYaml(text);
    if (!parsed.steps || parsed.steps.length === 0) {
      return res.status(400).json({ error: "找不到任何 steps" });
    }
    // validate agentIds
    const known = new Set(loadAgents().map((a) => a.id));
    const unknown = parsed.steps.filter((s) => s.agentId && !known.has(s.agentId)).map((s) => s.agentId);
    const now = Date.now();
    const wf = {
      id: uuid(),
      workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
      name: parsed.name,
      description: parsed.description,
      steps: parsed.steps,
      maxConcurrency: parsed.maxConcurrency,
      createdAt: now,
      updatedAt: now,
    };
    upsertWorkflow(wf);
    res.json({
      workflowId: wf.id,
      stepCount: wf.steps.length,
      unknownAgents: Array.from(new Set(unknown)),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================================
// /api/runs — mounted separately at /api/runs in index.ts
// ============================================================
export const runsRouter = Router();

runsRouter.get("/:id", (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

runsRouter.post("/:id/cancel", (req, res) => {
  workflowRunner.cancel(req.params.id);
  res.json({ ok: true });
});

runsRouter.post("/:id/approve", (req, res) => {
  workflowRunner.approve(req.params.id);
  res.json({ ok: true });
});

runsRouter.post("/:id/loop-back", (req, res) => {
  const { stepId } = req.body || {};
  if (!stepId) return res.status(400).json({ error: "stepId required" });
  const r = workflowRunner.loopBack(req.params.id, stepId);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});
