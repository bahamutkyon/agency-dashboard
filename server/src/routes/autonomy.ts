import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { getSession } from "../store.js";
import { runConsult } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import {
  startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, resumeRun, type AutonomyDeps,
} from "../autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending, getPendingAction } from "../store/autonomy.js";

export const autonomyRouter = Router();

const DISPATCH_CONCURRENCY = 3;
const CONSULT_TIMEOUT_MS = 5 * 60 * 1000;

function makeDeps(io: any): AutonomyDeps {
  return {
    sendTurn: (sessionId, prompt) => new Promise<string>((resolve) => {
      const s = agentManager.get(sessionId) || agentManager.reattach(sessionId);
      if (!s) return resolve("");
      let collected = "", streamed = "", settled = false;
      const finish = () => {
        if (settled) return; settled = true;
        s.removeListener("event", onEvent);
        resolve((collected || streamed).trim());
      };
      const onEvent = (evt: any) => {
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
        else if (evt.type === "result") finish();
        else if (evt.type === "error") finish();
      };
      s.on("event", onEvent);
      agentManager.send(sessionId, prompt);
    }),
    runDispatch: async (items: DispatchItem[], workspaceId: string) => {
      const res = await runConsult(items, workspaceId, { concurrency: DISPATCH_CONCURRENCY, perItemTimeoutMs: CONSULT_TIMEOUT_MS });
      return res.map((r) => `### ${r.agentId}（${r.status}）\n${r.output || "（無回覆）"}`).join("\n\n");
    },
    now: () => Date.now(),
    emit: (runId, evt) => { io?.emit("autonomy:event", { runId, ...evt }); },
  };
}

autonomyRouter.post("/runs", async (req, res) => {
  const { sessionId, goal, maxSteps, maxWallMs } = req.body || {};
  if (!sessionId || typeof goal !== "string" || !goal.trim()) return res.status(400).json({ error: "需要 sessionId 與非空 goal" });
  const sess = getSession(sessionId);
  if (!sess) return res.status(404).json({ error: "session 不存在" });
  if (sess.provider !== "claude") return res.status(400).json({ error: "自主迴圈本期僅支援 claude provider" });
  if (getActiveRunForSession(sessionId)) return res.status(409).json({ error: "此 session 已有進行中的 run" });
  const deps = makeDeps(req.app.get("io"));
  const runId = await startRun(sessionId, sess.workspaceId, goal.trim(), { maxSteps, maxWallMs }, deps);
  res.json({ runId });
});

autonomyRouter.get("/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "run 不存在" });
  res.json({ run, pending: listPending(run.sessionId) });
});
autonomyRouter.get("/sessions/:sid/run", (req, res) => {
  res.json({ run: getActiveRunForSession(req.params.sid) ?? null });
});
autonomyRouter.get("/sessions/:sid/pending", (req, res) => {
  res.json({ pending: listPending(req.params.sid) });
});
autonomyRouter.post("/runs/:id/approve-plan", (req, res) => {
  approvePlan(req.params.id).catch((e) => console.warn("[autonomy] approvePlan", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/stop", async (req, res) => { await stopRun(req.params.id); res.json({ ok: true }); });
autonomyRouter.post("/runs/:id/resume", (req, res) => {
  resumeRun(req.params.id, makeDeps(req.app.get("io"))).catch((e) => console.warn("[autonomy] resume", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/input", (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text 不可空" });
  provideInput(req.params.id, text).catch((e) => console.warn("[autonomy] input", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/approve", (req, res) => {
  if (!getPendingAction(req.params.id)) return res.status(404).json({ error: "action 不存在" });
  approveAction(req.params.id).catch((e) => console.warn("[autonomy] approveAction", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/reject", (req, res) => {
  if (!getPendingAction(req.params.id)) return res.status(404).json({ error: "action 不存在" });
  rejectAction(req.params.id).catch((e) => console.warn("[autonomy] rejectAction", e?.message));
  res.json({ ok: true });
});
