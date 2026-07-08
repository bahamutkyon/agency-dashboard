import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { turnMatches } from "../agentSession.js";
import { getSession } from "../store.js";
import { logActivity } from "../store/activity.js";
import { runDispatchByMode } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import {
  startRun, approvePlan, provideInput, stopRun, resumeRun, type AutonomyDeps,
} from "../autonomyRunner.js";
import { getRun, getActiveRunForSession, listPending, setPendingInjection } from "../store/autonomy.js";
import { isPolicyName } from "../autonomyPolicy.js";
import { parseDispatchMarker } from "../dispatchParser.js";
import { approvePendingAction, rejectPendingAction, computePartialApprovalNote } from "./approvalService.js";

export const autonomyRouter = Router();

// computePartialApprovalNote 已移至 approvalService；此處 re-export 維持既有匯入相容。
export { computePartialApprovalNote };

const DISPATCH_CONCURRENCY = 3;
const CONSULT_TIMEOUT_MS = 5 * 60 * 1000;
const EXECUTE_CONSULT_TIMEOUT_MS = 10 * 60 * 1000; // execute 項同步等待上限：10 分鐘（自主迴圈不 fire-and-forget）
const SEND_TURN_TIMEOUT_MS = 6 * 60 * 1000;
const BUSY_POLL_MS = 1500;
const BUSY_MAX_WAIT_MS = 90 * 1000;

function makeDeps(io: any): AutonomyDeps {
  return {
    sendTurn: (sessionId, prompt) => new Promise<string>((resolve, reject) => {
      const s = agentManager.get(sessionId) || agentManager.reattach(sessionId);
      if (!s) return resolve("");
      let collected = "", streamed = "", settled = false;
      // 本回合的 turnId（send 後才知道）。等待端只認自己 turnId 的 result，避免
      // 同一 session 有第二個寫入者（如外包 EXEC_REPORT 經佇列排入）時回覆張冠李戴。
      let myTurnId: number | undefined;
      const cleanup = () => { clearTimeout(timer); s.removeListener("event", onEvent); };
      const finish = () => { if (settled) return; settled = true; cleanup(); resolve((collected || streamed).trim()); };
      const fail = (e: Error) => { if (settled) return; settled = true; cleanup(); reject(e); };
      const onEvent = (evt: any) => {
        // delta/message 也只收自己回合的（有 turnId 才過濾；無則相容全收）。
        if (evt.type === "delta" && typeof evt.payload === "string") { if (turnMatches(myTurnId, evt.turnId)) streamed += evt.payload; }
        else if (evt.type === "message" && evt.payload?.content) { if (turnMatches(myTurnId, evt.turnId)) collected = String(evt.payload.content); }
        else if (evt.type === "result") { if (turnMatches(myTurnId, evt.turnId)) finish(); }
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
        // send 為同步；回傳後立即得到本回合 turnId，此時 result 尚未（非同步）到達。
        myTurnId = agentManager.send(sessionId, prompt).turnId;
      };
      trySend(0);
    }),
    runDispatch: async (items: DispatchItem[], workspaceId: string, ledger?: { pmSessionId: string; runId: string }) => {
      // 依 mode 分流：consult 項 5 分鐘同步諮詢；execute 項 10 分鐘同步等待＋「完成自驗」prompt。
      // 兩者均同步等待，確保迴圈拿到真實結果、不引入非同步回報插回迴圈的 race。
      // ledger 脈絡（自主迴圈傳入）→ 每項派工進台帳＋（execute）推播，在途面板/手機通知不再失聲。
      return runDispatchByMode(items, workspaceId, {
        concurrency: DISPATCH_CONCURRENCY,
        consultTimeoutMs: CONSULT_TIMEOUT_MS,
        executeTimeoutMs: EXECUTE_CONSULT_TIMEOUT_MS,
      }, undefined, undefined, ledger ? { pmSessionId: ledger.pmSessionId, workspaceId, runId: ledger.runId } : undefined);
    },
    now: () => Date.now(),
    emit: (runId, evt) => {
      io?.emit("autonomy:event", { runId, ...evt });
      try {
        // v1：planning/awaiting_plan_approval/paused 狀態的 run emit 刻意不寫 activity
        // （核心 timeline 由 run_started/run_done/action_*/工具呼叫構成；避免過早擴充 kind 分類）。
        const run = (evt as any).run;
        const action = (evt as any).action;
        let kind: any = null, summary = "";
        if (evt.kind === "run" && run) {
          if (run.status === "running" && run.stepCount === 0) { kind = "run_started"; summary = `自主 run 開始：${(run.goal || "").slice(0, 80)}`; }
          else if (["done", "stopped", "budget_exhausted", "error"].includes(run.status)) { kind = "run_done"; summary = `自主 run ${run.status}`; }
          else if (run.status === "running") { kind = "run_step"; summary = `第 ${run.stepCount} 步`; }
        } else if (evt.kind === "pending") { kind = "action_pending"; summary = action?.summary || "待批動作"; }
        else if (evt.kind === "action") { kind = action?.status === "rejected" ? "action_rejected" : action?.status === "pending" ? "action_approved" : null; summary = action?.summary || "動作決定"; }
        if (kind) {
          const row = logActivity({ workspaceId: run?.workspaceId || "", sessionId: run?.sessionId, runId, kind, summary });
          io?.emit("activity:event", row);
        }
      } catch (e: any) { console.warn("[autonomy] activity log", e?.message); }
    },
  };
}

