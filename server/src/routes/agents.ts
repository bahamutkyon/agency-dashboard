import { Router } from "express";
import { loadAgents, categoryLabel } from "../agentLoader.js";

export const agentsRouter = Router();

agentsRouter.get("/", (_req, res) => {
  const agents = loadAgents();
  const categories = Array.from(new Set(agents.map((a) => a.category))).map((c) => ({
    id: c,
    label: categoryLabel(c),
    count: agents.filter((a) => a.category === c).length,
  }));
  res.json({ agents, categories });
});
