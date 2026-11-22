import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { loadAgents as loadAgentsImpl, AGENTS_DIR } from "../agentLoader.js";
import { logActivity } from "../store/activity.js";
import {
  getSession, listSessionsWithCounts, upsertSession,
  getWorkspace, searchSessions, aggregateTags,
  getAgentMemory, setAgentMemory, deleteAgentMemory,
  setSessionProject, appendMessage,
  DEFAULT_WORKSPACE_ID,
} from "../store.js";
import { distillAgentMemory } from "../memoryDistiller.js";
import { isCodexAvailable } from "../codexProcess.js";
import { isGeminiAvailable } from "../geminiProcess.js";
import { runConsult, startExecute, attachLateConsults } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import { createDelegation, finishDelegation } from "../store/delegations.js";
import { ledgerBegin, ledgerFinish, type DispatchLedgerContext, type DispatchLedgerDeps } from "../dispatchLedger.js";
import { notify } from "../notifier.js";
import { listGoals } from "../store/goals.js";
import { listOpen, listRecent } from "../store/outcomes.js";
import { modelFor } from "../models.js";
import { clipMiddle } from "../textClip.js";

const DISPATCH_CONCURRENCY = 3;          // 同時併發數（非總數上限）
// 單項諮詢的「同步等待」上限。240s 是舊值，被現實否決：實測 6/6 筆交辦全部撞滿 240s，
// 因為同事真的會去開瀏覽器查行情、跑 checkout 算運費、寫交付檔案。8 分鐘能同步接住大多數；
// 更長的（實測有 +495s 才收斂的）由 attachLateConsults 的遲到補報接手，不再丟答案。
const CONSULT_TIMEOUT_MS = 480_000;
const CONSULT_FEEDBACK_SENTINEL = "[[CONSULT_RESULTS]]"; // 前端據此摺疊餵回訊息
// ── 餵回 PM / 一次性整理的長度額度 ──────────────────────────────────────
// B4（2026-07）為防 PM 長對話無限膨脹設了上限，這個「有總量上限」的精神保留；但舊截法有兩個
// 與模型無關的硬傷：①每段只留開頭——同事的結論、【完成自驗】、對話的最新進展通常在最後，
// 最先被砍；②整包 slice(0, N)——第 4 位之後的同事整段消失。新模型（1M context、128K 輸出）
// 回覆更完整，舊額度砍得更兇。改成「每位公平分配額度＋保頭尾」，總量仍有上限。
/** consult 餵回 PM：全部同事合計上限（舊 10,000）。 */
export const CONSULT_FEEDBACK_TOTAL = 30_000;
/** consult 餵回 PM：單一同事上限（舊 3,000）；人多時改用總量平分。 */
export const CONSULT_FEEDBACK_PER_AGENT = 8_000;
/** 每位同事的實際額度：min(單人上限, 總量 / 人數)，最少 1,500。 */
export function consultBudgetPerAgent(n: number): number {
  return Math.max(1_500, Math.min(CONSULT_FEEDBACK_PER_AGENT, Math.floor(CONSULT_FEEDBACK_TOTAL / Math.max(1, n))));
}
/** EXEC_REPORT / LATE_CONSULT 回報上限（舊 6,000）與其中【完成自驗】段的上限（舊 2,000）。 */
export const REPORT_LIMIT = 16_000;
export const REPORT_SELF_CHECK_MAX = 4_000;
/** 對話摘要：送進模型的對話紀錄上限（舊 30,000 且只留開頭——長對話的摘要看不到最新進展）。 */
const SUMMARIZE_TRANSCRIPT_MAX = 150_000;
/** 批次整合：所有版本合計上限（舊 25,000 整包截——後面的版本整段消失），改各版本平分。 */
const MERGE_TOTAL_MAX = 100_000;
// 派工開的子 session 標題前綴——從主歷史列表隱藏（仍存 DB、仍餵學習，只是不混進你的對話歷史）。
// auto-titler 會跳過非預設標題，所以這些前綴是 durable 的。
const DISPATCH_SUB_TITLE_PREFIXES = ["🤝 受派諮詢", "🛠️ 外包執行"];

import { ORCHESTRATOR_TITLE } from "../sessionTitles.js";
import { setManualState, getSessionState, setHandoffFrom, setHandoffDoc } from "../store/sessionState.js";
import { buildHandoff, handoffPromptBlock } from "../sessionHandoff.js";
import { performHandoff } from "../handoffService.js";
import { capHandoff } from "../handoffParser.js";

export const sessionsRouter = Router();

/** Helper: extract workspace id from request query or header */
function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

sessionsRouter.get("/sessions", (req, res) => {
  // ?includeEmpty=1 to bypass filter (e.g. for sessionCounts that want totals).
  // Default: drop sessions with zero messages (殭屍 session 不該出現在歷史).
  const includeEmpty = String(req.query.includeEmpty || "") === "1";
  const out = listSessionsWithCounts(ws(req)).map((s) => ({
    ...s,
    status: agentManager.liveStatus(s.id),
  })).filter((s) => includeEmpty || s.messageCount > 0 || s.status === "busy" || s.status === "starting")
    .filter((s) => !DISPATCH_SUB_TITLE_PREFIXES.some((p) => s.title.startsWith(p)));
  res.json(out);
});

// 這場是從哪一場交接來的、帶了什麼重點（對話頂端「已帶入上一場重點」卡片用）
sessionsRouter.get("/sessions/:id/handoff", (req, res) => {
  const st = getSessionState(req.params.id);
  if (!st) return res.status(404).json({ error: "not found" });
  // handedOffTo：這場已交接出去的話，新對話是哪一場（前端「已交接」橫幅用）
  const to = st.handedOffTo ? getSession(st.handedOffTo) : undefined;
  res.json({
    handoff: st.handoffFrom ? buildHandoff(st.handoffFrom) : null,
    handedOffTo: to ? { id: to.id, title: to.title } : null,
  });
});

