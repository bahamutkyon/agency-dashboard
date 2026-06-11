import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { getSession } from "../store.js";
import { runConsult } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import {
  startRun, approvePlan, approveAction, rejectAction, provideInput, stopRun, resumeRun, type AutonomyDeps,
} from "../autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending, getPendingAction, markActionExecuted, decidePendingAction } from "../store/autonomy.js";
import { executeDispatch } from "./sessions.js";
import { parseDispatchMarker } from "../dispatchParser.js";

export const autonomyRouter = Router();

const DISPATCH_CONCURRENCY = 3;
const CONSULT_TIMEOUT_MS = 5 * 60 * 1000;
const SEND_TURN_TIMEOUT_MS = 6 * 60 * 1000;
const BUSY_POLL_MS = 1500;
const BUSY_MAX_WAIT_MS = 90 * 1000;

function makeDeps(io: any): AutonomyDeps {
  return {
    sendTurn: (sessionId, prompt) => new Promise<string>((resolve, reject) => {
      const s = agentManager.get(sessionId) || agentManager.reattach(sessionId);
      if (!s) return resolve("");
      let collected = "", streamed = "", settled = false;
      const cleanup = () => { clearTimeout(timer); s.removeListener("event", onEvent); };
      const finish = () => { if (settled) return; settled = true; cleanup(); resolve((collected || streamed).trim()); };
      const fail = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e); };
      const onEvent = (evt: any) => {
        if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
        else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
        else if (evt.type === "result") finish();
        else if (evt.type === "error") {
          // busy 為瞬時碰撞（不該發生在此處，因送出前已等 idle）；其餘視為真錯
          if (typeof evt.payload === "string" && evt.payload.includes("busy")) return;
          fail(new Error(typeof evt.payload === "string" ? evt.payload : "agent 錯誤"));
        }
      };
      const timer = setTimeout(() => fail(new Error("sendTurn 逾時")), SEND_TURN_TIMEOUT_MS);
      // busy-aware：等到 session idle 才掛 listener + 送，避免誤殺 run、誤收他人回合事件
      const trySend = (waited: number) => {
        if (settled) return;
        if (s.status === "busy") {
          if (waited >= BUSY_MAX_WAIT_MS) { fail(new Error("session 持續忙碌，放棄本回合")); return; }
          setTimeout(() => trySend(waited + BUSY_POLL_MS), BUSY_POLL_MS);
          return;
        }
        s.on("event", onEvent);
        agentManager.send(sessionId, prompt);
      };
      trySend(0);
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
  if (!getRun(req.params.id)) return res.status(404).json({ error: "run 不存在" });
  approvePlan(req.params.id).catch((e) => console.warn("[autonomy] approvePlan", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/stop", async (req, res) => { await stopRun(req.params.id); res.json({ ok: true }); });
autonomyRouter.post("/runs/:id/resume", (req, res) => {
  if (!getRun(req.params.id)) return res.status(404).json({ error: "run 不存在" });
  resumeRun(req.params.id, makeDeps(req.app.get("io"))).catch((e) => console.warn("[autonomy] resume", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/runs/:id/input", (req, res) => {
  if (!getRun(req.params.id)) return res.status(404).json({ error: "run 不存在" });
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text 不可空" });
  provideInput(req.params.id, text).catch((e) => console.warn("[autonomy] input", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/approve", async (req, res) => {
  const pa = getPendingAction(req.params.id);
  if (!pa) return res.status(404).json({ error: "action 不存在" });
  // 手動派工（kind=dispatch 且無 runId，非自主 run）→ 走 executeDispatch；其餘交 autonomyRunner。
  if (pa.kind === "dispatch" && !pa.runId) {
    const plan = parseDispatchMarker(`=== DISPATCH ===\n${pa.detail ?? ""}\n=== END DISPATCH ===`);
    const items = plan?.items ?? [];
    decidePendingAction(pa.id, "approved");
    executeDispatch(pa.sessionId, items, req.app.get("io"))
      .then((out) => markActionExecuted(pa.id, `consult ${out.consulted.length} 項、execute ${out.executing.length} 項`))
      .catch((e) => { console.warn("[autonomy] executeDispatch", e?.message); markActionExecuted(pa.id, String(e?.message || e), false); });
    return res.json({ ok: true });
  }
  approveAction(req.params.id).catch((e) => console.warn("[autonomy] approveAction", e?.message));
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/reject", (req, res) => {
  if (!getPendingAction(req.params.id)) return res.status(404).json({ error: "action 不存在" });
  rejectAction(req.params.id).catch((e) => console.warn("[autonomy] rejectAction", e?.message));
  res.json({ ok: true });
});
