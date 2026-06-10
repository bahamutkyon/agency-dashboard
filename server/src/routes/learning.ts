import { Router } from "express";
import {
  listPendingProposals, getProposal, setProposalStatus,
  getCraftMemoryFor, appendCraftMemory, appendCategoryMemory,
  getCategoryMemoryFor, setCategoryMemory, setCraftMemory,
  listCraftMemoryEntries, listLegacyCraftEntries, listLegacyCategoryEntries,
  promoteCraftMemory, promoteCategoryMemory,
  type MemoryScope,
  listLearningSchedules, getLearningSchedule,
  upsertLearningSchedule, deleteLearningSchedule,
  type LearningProposal,
} from "../learningStore.js";
import { learningScheduler } from "../learningScheduler.js";
import {
  parseCategoryAgentId, createLearningRun, executeLearningRun,
  getLearningRun, runLearningTarget, runResearchTarget,
} from "../capabilityLearning.js";
import { computeTiers } from "../studyTiering.js";
import { setTierOverride, getLatestReport, listStudySchedules, updateStudySchedule } from "../studyStore.js";
import { appendWorkspaceMemory, DEFAULT_WORKSPACE_ID } from "../store.js";
import cron from "node-cron";
import { v4 as uuid } from "uuid";

export const learningRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

/**
 * 依 source / kind / proposal.scope 推斷批准後該寫到哪。
 *
 * 推論優先序：
 *   1. req body `asScope` 覆寫 — 最高優先（使用者手動選）
 *   2. **source 是 `capability-learning:*`** — 批量能力學習產出本質是跨工作區方法論，
 *      預設 global，不管 kind 是 craft 還是 domain
 *   3. kind-based 預設（對話現場觸發的 LEARN 標記）：
 *      - kind='domain'                      → global
 *      - kind='craft'/'calibration'/'fact'  → workspace
 *
 * proposal.scope 決定落到哪個表：
 *   - p.scope='workspace'   → workspace_memory（事實記錄到該工作區）
 *   - p.scope='agent-global'→ agent_craft_memory
 *   - p.scope='category'    → category_capability_memory
 */
type LandingPlan =
  | { kind: "workspace-fact" }
  | { kind: "craft"; scope: "global" | "workspace"; workspaceId: string }
  | { kind: "category"; categoryId: string; scope: "global" | "workspace"; workspaceId: string };

function deriveDefaultScope(p: LearningProposal): "global" | "workspace" {
  // 批量能力學習的產出 = 跨工作區通用方法論（不綁特定對話/客戶情境）
  if (p.source.startsWith("capability-learning:") || p.source.startsWith("capability-research:")) return "global";
  // 對話現場觸發 LEARN：依 kind 決定
  return p.kind === "domain" ? "global" : "workspace";
}

function decideLanding(p: LearningProposal, override?: "global" | "workspace"): LandingPlan | { error: string } {
  if (p.scope === "workspace") {
    return { kind: "workspace-fact" };
  }
  const decided = override ?? deriveDefaultScope(p);
  if (p.scope === "category") {
    const cat = parseCategoryAgentId(p.agentId);
    if (!cat) return { error: "類別提案格式異常" };
    return { kind: "category", categoryId: cat, scope: decided, workspaceId: decided === "global" ? "" : p.workspaceId };
  }
  // agent-global
  return { kind: "craft", scope: decided, workspaceId: decided === "global" ? "" : p.workspaceId };
}

function applyLanding(plan: LandingPlan, p: LearningProposal): void {
  if (plan.kind === "workspace-fact") {
    appendWorkspaceMemory(p.workspaceId, p.content);
  } else if (plan.kind === "craft") {
    appendCraftMemory(p.agentId, p.content, plan.scope, plan.workspaceId);
  } else {
    appendCategoryMemory(plan.categoryId, p.content, plan.scope, plan.workspaceId);
  }
}

learningRouter.get("/proposals", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  res.json(listPendingProposals(wsId));
});