// 「不要帶入」：清掉交接來源。還沒開聊（0 則）就順便停掉程序，下一句話會用不含交接的 prompt 重新喚醒；
// 已經聊過就只清來源（之後喚醒時不再注入），PM 已被告知無關就忽略。
sessionsRouter.delete("/sessions/:id/handoff", (req, res) => {
  const cur = getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  setHandoffFrom(req.params.id, null);
  const restarted = (cur.messages || []).length === 0;
  if (restarted) agentManager.stop(req.params.id);
  res.json({ ok: true, restarted });
});

// 編輯帶入的交接單：只在新對話還沒有使用者訊息時允許；寫回來源場次，停掉程序讓下一句話用新版喚醒。
sessionsRouter.put("/sessions/:id/handoff", (req, res) => {
  const cur = getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const from = getSessionState(req.params.id)?.handoffFrom;
  if (!from) return res.status(400).json({ error: "這場沒有交接來源" });
  const raw = typeof req.body?.doc === "string" ? req.body.doc : "";
  if (!raw.trim()) return res.status(400).json({ error: "交接單不能是空的" });
  if ((cur.messages || []).some((m) => m.role === "user")) return res.status(409).json({ error: "已經開始對話，請直接跟專案經理說要補充什麼" });
  setHandoffDoc(from, capHandoff(raw));
  agentManager.stop(req.params.id);
  res.json({ ok: true });
});

sessionsRouter.get("/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  const live = agentManager.get(s.id);
  // liveModel：CLI 回報的實際模型（這個 process 啟動並回應過才有）；effort：本 session 帶的 --effort。
  res.json({ ...s, status: agentManager.liveStatus(s.id), liveModel: live?.model ?? null, effort: live?.effort ?? null });
});

sessionsRouter.post("/sessions", (req, res) => {
  const { agentId, title, provider, projectId } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const standing = getWorkspace(wsId)?.standingContext || "";

  let perAgent = "";
  if (agentId === "design-image-prompt-engineer") {
    perAgent = `

# Dashboard 整合提示

當你輸出最終的圖像生成 prompt 時,請**用 markdown code block 包起來,語言標籤用 \`prompt\`**,例如:

\`\`\`prompt
A cinematic portrait of...
\`\`\`

這樣 dashboard 會在這個區塊旁顯示「開啟 Gemini / ChatGPT / Midjourney」按鈕,使用者一鍵複製過去生圖。
`;
  }

  const extra = (standing ? standing : "") + perAgent;

  // Resolve provider: requested provider wins if available, else fall back to Claude
  let chosen: "claude" | "codex" | "gemini" = "claude";
  if (provider === "codex" && isCodexAvailable()) chosen = "codex";
  else if (provider === "gemini" && isGeminiAvailable()) chosen = "gemini";

  const session = agentManager.start(agentId, title, extra || undefined, wsId, true, chosen, projectId || undefined);
  res.json({ id: session.id, provider: chosen });
});

sessionsRouter.delete("/sessions/:id", (req, res) => {
  agentManager.remove(req.params.id);
  res.json({ ok: true });
});

sessionsRouter.patch("/sessions/:id", (req, res) => {
  const { title, tags, projectId } = req.body || {};
  const cur = getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  // state：手動標記完成（"done"）或重新開啟（null）。自動摘要不會覆蓋手動標記。
  if (req.body && "state" in req.body) {
    const st = req.body.state;
    if (st !== null && st !== "done" && st !== "open" && st !== "waiting_user" && st !== "parked") {
      return res.status(400).json({ error: "state 只能是 done / parked / open / waiting_user / null" });
    }
    setManualState(req.params.id, st);
    // 只改狀態就到此為止：不更新 updatedAt（標記完成/重新開啟不是對話活動，不該改變「最近一場」排序）
    if (title === undefined && tags === undefined && projectId === undefined) {
      return res.json({ ...cur, messages: undefined, state: st });
    }
  }
  const next = { ...cur };
  if (typeof title === "string") next.title = title;
  if (Array.isArray(tags)) next.tags = tags.map((t) => String(t)).filter(Boolean);
  if (projectId !== undefined) {
    setSessionProject(req.params.id, projectId || null);
    next.projectId = projectId || undefined;
  }
  next.updatedAt = Date.now();
  // Pass empty messages array to avoid wiping them — upsertSession only
  // touches messages when given a non-empty array.
  upsertSession({ ...next, messages: undefined as any });
  res.json(next);
});

// Summarize — spawns a fresh claude turn (general-purpose) that reads the
// transcript and produces a structured summary. Doesn't touch the original
// session.
sessionsRouter.post("/sessions/:id/summarize", async (req, res) => {
  const rec = getSession(req.params.id);
  if (!rec) return res.status(404).json({ error: "not found" });
  const transcript = (rec.messages || []).map((m) => {
    const who = m.role === "user" ? "USER" : m.role === "assistant" ? "ASSISTANT" : "SYSTEM";
    return `### ${who}\n${m.content}`;
  }).join("\n\n");

  const prompt = `以下是一段對話紀錄。請用繁體中文濃縮成:

1. **三句結論**(各 ≤ 30 字)
2. **五個重點**(各 ≤ 40 字)
3. **下一步建議**(1-3 條,具體可執行)

對話紀錄:
\`\`\`
${clipMiddle(transcript, SUMMARIZE_TRANSCRIPT_MAX)}
\`\`\`

只輸出結論本身,不要重複轉述對話。`;

  // Use a one-shot claude call (no agent persona) for cheap/fast summarization.
  // 走 runClaudeOneShot：spawn 失敗 / 逾時都會安全回 ok:false，不會 uncaught 崩掉 server。
  const { runClaudeOneShot } = await import("../claudeOneShot.js");
  const r = await runClaudeOneShot([
    "-p",
    "--output-format", "json",
    "--model", modelFor("balanced"),
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 300_000, source: "summarize" });
  if (!r.ok) {
    return res.status(500).json({ error: r.error || "claude 失敗" });
  }
  try {
    const j = JSON.parse(r.stdout);
    res.json({ summary: j.result || "(空)" });
  } catch (e: any) {
    res.status(500).json({ error: `parse error: ${e.message}`, raw: r.stdout.slice(0, 500) });
  }
});

// =========== Agent Memory(同事記憶 / Layer 2) ===========

