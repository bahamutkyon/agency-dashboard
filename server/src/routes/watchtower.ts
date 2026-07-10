/**
 * routes/watchtower.ts — 常駐看守任務 REST API
 *
 * workspace 走 ?workspace= 或 x-workspace header（對齊既有排程 API 慣例，不是 body）。
 */
import { Router } from "express";
import { v4 as uuid } from "uuid";
import cron from "node-cron";
import {
  listWatchtowerTasks,
  getWatchtowerTask,
  createWatchtowerTask,
  updateWatchtowerTask,
  deleteWatchtowerTask,
  listLogs,
  listLogsByWorkspace,
} from "../store/watchtower.js";
import { DEFAULT_WORKSPACE_ID } from "../store.js";
import { watchtowerScheduler } from "../watchtowerScheduler.js";

export const watchtowerRouter = Router();

/** Helper: 取工作區 id（query string 或 header）。 */
function ws(req: any): string {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : DEFAULT_WORKSPACE_ID;
}

// ─── Tasks CRUD ───────────────────────────────────────────────────────────────

watchtowerRouter.get("/tasks", (req, res) => {
  const workspaceId = ws(req);
  res.json({ tasks: listWatchtowerTasks(workspaceId) });
});

watchtowerRouter.get("/tasks/:id", (req, res) => {
  const task = getWatchtowerTask(req.params.id);
  if (!task) return res.status(404).json({ error: "不存在" });
  // 工作區隔離守衛
  if (task.workspaceId !== ws(req)) return res.status(404).json({ error: "不存在" });
  res.json({ task });
});

watchtowerRouter.post("/tasks", (req, res) => {
  const { name, cron: cronExpr, quietHours, dailyQuota, enabled } = req.body || {};
  if (!name || !cronExpr) return res.status(400).json({ error: "name 與 cron 必填" });
  if (!cron.validate(cronExpr)) return res.status(400).json({ error: "無效的 cron 表達式" });
  const workspaceId = ws(req);
  const task = createWatchtowerTask({
    workspaceId,
    name: String(name),
    cron: cronExpr,
    quietHours: quietHours ? String(quietHours) : "",
    dailyQuota: typeof dailyQuota === "number" ? dailyQuota : 3,
    enabled: enabled !== false,
  });
  // 重新同步排程
  watchtowerScheduler.sync();
  res.status(201).json({ task });
});

watchtowerRouter.patch("/tasks/:id", (req, res) => {
  const { name, cron: cronExpr, quietHours, dailyQuota, enabled } = req.body || {};
  if (cronExpr && !cron.validate(cronExpr)) return res.status(400).json({ error: "無效的 cron 表達式" });
  const workspaceId = ws(req);
  const task = updateWatchtowerTask(req.params.id, { name, cron: cronExpr, quietHours, dailyQuota, enabled }, workspaceId);
  if (!task) return res.status(404).json({ error: "不存在或無權限" });
  watchtowerScheduler.sync();
  res.json({ task });
});

watchtowerRouter.delete("/tasks/:id", (req, res) => {
  const workspaceId = ws(req);
  const ok = deleteWatchtowerTask(req.params.id, workspaceId);
  if (!ok) return res.status(404).json({ error: "不存在或無權限" });
  watchtowerScheduler.sync();
  res.json({ ok: true });
});

// ─── Logs ──────────────────────────────────────────────────────────────────────

watchtowerRouter.get("/logs", (req, res) => {
  const workspaceId = ws(req);
  const taskId = req.query.taskId ? String(req.query.taskId) : undefined;
  const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10), 200) : 100;
  if (taskId) {
    // 工作區隔離：先驗 task 屬於此工作區
    const task = getWatchtowerTask(taskId);
    if (!task || task.workspaceId !== workspaceId) return res.status(404).json({ error: "task 不存在或無權限" });
    res.json({ logs: listLogs(taskId, workspaceId, limit) });
  } else {
    res.json({ logs: listLogsByWorkspace(workspaceId, limit) });
  }
});

// ─── 手動觸發 ──────────────────────────────────────────────────────────────────

watchtowerRouter.post("/tasks/:id/run-now", async (req, res) => {
  const workspaceId = ws(req);
  const task = getWatchtowerTask(req.params.id);
  if (!task || task.workspaceId !== workspaceId) return res.status(404).json({ error: "不存在或無權限" });

  const force = req.body?.force === true; // force=true 略過 quiet/quota（但 overlap 仍擋）
  try {
    // 走 scheduler.runNow：與 cron fire 共用 in-memory 併發守衛 + firewatchdogTask 內的
    // live-run overlap guard（quiet/quota/overlap 全在裡面，route 不重複判斷）。
    const decision = await watchtowerScheduler.runNow(task.id, { force });
    res.json({ decision });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
