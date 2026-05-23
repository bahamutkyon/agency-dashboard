import { Router } from "express";
import {
  listPendingProposals, getProposal, setProposalStatus,
  getCraftMemory, appendCraftMemory, appendCategoryMemory,
  getCategoryMemory, setCategoryMemory, setCraftMemory,
  listLearningSchedules, getLearningSchedule,
  upsertLearningSchedule, deleteLearningSchedule,
} from "../learningStore.js";
import { learningScheduler } from "../learningScheduler.js";
import {
  parseCategoryAgentId, createLearningRun, executeLearningRun,
  getLearningRun, runLearningTarget,
} from "../capabilityLearning.js";
import { appendWorkspaceMemory, DEFAULT_WORKSPACE_ID } from "../store.js";
import cron from "node-cron";
import { v4 as uuid } from "uuid";

export const learningRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

learningRouter.get("/proposals", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  res.json(listPendingProposals(wsId));
});

learningRouter.post("/proposals/:id/approve", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });

  // 類層提案：先驗證 agent_id 前綴格式，格式異常直接拒絕、不搶占。
  let categoryId: string | null = null;
  if (p.scope === "category") {
    categoryId = parseCategoryAgentId(p.agentId);
    if (!categoryId) return res.status(400).json({ error: "類別提案格式異常" });
  }

  // 以 CAS 搶占標記，確保並發 / 重送下只有一個請求會執行副作用
  const claimed = setProposalStatus(p.id, "approved");
  if (!claimed) return res.status(409).json({ error: "提案已處理過" });
  try {
    if (p.scope === "category") {
      appendCategoryMemory(categoryId!, p.content);
    } else if (p.scope === "agent-global") {
      appendCraftMemory(p.agentId, p.content);
    } else {
      appendWorkspaceMemory(p.workspaceId, p.content);
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

learningRouter.post("/proposals/:id/reject", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });
  setProposalStatus(p.id, "rejected");
  res.json({ ok: true });
});

// 批次批准（最多 500 條）
learningRouter.post("/proposals/bulk-approve", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids 不可為空" });
  let ok = 0, fail = 0;
  const errs: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const p = getProposal(id);
      if (!p || p.status !== "pending") { fail++; errs.push({ id, error: "找不到或非 pending" }); continue; }
      let categoryId: string | null = null;
      if (p.scope === "category") {
        categoryId = parseCategoryAgentId(p.agentId);
        if (!categoryId) { fail++; errs.push({ id, error: "類別格式異常" }); continue; }
      }
      if (!setProposalStatus(p.id, "approved")) { fail++; errs.push({ id, error: "已處理過" }); continue; }
      if (p.scope === "category") appendCategoryMemory(categoryId!, p.content);
      else if (p.scope === "agent-global") appendCraftMemory(p.agentId, p.content);
      else appendWorkspaceMemory(p.workspaceId, p.content);
      ok++;
    } catch (e: any) { fail++; errs.push({ id, error: e?.message || String(e) }); }
  }
  res.json({ ok, fail, errors: errs.slice(0, 20) });
});

// 批次拒絕（最多 500 條）
learningRouter.post("/proposals/bulk-reject", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
  if (ids.length === 0) return res.status(400).json({ error: "ids 不可為空" });
  let ok = 0, fail = 0;
  for (const id of ids) {
    const p = getProposal(id);
    if (p && p.status === "pending" && setProposalStatus(p.id, "rejected")) ok++;
    else fail++;
  }
  res.json({ ok, fail });
});

// 讀取類層能力記憶
learningRouter.get("/category-memory/:category", (req, res) => {
  res.json({ category: req.params.category, content: getCategoryMemory(req.params.category) });
});

// 覆蓋類層能力記憶（直接 SET，非追加）
learningRouter.put("/category-memory/:category", (req, res) => {
  const cat = req.params.category;
  const content = String(req.body?.content || "");
  setCategoryMemory(cat, content);
  res.json({ ok: true });
});

// 讀取個別 agent 手藝記憶（path 參數版，補齊現有的 query string 版）
learningRouter.get("/craft/:agentId", (req, res) => {
  res.json({ agentId: req.params.agentId, content: getCraftMemory(req.params.agentId) });
});

// 覆蓋個別 agent 手藝記憶（直接 SET，非追加）
learningRouter.put("/craft/:agentId", (req, res) => {
  const aid = req.params.agentId;
  const content = String(req.body?.content || "");
  setCraftMemory(aid, content);
  res.json({ ok: true });
});

learningRouter.get("/craft", (req, res) => {
  const agentId = String(req.query.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  res.json({ agentId, content: getCraftMemory(agentId) });
});

// 啟動能力學習 run — 序列逐一跑，socket 推進度。
// io 從 req.app.get("io") 取得，避免循環依賴
learningRouter.post("/run", (req, res) => {
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const clean = targets.filter(
    (t: any) => t && (t.type === "category" || t.type === "agent") && typeof t.id === "string",
  );
  if (clean.length === 0) return res.status(400).json({ error: "targets 不可為空" });

  const run = createLearningRun(clean);
  res.json({ runId: run.id, total: run.total });

  const io = req.app.get("io");

  // 背景序列執行，不阻塞回應
  executeLearningRun(run, runLearningTarget, (r) => {
    io.emit("learning:progress", {
      runId: r.id, status: r.status, total: r.total, done: r.done,
      current: r.current, failed: r.failed, createdProposals: r.createdProposals,
    });
  }).catch((e) => {
    run.status = "error";
    io.emit("learning:progress", {
      runId: run.id, status: run.status, total: run.total, done: run.done,
      current: null, failed: run.failed, createdProposals: run.createdProposals,
    });
    console.warn("[capability-learning] run failed:", e?.message || e);
  });
});

// 查詢 run 進度
learningRouter.get("/run/:id", (req, res) => {
  const run = getLearningRun(req.params.id);
  if (!run) return res.status(404).json({ error: "找不到 run" });
  res.json(run);
});

// --- 能力學習排程（時間驅動）CRUD ---

learningRouter.get("/schedules", (_req, res) => {
  res.json(listLearningSchedules());
});

learningRouter.post("/schedules", (req, res) => {
  const { name, targets, cron: expr } = req.body || {};
  if (!expr || !cron.validate(expr)) {
    return res.status(400).json({ error: "cron 格式錯誤" });
  }
  const clean = Array.isArray(targets)
    ? targets.filter((t: any) => t && (t.type === "category" || t.type === "agent") && typeof t.id === "string")
    : [];
  if (clean.length === 0) return res.status(400).json({ error: "targets 不可為空" });
  const s = {
    id: uuid(), name: String(name || "能力學習排程"),
    targets: clean, cron: expr, enabled: true, createdAt: Date.now(),
  };
  upsertLearningSchedule(s);
  learningScheduler.sync();
  res.json(s);
});

learningRouter.patch("/schedules/:id", (req, res) => {
  const s = getLearningSchedule(req.params.id);
  if (!s) return res.status(404).json({ error: "找不到排程" });
  const updated = typeof req.body?.enabled === "boolean"
    ? { ...s, enabled: req.body.enabled }
    : s;
  upsertLearningSchedule(updated);
  learningScheduler.sync();
  res.json(updated);
});

learningRouter.delete("/schedules/:id", (req, res) => {
  deleteLearningSchedule(req.params.id);
  learningScheduler.sync();
  res.json({ ok: true });
});