sessionsRouter.get("/agent-memory", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const agentId = String(req.query.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const m = getAgentMemory(wsId, agentId);
  res.json(m || { workspaceId: wsId, agentId, content: "", updatedAt: 0, distilledFromSessionId: null });
});

sessionsRouter.put("/agent-memory", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const { agentId, content } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  setAgentMemory(wsId, agentId, String(content || ""));
  res.json({ ok: true });
});

sessionsRouter.delete("/agent-memory", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const agentId = String(req.query.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const ok = deleteAgentMemory(wsId, agentId);
  res.json({ ok });
});

// 手動觸發蒸餾 — 從某 session 抽出新版同事記憶寫入 agent_memory。
sessionsRouter.post("/agent-memory/distill", async (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const { sessionId, agentId } = req.body || {};
  if (!sessionId || !agentId) {
    return res.status(400).json({ error: "sessionId 與 agentId 都必填" });
  }
  try {
    const result = await distillAgentMemory(sessionId, wsId, agentId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// "會議室"視圖:列出該 agent 在當前工作區「有對話內容」的場次 + 每場最後一句訊息預覽。
// 給 sidebar 點擊 agent 後跳出來的 AgentMeetingRoom 組件用。
// 過濾掉 messages.length === 0 的空場次(誤點開沒講話就關掉留下的殭屍 session)。
sessionsRouter.get("/agents/:agentId/sessions", (req, res) => {
  const agentId = req.params.agentId;
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const enriched = listSessionsWithCounts(wsId)
    .filter((s) => s.agentId === agentId)
    .map((s) => ({
      id: s.id,
      title: s.title,
      tags: s.tags,
      provider: s.provider,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
      status: agentManager.liveStatus(s.id),
      lastSnippet: s.lastSnippet ? s.lastSnippet.slice(0, 120) : null,
      lastRole: s.lastRole,
    }));
  // 過濾空場次,但保留正在進行 / 剛開的(status === "busy" / "starting")
  const out = enriched.filter((s) =>
    s.messageCount > 0 || s.status === "busy" || s.status === "starting"
  );
  res.json(out);
});

sessionsRouter.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  res.json(searchSessions(q, ws(req)));
});

sessionsRouter.get("/tags", (req, res) => {
  res.json(aggregateTags(ws(req)));
});

// Batch — fan out the same prompt to N agents in parallel. Returns the
// session IDs so the client can subscribe to each via socket.io. We do NOT
// fire the messages here; the client sends `session:send` per session, which
// keeps the spawn-on-first-send semantics consistent and lets the user see
// each pane lighting up independently.
sessionsRouter.post("/batch", (req, res) => {
  const { agentIds, prompt: _prompt, label } = req.body || {};
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    return res.status(400).json({ error: "agentIds must be a non-empty array" });
  }
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const standing = getWorkspace(wsId)?.standingContext || "";
  const stamp = new Date().toLocaleString("zh-TW", { hour12: false });
  const sessions = agentIds.map((id: string) => {
    const s = agentManager.start(id, `[批次 ${label || stamp}] ${id}`, standing || undefined, wsId);
    return { sessionId: s.id, agentId: id };
  });
  res.json({ sessions });
});

// Merge best — takes N agent answers (from a batch run) and asks claude to
// synthesize the strongest combined version, citing which parts came from
// which agent.
sessionsRouter.post("/batch/merge", async (req, res) => {
  const { prompt, answers } = req.body || {};
  if (!prompt || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: "prompt and answers[] required" });
  }
  const perAnswer = Math.floor(MERGE_TOTAL_MAX / answers.length);
  const labelled = answers.map((a: any, i: number) =>
    `### 版本 ${i + 1} — ${a.agentName || a.agentId}\n${clipMiddle(String(a.text ?? ""), perAnswer, 0.5)}`
  ).join("\n\n");
  const mergePrompt = `以下是 ${answers.length} 位不同 agent 對同一個指令的回答。請整合出一個「**集眾家所長**」的最佳版本。

## 原始指令
${prompt}

## 各 agent 的回答
${labelled}

## 請輸出

1. **🏆 最佳整合版**(直接可用,不要再說「綜合各家觀點」這種廢話,直接給內容)
2. **🧩 各版本的亮點摘要**(每個 agent 一行,點出它最有價值的貢獻)
3. **⚠️ 互相衝突的地方**(若有,標出哪幾位意見不同,你採用了誰的、為什麼)

用繁體中文,Markdown 結構化。`;

  // 走 runClaudeOneShot：spawn 失敗 / 逾時安全回 ok:false，不會 uncaught 崩掉 server。
  const { runClaudeOneShot } = await import("../claudeOneShot.js");
  const r = await runClaudeOneShot([
    "-p", "--output-format", "json",
    "--model", modelFor("balanced"),
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: mergePrompt, timeoutMs: 300_000, source: "merge" });
  if (!r.ok) return res.status(500).json({ error: r.error || "claude 失敗" });
  try {
    const j = JSON.parse(r.stdout);
    res.json({ merged: j.result || "(空)" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * EXEC_REPORT 截斷但保留【完成自驗】區塊。Exported for unit testing。
 * - 長度 ≤ limit：原樣回。
 * - 超過 limit：取頭部 (limit - selfCheckMax - 200) 字 + 中略提示 +（從**最後一個**「【完成自驗】」起最多 selfCheckMax 字）。
 *   找不到自驗段時，退回原本的「頭部截斷 + 導流提示」。
 * 動機：外包回報常把最關鍵的【完成自驗】證據放尾端，粗暴 slice(0,6000) 會把它砍掉，
 * 導致 PM 收貨時看不到驗收依據。
 * 正式呼叫端傳 REPORT_LIMIT / REPORT_SELF_CHECK_MAX；預設參數（6000/2000）保留舊行為供測試與相容。
 */
export function trimReportKeepSelfCheck(text: string, limit = 6000, selfCheckMax = 2000): string {
  if (text.length <= limit) return text;
  const headLen = Math.max(0, limit - (selfCheckMax + 200));
  const head = text.slice(0, headLen);
  const marker = "【完成自驗】";
  const idx = text.lastIndexOf(marker);
  if (idx === -1) {
    // 無自驗段 → 頭部截斷 + 導流提示（維持舊行為語意）。
    return head + "\n…（完整回覆見該同事的子對話）";
  }
  const selfCheck = text.slice(idx).slice(0, selfCheckMax);
  return head + "\n…（中略，完整見子對話）\n" + selfCheck;
}

/**
 * Truncate catalog description to CATALOG_DESC_MAX chars + ellipsis. Exported for unit testing.
 * 舊值 60：212 位同事的描述只剩第一句，專案經理很難分辨相近的專家。放寬到 100，並允許它在需要時
 * 直接讀同事的完整人設檔（見 buildOrchestratorSeed）——新模型擅長按需查資料，不必把全部人設塞進 prompt。
 */
export const CATALOG_DESC_MAX = 100;
export function truncateForCatalog(desc: string, limit = CATALOG_DESC_MAX): string {
  // 以 code point 為單位截斷（[...desc]），避免 String.slice 把 emoji 等
  // astral 字元切成 lone surrogate——那會讓整包 prompt 變非法 UTF-8 被 API 拒收。
  const chars = [...desc];
  return chars.length > limit ? chars.slice(0, limit).join("") + "…" : desc;
}

// ─── POST /orchestrator（使用共用 seeding）──────────────────────────────────────

// Orchestrator (Project Manager) — uses the built-in `agents-orchestrator`
// agent and supplements its system prompt with the live catalog of agents
// so it can recommend who to call for a given project.
sessionsRouter.post("/orchestrator", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const projectId = (req.body?.projectId || req.query.projectId) as string | undefined;
  // 選填 title：總管簡報「展開討論」帶項目標題，之後同項目可接回同一場而非每天多一場
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 60) : "";
  // 選填 handoffFrom：「＋ 開新話題」時帶入上一場重點（只帶一場）；同工作區才接受（見 startOrchestratorWithHandoff）
  const handoffFrom = typeof req.body?.handoffFrom === "string" ? req.body.handoffFrom : "";
  res.json({ id: startOrchestratorWithHandoff(wsId, { title, projectId, handoffFrom }) });
});

/**
 * 開一場有完整 seeding 的互動專案經理對話；handoffFrom 同工作區才帶入。
 * POST /orchestrator 與「一句話交接」（handoffService）共用。
 */
export function startOrchestratorWithHandoff(wsId: string, opts: { title?: string; projectId?: string; handoffFrom?: string } = {}): string {
  // 使用共用 seeding 函式（與 watchtower 升級路徑同一套 dispatchGuide + catalog + goals）
  const { systemExtra, standing } = buildOrchestratorSeed(wsId);
  const fromId = opts.handoffFrom || "";
  const fromSess = fromId ? getSession(fromId) : undefined;
  const handoff = fromSess && (fromSess.workspaceId || DEFAULT_WORKSPACE_ID) === wsId ? buildHandoff(fromId) : null;
  const session = agentManager.start("agents-orchestrator", opts.title || ORCHESTRATOR_TITLE, standing + systemExtra + (handoff ? handoffPromptBlock(handoff) : ""), wsId, false, "claude", opts.projectId || undefined);
  if (handoff) setHandoffFrom(session.id, handoff.fromId);
  return session.id;
}

// PM 輸出 HANDOFF 標記時：存交接單 → 開新對話帶入 → 舊對話標已交接 → 通知前端切換。
// 在這裡註冊（agentManager 不 import routes，避免循環依賴；仿 registerSeedBuilder）。
agentManager.registerHandoffHandler?.((fromId, doc, io) => {
  const r = performHandoff(fromId, doc, {
    start: (wsId, o) => startOrchestratorWithHandoff(wsId, o),
    stop: (id) => agentManager.stop(id),
    emit: (ev, p) => io?.emit(ev, p),
  });
  if (!r.ok) console.warn(`[handoff] ${fromId.slice(0, 8)} 失敗：${r.error}`);
});

// ─── Orchestrator Seeding（可重用）────────────────────────────────────────────

/**
 * 組裝 PM（agents-orchestrator）session 開場所需的完整 system prompt 附加內容。
 * 包含：dispatchGuide + catalog + active goals + open outcomes。
 *
 * 供 POST /orchestrator（互動）與 watchtower 升級（無人值守）共用，
 * 確保自主 run 拿得到派工手冊與團隊名單，實際會派工而不是空轉。
 */
export function buildOrchestratorSeed(wsId: string): { systemExtra: string; standing: string } {
  const allAgents = loadAgentsImpl();
  const catalog = allAgents
    .map((a) => `- [${a.category}] \`${a.id}\` — ${a.name}: ${truncateForCatalog(a.description)}`)
    .join("\n");

  // (dispatchGuide 內容與下方 POST /orchestrator 路由完全相同，同步維護)
  const dispatchGuide = buildDispatchGuide();

  const extra = `\n\n# 你目前可動用的團隊（${allAgents.length} 位）\n
請以「專案經理」身份替使用者把事辦完：理解目標 → 挑最合適的同事 → 用 DISPATCH 直接派工 → 驗收 → 交成果。不要只給「建議找誰」讓使用者自己去開對話。
回覆用 Markdown，提到同事時用反引號包住其 \`agent-id\`。
清單裡的描述是摘要；幾位人選相近、需要看專長細節才能決定時，可以直接讀 \`${AGENTS_DIR.replace(/\\/g, "/")}/<agent-id>.md\`（同事的完整人設）。
${dispatchGuide}${buildHandoffGuide()}
可用團隊清單：
${catalog}
`;

  const standing = getWorkspace(wsId)?.standingContext || "";

  const activeGoals = listGoals(wsId, "active").slice(0, 10);
  let goalsBlock = "";
  if (activeGoals.length > 0) {
    const goalLines = activeGoals.map((g) => {
      const parts = [`- [${g.id}] ${g.title}`];
      if (g.metric || g.currentValue || g.targetValue) {
        parts.push(`｜指標:${g.metric || "—"} 現在 ${g.currentValue || "—"}/目標 ${g.targetValue || "—"}`);
      }
      if (g.deadline) parts.push(`｜期限 ${g.deadline}`);
      return parts.join("");
    });
    goalsBlock = `\n\n# 🎯 這個工作區的目標帳本（你要主動追）\n${goalLines.join("\n")}\n（開場時若對話與目標相關，先錨定進度：「我們說好 X，目前 Z」。使用者回報新進度時，可直接吐 \`=== GOAL_UPDATE: <上方方括號內的目標id> | <新現值> ===\` 標記讓系統自動更新現值；或請使用者到 🎯 目標面板手動更新。沒有 active 目標時本區塊不出現。）`;
  }

  const openOutcomes = listOpen(wsId);
  const recentOutcomes = listRecent(wsId, 5);
  let outcomesBlock = "";
  if (openOutcomes.length > 0 || recentOutcomes.length > 0) {
    const lines: string[] = [];
    if (openOutcomes.length > 0) {
      lines.push("待回訪（該追現實結果了）：");
      for (const o of openOutcomes.slice(0, 10)) {
        const flag = o.status === "notified" ? "（已提醒使用者）" : "";
        lines.push(`- [${o.id}] ${o.description}${flag}`);
      }
    }
    if (recentOutcomes.length > 0) {
      lines.push("近期已回填的成效：");
      for (const o of recentOutcomes) {
        lines.push(`- ${o.description} → ${o.result}`);
      }
    }
    outcomesBlock = `\n\n# 📈 成效回訪（對外交辦的現實結果）\n${lines.join("\n")}\n（有待回訪且對話相關時，主動問使用者現況並請他到 📈 成效面板填結果。沒有回訪時本區塊不出現。）`;
  }

  return {
    systemExtra: extra + goalsBlock + outcomesBlock,
    standing,
  };
}

/**
 * 開一個有完整 seeding 的 PM session（agentManager.start）並回傳 session id。
 * watchtower 升級路徑呼叫此函式，確保 PM 拿到 dispatchGuide + catalog + goals。
 * enableAutoFork=false（無人值守背景 session）。
 */
export function startOrchestratorSession(wsId: string, title: string, projectId?: string): string {
  const { systemExtra, standing } = buildOrchestratorSeed(wsId);
  const session = agentManager.start(
    "agents-orchestrator",
    title,
    standing + systemExtra,
    wsId,
    false, // enableAutoFork=false，對齊 scheduler.ts 背景 session 模式
    "claude",
    projectId,
  );
  return session.id;
}

// 專案經理的額外 prompt（派工手冊＋團隊名單＋目標帳本）在 reattach 時重新產生——
// 喚醒舊對話也拿得到最新的同事名單與目標（見 agentManager.registerSeedBuilder）。
agentManager.registerSeedBuilder?.("agents-orchestrator", (wsId, sessionId) => {
  const { systemExtra, standing } = buildOrchestratorSeed(wsId);
  // 喚醒時保留開場那段「上一場交接」（否則閒置回收後再聊，交接內容就從 prompt 消失）
  const from = getSessionState(sessionId)?.handoffFrom;
  const handoff = from ? buildHandoff(from) : null;
  return standing + systemExtra + (handoff ? handoffPromptBlock(handoff) : "");
});

/**
 * PM 手冊的「交接」段：使用者說交接 → PM 輸出 HANDOFF 標記（agentManager 偵測、handoffService 處理）。
 * 獨立於 buildDispatchGuide：派工手冊有瘦身守護（dispatchGuide.test.ts，< 3,500 字），交接段另計。
 */
function buildHandoffGuide(): string {
  return `
## 🔁 交接
使用者說要交接、換新對話、整理交接、對話太長要換一場時：讀完整場，輸出一份交接單（只輸出這一份，不要問要不要交接）：
=== HANDOFF ===
🎯 目標：這場要達成什麼
✅ 已決定：談定、不要再重問的事（含數字與理由）
🔄 進行中：交辦了一半的工作、等誰回報
⏭️ 下一步：接手後第一件要做的事
❓ 等你拍板：需要使用者決定的事
📎 重要資料：數字、連結、檔案路徑
=== END HANDOFF ===
沒有內容的欄位寫「無」。2000 字內。系統會自動開新對話並帶入，你只要在交接單前用一句話說「交接單整理好了」。
`;
}

/** dispatchGuide 字串（從 POST /orchestrator 路由獨立出來以便 buildOrchestratorSeed 複用）。*/
function buildDispatchGuide(): string {
  return `
你是**主管**不是傳聲筒：使用者交代一件事，你負責**完整辦妥**——派工、驗收、不合格退回重做、交出成果。

## 第 0 步：先想好預設做法直接開工，必要才問，而且一次問完

先想清楚目標與驗收、範圍、期限預算、既有素材與決定；查得到的自己查。

1. **預設是直接做**：模糊處用最合理的**預設**補上，寫進 context，回覆列一行「我的假設：…（不對隨時講）」就派工。
2. **猜錯代價大**（白做一大段、花錢、收不回）才問，**一次問完**（1–3 題），每題附選項與建議，使用者回「照你建議」就能走：
   - **問題 N**：<具體、好回答；能給選項就給 A/B/C>
   - **我的建議**：<你會怎麼選、為什麼>
3. 問題只卡一段時，其他段先派工。
4. 使用者說「grill me」「先問清楚」才逐題追問，問完給「✅ 確認清單」等 OK 才派工。
5. 無人值守（排程、自走、背景）時不要問，寫清假設直接做。

## 做到完才回報（目標導向）

- 沒達成就**繼續推進**：不合格自己退回重做，下一步判斷得出來就直接派。**不要問「要不要繼續」「續做還是到此」**——交代的範圍就是要做完。
- 只有三種情況停下：①要只有使用者給得了的東西（實物照片、帳密、偏好拍板）②對外動作（系統跳批准卡）③預算／法規硬限制。停下時一次講清缺什麼，其他先做完。
- 收尾給 **「📦 成果報告」**：①做完什麼（附檔案路徑／連結）②驗收結果與未驗證的風險 ③**只剩你要做的事**（沒有就寫「辦完了」）。結尾不附「要不要我…」選單。

## 第 1 步：選對模式（consult vs execute vs workflow）

- **consult（諮詢．同步）**：要**意見／分析／建議**，同事回一段文字，收齊後你**整合**成給使用者的答覆。例：「這份合約有哪些風險條款」。
- **execute（外包執行．背景非同步，可能跑很久）**：要同事**實際動手把一件事做完**（操作工具、產檔案、跑流程），完成時系統把回報餵回給你；回報必附**【完成自驗】證據區塊**（做了什麼／怎麼驗證／證據／結論），是你之後驗收的依據。例：「把這 10 張圖去背並輸出 PNG」。
- **workflow（可重跑流程）**：**會一直重複跑的多步流程**（每週內容生產、新客戶提案 SOP），不用 DISPATCH，改提議排成可存可重跑的 workflow。

判準速記：要想法 → consult；要把事做完 → execute；會重複的多步 SOP → workflow。同一張 DISPATCH 裡 consult 與 execute 可混用。

## 第 2 步：下清楚的「交辦契約」（不是一行字）

同事**看不到你和使用者的對話**，只看得到 task 裡的內容，所以把方向、背景、交付物、驗收標準寫清楚，否則同事只能猜。輸出下列標記（**只寫計畫、不要自己代答**）。內部工作系統會**直接執行**，只有對外動作會跳批准卡：

\`\`\`
=== DISPATCH ===
- agentId: <團隊清單中的 id>
  mode: consult | execute
  task: 這位同事要做的事（可多行；延續行比 "task:" 欄位名多縮排即可）。
  context: 從你和使用者的對話摘要出的背景（同事看不到那段對話，這是做對方向的關鍵）。
  deliverable: 交付物長什麼樣（格式、數量、範例、放哪）。
  accept:
    - 驗收標準（可檢查、不含糊，最多 3 條）
- agentId: <下一位同事的 id>
  task: ...
=== END DISPATCH ===
\`\`\`

**欄位規則**：
- \`agentId\`：必填，必須完全來自下方團隊清單；以 \`- agentId:\` 開頭代表一個新派工項。
- \`mode\`：\`consult\` 或 \`execute\`；省略預設 \`consult\`。
- \`task\`：必填，可多行——延續行只要比欄位名多縮排，直到下一個欄位名或下一個 \`- agentId:\`；context/deliverable 多行規則相同。
- \`context\`、\`deliverable\`、\`accept\`：選填但**強烈建議**（execute 幾乎必寫 accept）。accept 寫成 \`-\` 子項（通常 1-3 條，複雜任務最多 6 條），是你之後收貨逐條驗收的依據。
- 只寫 \`agentId\`+\`task\` 的單行舊格式仍有效（向後相容），能補 context/deliverable/accept 就補。
- \`external: true\`：會**對外**（上架、發文、寄信、私訊、付款、刪除、登入帳號）就要寫，系統會等使用者批准；拿不準就寫。對外最好拆兩張：先派內部準備，驗收好再派對外那張，使用者只批最後一步。
- 寫完標記後，用一句話告訴使用者「已交辦 X、Y，做完我驗收後回報」（有對外項就說「X 要上架，請按批准卡」），**不要自己代答**。

**範例（execute，帶完整契約）**：
\`\`\`
=== DISPATCH ===
- agentId: ecommerce-ops
  mode: execute
  task: 把附件 CSV 裡的 8 件商品上架到蝦皮賣場，含標題、售價、庫存、主圖。
  context: 使用者是賣手工皂的個人賣家，品牌調性走天然溫暖，標題要放關鍵字
    但不要浮誇。售價欄已含利潤，直接用。
  deliverable: 8 件商品都在蝦皮後台成上架狀態，回報時附每件的商品連結。
  accept:
    - 8 件全部上架成功，無草稿卡住
    - 每件標題含至少一個搜尋關鍵字
    - 回報附【完成自驗】並列出 8 個商品連結當證據
=== END DISPATCH ===
\`\`\`

## 重複性多步流程 → 排成 Workflow（而非 DISPATCH）

會重複跑的多步流程，輸出 \`\`\`workflow JSON，系統跳出「套用為 Workflow」按鈕；step 的 agentId 須來自下方清單，可用 \`{{stepId.out}}\` 傳遞前一步輸出。
\`\`\`workflow
{"name":"每週內容生產","steps":[{"id":"r","agentId":"marketing-trend-researcher","prompt":"本週選題"},{"id":"ig","agentId":"marketing-content-creator","dependsOn":["r"],"prompt":"改寫成 IG：{{r.out}}"}]}
\`\`\`

## 第 3 步：收貨要驗收（不要當傳聲筒）

同事回報後，你不是照抄轉達，而是**主管收貨**：
1. **逐條對照你當初下的 \`accept\` 驗收標準**檢查；execute 特別看**【完成自驗】區塊**的證據與結論（已驗證完成／部分完成／未完成）。
2. 證據不足、或結論是「部分完成／未驗證／未完成」時，**不要粉飾**。首選**退回重做一次**（再開一張 DISPATCH，task 裡具體講清楚缺什麼、要補什麼證據）；無法自行補救就明確告知使用者「只做到 X、Y 未驗證、風險是 ___」讓使用者決定。
3. 全部達標，才整合成給使用者的答覆——可以精簡，但要**誠實反映品質**。

## 收尾：對外發布類要掛成效回訪
對外發布/上架/寄出類的 execute 完成後（上架、發文、寄提案信…），現實結果不會馬上知道。主動吐
\`=== FOLLOWUP: <N>d | <要查什麼> ===\`（N=天數，可小數，上限 90）掛成效回訪，到期系統會提醒使用者回填結果。
例：\`=== FOLLOWUP: 7d | 露天 Hairball 那檔有沒有詢問/成交 ===\`。
`;
}

/**
 * 派工執行核心 —— 跑 consult/execute 並把結果餵回 PM。
 * 從舊 POST /orchestrator/:id/dispatch route body 抽出，供 route 與 autonomy approve handler 共用。
 * 行為與原 route 完全一致：validIds 過濾 → startExecute 背景跑 → runConsult 同步並行 → 餵回 PM。
 * 注意：HTTP 守衛（404 無 pm / 400 空 items / 400 無有效項）仍留在 route 與 caller，不在此函式。
 */
export async function executeDispatch(
  pmSessionId: string,
  items: DispatchItem[],
  io: any,
  opts?: { approvalNote?: string },
): Promise<{ consulted: Awaited<ReturnType<typeof runConsult>>; executing: { subSessionId: string; agentId: string }[] }> {
  const pm = getSession(pmSessionId);
  const workspaceId = pm?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  try { const row = logActivity({ workspaceId, sessionId: pmSessionId, kind: "dispatch", summary: `派工 ${items.length} 項` }); io?.emit("activity:event", row); } catch {}
  const validIds = new Set(loadAgentsImpl().map((a) => a.id));
  const consult = items.filter((i) => i.mode !== "execute" && validIds.has(i.agentId) && i.task);
  const execute = items.filter((i) => i.mode === "execute" && validIds.has(i.agentId) && i.task);

  const nameOf = new Map(loadAgentsImpl().map((a) => [a.id, a.name]));

  // 台帳/推播共用層：手動路徑與自主路徑收斂到同一套 ledgerBegin/ledgerFinish 原子。
  // 用明確的 delegationId 綁生命週期（不靠 agentId 比對）；nameOf 沿用本地 map，推播文字不變。
  const ledgerCtx: DispatchLedgerContext = { pmSessionId, workspaceId };
  const ledger: DispatchLedgerDeps = {
    createDelegation, finishDelegation,
    notify: (e) => { void notify(e); },
    nameOf: (id) => nameOf.get(id) ?? id,
  };

  // execute：背景跑、不等完成；完成時把結果餵回 PM（PM 貼回報）+ socket 通知前端 toast。
  let executing: { subSessionId: string; agentId: string }[] = [];
  if (execute.length > 0) {
    // 記帳：execute 開始時建台帳（subSessionId 在 startExecute 之後才知道，故先建再更新）
    // 旁路：記帳/推播失敗不可讓派工崩，全在 ledgerBegin/ledgerFinish 內 try/catch。
    const execDelegIds = new Map<string, string>(); // subSessionId → delegationId
    executing = startExecute(execute, workspaceId, pmSessionId, (d) => {
      // 記帳＋推播：完成時 finishDelegation（回填 subSessionId）＋ execute 推播（交辦完成/失敗）
      const item = execute.find((i) => i.agentId === d.agentId) ?? { agentId: d.agentId, mode: "execute" as const, task: "" };
      ledgerFinish(execDelegIds.get(d.subSessionId), item, { ok: d.status === "ok", output: d.output, subSessionId: d.subSessionId }, ledger);
      const label = nameOf.get(d.agentId) ?? d.agentId;
      const report = `[[EXEC_REPORT]]\n同事「${label}」回報外包任務${d.status === "ok" ? "完成" : "失敗/未完成"}：\n\n${trimReportKeepSelfCheck(d.output, REPORT_LIMIT, REPORT_SELF_CHECK_MAX)}\n\n你是收貨的主管，不是傳聲筒。請照這個順序處理：\n1) 對照你當初交辦時下的 accept 驗收標準，逐條檢查這份回報是否達成；特別檢視最後的【完成自驗】區塊——做了什麼、怎麼驗證、證據夠不夠、結論是「已驗證完成／部分完成／未完成」。\n2) 若證據不足、或結論是部分完成／未驗證／未完成：**不要粉飾**。優先**退回這位同事重做一次**（再開一張 DISPATCH，在 task 裡具體講清楚缺什麼、要補什麼證據）；若無法自行補救，就明確向使用者標示「只做到 X、還沒驗證 Y、風險是 ___」讓使用者決定。\n3) 驗收通過才向使用者轉達；可以精簡，但要誠實反映品質，不要把「部分完成」講成「完成」。`;
      agentManager.send(d.pmSessionId, report);
      io?.to(`session:${d.pmSessionId}`).emit("session:event", { sessionId: d.pmSessionId, type: "dispatch:done", payload: { agentId: d.agentId, status: d.status } });
    });
    // 記帳：startExecute 回傳 handle 後才有 subSessionId，此時建台帳（帶 subSessionId）
    for (const handle of executing) {
      const item = execute.find((i) => i.agentId === handle.agentId);
      if (!item) continue;
      const delegId = ledgerBegin(ledgerCtx, item, ledger, handle.subSessionId);
      if (delegId) execDelegIds.set(handle.subSessionId, delegId);
    }
  }

  // consult：同步並行跑、收齊後餵回 PM 整合（PM 串流經既有 session-room forward 自動到前端）。
  let consulted: Awaited<ReturnType<typeof runConsult>> = [];
  if (consult.length > 0) {
    // A1：核可後、開始跑 runConsult（單項最長 4 分鐘）前，立刻在 PM session 插一則
    // 「不打 LLM」的系統說明訊息，讓使用者不再面對沉默黑洞。走 appendMessage(role:system)
    // + socket 廣播（type:"system-note"）——刻意不走 agentManager.send，才不會觸發 PM 的 LLM 回合。
    const consultNames = consult.map((i) => nameOf.get(i.agentId) ?? i.agentId).join("、");
    const ackNote = `🤝 已交辦給 ${consultNames}，正在等回覆（單項最長 8 分鐘；超過會轉背景繼續跑，做完自動補報）…`;
    try {
      appendMessage(pmSessionId, { role: "system", content: ackNote, ts: Date.now() });
      io?.to(`session:${pmSessionId}`).emit("session:event", { sessionId: pmSessionId, type: "system-note", payload: { content: ackNote } });
    } catch {}
    // 記帳：consult 開始前建台帳。用「索引」綁 delegationId（runConsult 保序，consulted[i]↔consult[i]），
    // 取代舊的 agentId||task 比對——同 agent 重複派工也不會誤配。
    const consultDelegIds = consult.map((item) => ledgerBegin(ledgerCtx, item, ledger));
    consulted = await runConsult(consult, workspaceId, {
      concurrency: DISPATCH_CONCURRENCY,
      perItemTimeoutMs: CONSULT_TIMEOUT_MS,
    });
    // 記帳：consult 完成後 finish（consult 不推播；回填最後一次嘗試的 subSessionId 供深聊）
    consulted.forEach((r, i) => {
      ledgerFinish(consultDelegIds[i], consult[i], { ok: r.status === "ok", output: r.output, subSessionId: r.subSessionId }, ledger);
    });
    // 逾時項掛遲到補報：逾時不殺子程序，同事通常會在之後幾分鐘把結論做完。
    // 舊版沒人收，結論就爛在 DB 裡（實測 6/6 筆全滅）。這裡把回流補起來：
    // 結論到了 → 更新台帳（failed→done）＋ 回報 PM，PM 再據此向使用者補一則更新。
    attachLateConsults(consulted, (late) => {
      const item = consult[late.index];
      ledgerFinish(consultDelegIds[late.index], item, { ok: late.ok, output: late.output, subSessionId: late.subSessionId }, ledger);
      const label = nameOf.get(late.agentId) ?? late.agentId;
      if (!late.ok) {
        // 補回來的不是結論（例如 Claude 額度用盡的通知）→ 誠實告知 PM 這部分落空，不要當結論轉述。
        agentManager.send(pmSessionId, `[[LATE_CONSULT]]\n同事「${label}」先前逾時未回，後來也沒能交出結論（${late.output.slice(0, 300)}）。你稍早收到的「未完成的過程訊息」同樣不可當數據。若你先前跟使用者說過「結論到了再補」，現在請主動告知這部分沒有取得結論，並建議下一步（重問、縮小範圍或改由使用者處理）。`);
        io?.to(`session:${pmSessionId}`).emit("session:event", { sessionId: pmSessionId, type: "dispatch:done", payload: { agentId: late.agentId, status: "late" } });
        return;
      }
      const report = `[[LATE_CONSULT]]\n同事「${label}」先前逾時未回，現在把結論補交回來了。**以這份為準**——你稍早收到的那份「未完成的過程訊息」作廢，不要拿它當數據。\n\n交辦的任務：${item.task.slice(0, 200)}\n\n${trimReportKeepSelfCheck(late.output, REPORT_LIMIT, REPORT_SELF_CHECK_MAX)}\n\n請照主管收貨的標準處理：\n1) 對照你當初下的 accept／問題焦點，檢查這份補報有沒有真的回答到問題。\n2) 若你先前已經用「未取得回覆／逾時」向使用者交代過這位同事，現在**主動補一則更新**告訴使用者結論來了，並整合進先前的答覆。\n3) 若補報仍不足，就明確標示哪裡沒答到，不要用空話填補。`;
      agentManager.send(pmSessionId, report);
      io?.to(`session:${pmSessionId}`).emit("session:event", { sessionId: pmSessionId, type: "dispatch:done", payload: { agentId: late.agentId, status: "late" } });
    });
    const perAgent = consultBudgetPerAgent(consulted.length);
    const labelled = consulted
      .map((r) => {
        const raw = r.output || "（未取得回覆）";
        // 保頭尾（結論通常在最後）；額度由人數平分，總量 ≤ CONSULT_FEEDBACK_TOTAL。
        const out = [...raw].length > perAgent ? clipMiddle(raw, perAgent, 0.4) + "\n…（完整回覆見該同事的子對話）" : raw;
        return `### ${nameOf.get(r.agentId) ?? r.agentId}（${r.status}）\n${out}`;
      })
      .join("\n\n");
    // B5：部分核可時，在回饋開頭附一句「哪些被拿掉」，PM 才知道全貌。
    const notePrefix = opts?.approvalNote ? `${opts.approvalNote}\n\n` : "";
    const feedback = `${CONSULT_FEEDBACK_SENTINEL}\n${notePrefix}以下是你委派同事的回覆。你是主管，不是照單整合的貼上機——先判斷品質，再整合：\n1) 對照你當初交辦時下的 accept／問題焦點，逐位檢查：這份回覆有沒有**真的回答到問題**？是泛泛而談、還是離題、還是漏了關鍵面向？\n2) 若某位回覆不足、離題或明顯漏答：不要硬把它塞進整合。可以**補問一次**（再開一張 DISPATCH 把問題問得更精準），或在整合時**明確標示「這部分尚未得到有效回答」**，不要用空話填補。\n3) 標著（timeout）的同事：他**還在背景把結論做完，稍後會自動補報**。他這段內容是「未完成的過程訊息」，**絕不可當結論採用或拿去填答**——請如實告訴使用者「這部分還在跑，結論到了我再補」，不要編一個看起來完整的答案。\n4) 標著（error）的同事就說明未能取得。\n5) 通過檢查的內容，**整合成一段給使用者的回覆**（衝突處註明採用誰、為什麼）。\n\n${labelled}`;
    agentManager.send(pmSessionId, feedback);
  } else if (execute.length > 0) {
    // 只有 execute：請 PM 先回一句「已交辦」。B5：部分核可時附上被拿掉的清單。
    const notePrefix = opts?.approvalNote ? `${opts.approvalNote}\n` : "";
    agentManager.send(pmSessionId, `[[EXEC_ACK]]\n${notePrefix}你已把 ${execute.length} 件外包任務交辦出去（背景進行中），請用一句話告訴使用者「已交辦，完成會回報」。`);
  }

  return { consulted, executing };
}

// PM 派工 — 接收已批准的計畫，實際跑子 agent。切片① 僅 consult（execute 見切片②）。
sessionsRouter.post("/orchestrator/:sessionId/dispatch", async (req, res) => {
  const pmSessionId = req.params.sessionId;
  const pm = getSession(pmSessionId);
  if (!pm) return res.status(404).json({ error: "PM session 不存在，請重開專案經理對話" });
  const items: DispatchItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: "items 不可為空" });

  const validIds = new Set(loadAgentsImpl().map((a) => a.id));
  const valid = items.filter((i) => validIds.has(i.agentId) && i.task);
  if (valid.length === 0) {
    return res.status(400).json({ error: "沒有有效的派工項（agentId 須在團隊清單內、且要有 task）" });
  }

  try {
    const out = await executeDispatch(pmSessionId, valid, req.app.get("io"));
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});