autonomyRouter.post("/runs", async (req, res) => {
  const { sessionId, goal, maxSteps, maxWallMs, policy } = req.body || {};
  if (!sessionId || typeof goal !== "string" || !goal.trim()) return res.status(400).json({ error: "需要 sessionId 與非空 goal" });
  const sess = getSession(sessionId);
  if (!sess) return res.status(404).json({ error: "session 不存在" });
  if (sess.provider !== "claude") return res.status(400).json({ error: "自主迴圈本期僅支援 claude provider" });
  if (getActiveRunForSession(sessionId)) return res.status(409).json({ error: "此 session 已有進行中的 run" });
  const pol = isPolicyName(policy) ? policy : "manual";
  const deps = makeDeps(req.app.get("io"));
  const runId = await startRun(sessionId, sess.workspaceId, goal.trim(), { maxSteps, maxWallMs, policy: pol }, deps);
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
  const pending = listPending(req.params.sid);
  const enriched = pending.map((pa) => {
    if (pa.kind === "dispatch" && pa.detail) {
      const plan = parseDispatchMarker(`=== DISPATCH ===\n${pa.detail}\n=== END DISPATCH ===`);
      return { ...pa, parsedItems: plan?.items ?? [] };
    }
    return pa;
  });
  res.json({ pending: enriched });
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
autonomyRouter.post("/actions/:id/approve", (req, res) => {
  const bodyItems: DispatchItem[] | undefined = req.body?.items;
  const result = approvePendingAction(req.params.id, req.app.get("io"), bodyItems);
  if (result.status === "not_found") return res.status(404).json({ error: "action 不存在" });
  if (result.status === "already_handled") return res.status(409).json({ error: "此動作已處理過" });
  res.json({ ok: true });
});
autonomyRouter.post("/actions/:id/reject", (req, res) => {
  const result = rejectPendingAction(req.params.id);
  if (result.status === "not_found") return res.status(404).json({ error: "action 不存在" });
  if (result.status === "already_handled") return res.status(409).json({ error: "此動作已處理過" });
  res.json({ ok: true });
});
// 只有迴圈會在每輪開頭消化 pending_injection 的狀態才允許插話；
// 其餘狀態（done/stopped/paused_for_input 等）插話永遠不會被讀取，應回 409 而非靜默 200。
const INJECT_ELIGIBLE_STATUSES = ["running", "paused_for_action"];
autonomyRouter.post("/runs/:id/inject", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "run 不存在" });
  if (!INJECT_ELIGIBLE_STATUSES.includes(run.status)) {
    return res.status(409).json({ error: "run 不在可插話狀態" });
  }
  const text = String(req.body?.text || "");
  if (!text.trim()) return res.status(400).json({ error: "text 不可空" });
  setPendingInjection(req.params.id, text.trim());
  res.json({ ok: true });
});