learningRouter.post("/proposals/:id/approve", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });

  const override = req.body?.asScope === "global" || req.body?.asScope === "workspace"
    ? req.body.asScope as "global" | "workspace"
    : undefined;
  const plan = decideLanding(p, override);
  if ("error" in plan) return res.status(400).json({ error: plan.error });

  // 以 CAS 搶占標記，確保並發 / 重送下只有一個請求會執行副作用
  const claimed = setProposalStatus(p.id, "approved");
  if (!claimed) return res.status(409).json({ error: "提案已處理過" });
  try {
    applyLanding(plan, p);
    res.json({ ok: true, landed: plan });
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
  const override = req.body?.asScope === "global" || req.body?.asScope === "workspace"
    ? req.body.asScope as "global" | "workspace"
    : undefined;
  let ok = 0, fail = 0;
  const errs: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const p = getProposal(id);
      if (!p || p.status !== "pending") { fail++; errs.push({ id, error: "找不到或非 pending" }); continue; }
      const plan = decideLanding(p, override);
      if ("error" in plan) { fail++; errs.push({ id, error: plan.error }); continue; }
      if (!setProposalStatus(p.id, "approved")) { fail++; errs.push({ id, error: "已處理過" }); continue; }
      applyLanding(plan, p);
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

// === Category 記憶讀寫（v2：workspace-aware）===

// 讀取類層能力記憶（回該 category 在指定 workspace 下可見的所有條目）
// 同時提供舊 client 期待的 `content` 欄位（= 聚合「全域 + 該工作區 + legacy」三段）
learningRouter.get("/category-memory/:category", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const bundle = getCategoryMemoryFor(req.params.category, wsId);
  const content = [bundle.legacyGlobal, bundle.global, bundle.workspace].filter((s) => s.trim()).join("\n");
  res.json({ category: req.params.category, workspaceId: wsId, content, ...bundle });
});

// 覆蓋類層能力記憶；scope 預設 'global'，可帶 ?scope=workspace 並指定 workspace
learningRouter.put("/category-memory/:category", (req, res) => {
  const cat = req.params.category;
  const content = String(req.body?.content || "");
  const scope = (req.body?.scope || "global") as MemoryScope;
  const wsId = scope === "workspace" ? String(req.body?.workspaceId || ws(req) || "") : "";
  try {
    setCategoryMemory(cat, content, scope, wsId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

// === Craft 記憶讀寫（v2：workspace-aware）===

// 讀取個別 agent 手藝記憶（path 版）；同時提供舊 client 期待的 `content` 聚合欄位
learningRouter.get("/craft/:agentId", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const bundle = getCraftMemoryFor(req.params.agentId, wsId);
  const content = [bundle.legacyGlobal, bundle.global, bundle.workspace].filter((s) => s.trim()).join("\n");
  res.json({ agentId: req.params.agentId, workspaceId: wsId, content, ...bundle });
});

// 覆蓋個別 agent 手藝記憶
learningRouter.put("/craft/:agentId", (req, res) => {
  const aid = req.params.agentId;
  const content = String(req.body?.content || "");
  const scope = (req.body?.scope || "global") as MemoryScope;
  const wsId = scope === "workspace" ? String(req.body?.workspaceId || ws(req) || "") : "";
  try {
    setCraftMemory(aid, content, scope, wsId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

// Query string 版（沿用既有 client 呼叫）
learningRouter.get("/craft", (req, res) => {
  const agentId = String(req.query.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const bundle = getCraftMemoryFor(agentId, wsId);
  const content = [bundle.legacyGlobal, bundle.global, bundle.workspace].filter((s) => s.trim()).join("\n");
  res.json({ agentId, workspaceId: wsId, content, ...bundle });
});

// === Legacy 重審介面 ===

// 列出該 agent 所有 craft 條目（含每個 scope/workspace）
learningRouter.get("/craft-entries/:agentId", (req, res) => {
  res.json(listCraftMemoryEntries(req.params.agentId));
});

// 列出所有 legacy-global 的 craft 條目，供「Legacy 重審」UI 用
learningRouter.get("/legacy/craft", (_req, res) => {
  res.json(listLegacyCraftEntries());
});

learningRouter.get("/legacy/category", (_req, res) => {
  res.json(listLegacyCategoryEntries());
});

// 把 craft 條目從 legacy-global 推到目標 scope（global / workspace）
// body: { toScope: 'global' | 'workspace', toWorkspaceId?: string }
learningRouter.post("/legacy/craft/:agentId/promote", (req, res) => {
  const aid = req.params.agentId;
  const toScope = String(req.body?.toScope || "") as MemoryScope;
  const toWs = String(req.body?.toWorkspaceId || "");
  if (toScope !== "global" && toScope !== "workspace") {
    return res.status(400).json({ error: "toScope 必須是 global 或 workspace" });
  }
  if (toScope === "workspace" && !toWs) {
    return res.status(400).json({ error: "toScope=workspace 需指定 toWorkspaceId" });
  }
  try {
    promoteCraftMemory(aid, "legacy-global", "", toScope, toScope === "global" ? "" : toWs);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

learningRouter.post("/legacy/category/:category/promote", (req, res) => {
  const cat = req.params.category;
  const toScope = String(req.body?.toScope || "") as MemoryScope;
  const toWs = String(req.body?.toWorkspaceId || "");
  if (toScope !== "global" && toScope !== "workspace") {
    return res.status(400).json({ error: "toScope 必須是 global 或 workspace" });
  }
  if (toScope === "workspace" && !toWs) {
    return res.status(400).json({ error: "toScope=workspace 需指定 toWorkspaceId" });
  }
  try {
    promoteCategoryMemory(cat, "legacy-global", "", toScope, toScope === "global" ? "" : toWs);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// 刪除 legacy-global craft 條目
learningRouter.delete("/legacy/craft/:agentId", (req, res) => {
  try {
    setCraftMemory(req.params.agentId, "", "legacy-global", "");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

learningRouter.delete("/legacy/category/:category", (req, res) => {
  try {
    setCategoryMemory(req.params.category, "", "legacy-global", "");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// === 能力學習 run + 排程（不變）===

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

// === 自主進修 study/* 端點 ===

learningRouter.get("/study/tiers", (_req, res) => res.json(computeTiers()));

learningRouter.post("/study/override", (req, res) => {
  const { agentId, override } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  if (override !== null && !["hot", "cold", "exclude"].includes(override)) return res.status(400).json({ error: "override 非法" });
  setTierOverride(String(agentId), override);
  res.json({ ok: true });
});

learningRouter.get("/study/report/:agentId", (req, res) => {
  res.json(getLatestReport(req.params.agentId) || null);
});

learningRouter.get("/study/schedules", (_req, res) => res.json(listStudySchedules()));

learningRouter.patch("/study/schedules/:tier", (req, res) => {
  const tier = req.params.tier;
  if (tier !== "hot" && tier !== "cold") return res.status(400).json({ error: "tier 須 hot/cold" });
  updateStudySchedule(tier, {
    enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
    cron: req.body?.cron, perRunCap: req.body?.perRunCap,
  });
  const sched = req.app.get("studyScheduler");
  if (sched && typeof sched.sync === "function") sched.sync();
  res.json({ ok: true });
});

learningRouter.post("/study/run", (req, res) => {
  const agentId = String(req.body?.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const run = createLearningRun([{ type: "agent", id: agentId }], null, "research");
  res.json({ runId: run.id });
  const io = req.app.get("io");
  executeLearningRun(run, (t) => runResearchTarget(t, run.id), (r) => {
    io?.emit?.("learning:progress", {
      runId: r.id, status: r.status, total: r.total, done: r.done,
      current: r.current, failed: r.failed, createdProposals: r.createdProposals,
    });
  }).catch((e) => {
    run.status = "error";
    io?.emit?.("learning:progress", {
      runId: run.id, status: run.status, total: run.total, done: run.done,
      current: null, failed: run.failed, createdProposals: run.createdProposals,
    });
    console.warn("[study/run] background exec failed:", e?.message || e);
  });
});
