import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { loadAgents as loadAgentsImpl } from "../agentLoader.js";
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
import { runConsult, startExecute } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";
import { createDelegation, finishDelegation } from "../store/delegations.js";
import { ledgerBegin, ledgerFinish, type DispatchLedgerContext, type DispatchLedgerDeps } from "../dispatchLedger.js";
import { notify } from "../notifier.js";
import { listGoals } from "../store/goals.js";
import { listOpen, listRecent } from "../store/outcomes.js";

const DISPATCH_CONCURRENCY = 3;          // 同時併發數（非總數上限）
const CONSULT_TIMEOUT_MS = 240_000;      // 單項諮詢逾時（實質專家回答常需 1-3 分鐘）
const CONSULT_FEEDBACK_SENTINEL = "[[CONSULT_RESULTS]]"; // 前端據此摺疊餵回訊息
// 派工開的子 session 標題前綴——從主歷史列表隱藏（仍存 DB、仍餵學習，只是不混進你的對話歷史）。
// auto-titler 會跳過非預設標題，所以這些前綴是 durable 的。
const DISPATCH_SUB_TITLE_PREFIXES = ["🤝 受派諮詢", "🛠️ 外包執行"];

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

sessionsRouter.get("/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ ...s, status: agentManager.liveStatus(s.id) });
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
${transcript.slice(0, 30000)}
\`\`\`

只輸出結論本身,不要重複轉述對話。`;

  // Use a one-shot claude call (no agent persona) for cheap/fast summarization.
  // 走 runClaudeOneShot：spawn 失敗 / 逾時都會安全回 ok:false，不會 uncaught 崩掉 server。
  const { runClaudeOneShot } = await import("../claudeOneShot.js");
  const r = await runClaudeOneShot([
    "-p",
    "--output-format", "json",
    "--model", "claude-sonnet-4-6",
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 180_000, source: "summarize" });
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
  const labelled = answers.map((a: any, i: number) =>
    `### 版本 ${i + 1} — ${a.agentName || a.agentId}\n${a.text}`
  ).join("\n\n");
  const mergePrompt = `以下是 ${answers.length} 位不同 agent 對同一個指令的回答。請整合出一個「**集眾家所長**」的最佳版本。

## 原始指令
${prompt}

## 各 agent 的回答
${labelled.slice(0, 25000)}

## 請輸出

1. **🏆 最佳整合版**(直接可用,不要再說「綜合各家觀點」這種廢話,直接給內容)
2. **🧩 各版本的亮點摘要**(每個 agent 一行,點出它最有價值的貢獻)
3. **⚠️ 互相衝突的地方**(若有,標出哪幾位意見不同,你採用了誰的、為什麼)

用繁體中文,Markdown 結構化。`;

  // 走 runClaudeOneShot：spawn 失敗 / 逾時安全回 ok:false，不會 uncaught 崩掉 server。
  const { runClaudeOneShot } = await import("../claudeOneShot.js");
  const r = await runClaudeOneShot([
    "-p", "--output-format", "json",
    "--model", "claude-sonnet-4-6",
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: mergePrompt, timeoutMs: 180_000, source: "merge" });
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
 * - 超過 limit：取頭部 (limit-2200) 字 + 中略提示 +（從**最後一個**「【完成自驗】」起最多 2000 字）。
 *   找不到自驗段時，退回原本的「頭部截斷 + 導流提示」。
 * 動機：外包回報常把最關鍵的【完成自驗】證據放尾端，粗暴 slice(0,6000) 會把它砍掉，
 * 導致 PM 收貨時看不到驗收依據。
 */
export function trimReportKeepSelfCheck(text: string, limit = 6000): string {
  if (text.length <= limit) return text;
  const headLen = Math.max(0, limit - 2200);
  const head = text.slice(0, headLen);
  const marker = "【完成自驗】";
  const idx = text.lastIndexOf(marker);
  if (idx === -1) {
    // 無自驗段 → 頭部截斷 + 導流提示（維持舊行為語意）。
    return head + "\n…（完整回覆見該同事的子對話）";
  }
  const selfCheck = text.slice(idx).slice(0, 2000);
  return head + "\n…（中略，完整見子對話）\n" + selfCheck;
}

/** Truncate catalog description to 60 chars + ellipsis. Exported for unit testing. */
export function truncateForCatalog(desc: string, limit = 60): string {
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
  const orchProjectId = (req.body?.projectId || req.query.projectId) as string | undefined;
  // 使用共用 seeding 函式（與 watchtower 升級路徑同一套 dispatchGuide + catalog + goals）
  const { systemExtra, standing } = buildOrchestratorSeed(wsId);
  const session = agentManager.start("agents-orchestrator", "👨‍💼 專案經理", standing + systemExtra, wsId, false, "claude", orchProjectId || undefined);
  res.json({ id: session.id });
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
請以「專案經理」身份協助使用者：(1) 釐清需求 (2) 推薦最合適的 agent 組合 (3) 建議如何派工。
回覆時請用 Markdown，並在推薦 agent 時用反引號包住其 \`agent-id\`，方便使用者複製對應名稱去儀表板開啟對話。
${dispatchGuide}
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

/** dispatchGuide 字串（從 POST /orchestrator 路由獨立出來以便 buildOrchestratorSeed 複用）。*/
function buildDispatchGuide(): string {
  return `
你不是傳聲筒，你是**主管**：交辦前問清楚、交辦時下清楚的契約、收貨時逐條驗收，不合格就退回重做。

## 第 0 步：交辦前先釐清（不清楚就不要急著派工）

先自問這三件事是否清楚：
1. **目標與驗收**：要達成什麼結果？怎樣算做好、有沒有可檢查的驗收點？
2. **受眾與範圍**：給誰用、在哪用？要做到哪、不用做哪？
3. **期限或預算**：急不急？有沒有成本／字數／篇幅上限？

任一項模糊，先問使用者 1-3 個結構化釐清問題，每題格式：
- **問題**：<具體、封閉、好回答>
- **為什麼需要知道**：<答案怎麼影響交辦方向>
- **我的預設假設**：<若不回，我先假設 ___ 往下走>

寧可多問一句，不要讓同事做錯方向白跑一趟。

## 第 1 步：選對模式（consult vs execute vs workflow）

- **consult（諮詢．同步）**：要**意見／分析／建議**，同事回一段文字，收齊後你**整合**成給使用者的答覆。例：「這份合約有哪些風險條款」。
- **execute（外包執行．背景非同步，可能跑很久）**：要同事**實際動手把一件事做完**（操作工具、產檔案、跑流程），完成時系統把回報餵回給你；回報必附**【完成自驗】證據區塊**（做了什麼／怎麼驗證／證據／結論），是你之後驗收的依據。例：「把這 10 張圖去背並輸出 PNG」。
- **workflow（可重跑流程）**：**會一直重複跑的多步流程**（每週內容生產、新客戶提案 SOP），不用 DISPATCH，改提議排成可存可重跑的 workflow。

判準速記：要想法 → consult；要把事做完 → execute；會重複的多步 SOP → workflow。同一張 DISPATCH 裡 consult 與 execute 可混用。

## 第 2 步：下清楚的「交辦契約」（不是一行字）

同事**看不到你和使用者的對話**，只看得到 task 裡的內容，所以把方向、背景、交付物、驗收標準寫清楚，否則同事只能猜。輸出下列標記（**只寫計畫、不要自己代答**），系統會跳出批准卡，使用者按下才會真的執行：

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
- \`context\`、\`deliverable\`、\`accept\`：選填但**強烈建議**（execute 幾乎必寫 accept）。accept 寫成 1-3 條 \`-\` 子項，是你之後收貨逐條驗收的依據。
- 只寫 \`agentId\`+\`task\` 的單行舊格式仍有效（向後相容），能補 context/deliverable/accept 就補。
- 寫完標記後，用一句話告訴使用者「我要交辦 X、Y，按批准卡即可」，**不要自己代答**。

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
      const report = `[[EXEC_REPORT]]\n同事「${label}」回報外包任務${d.status === "ok" ? "完成" : "失敗/未完成"}：\n\n${trimReportKeepSelfCheck(d.output)}\n\n你是收貨的主管，不是傳聲筒。請照這個順序處理：\n1) 對照你當初交辦時下的 accept 驗收標準，逐條檢查這份回報是否達成；特別檢視最後的【完成自驗】區塊——做了什麼、怎麼驗證、證據夠不夠、結論是「已驗證完成／部分完成／未完成」。\n2) 若證據不足、或結論是部分完成／未驗證／未完成：**不要粉飾**。優先**退回這位同事重做一次**（再開一張 DISPATCH，在 task 裡具體講清楚缺什麼、要補什麼證據）；若無法自行補救，就明確向使用者標示「只做到 X、還沒驗證 Y、風險是 ___」讓使用者決定。\n3) 驗收通過才向使用者轉達；可以精簡，但要誠實反映品質，不要把「部分完成」講成「完成」。`;
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
    const ackNote = `🤝 已交辦給 ${consultNames}，正在等回覆（單項最長 4 分鐘）…`;
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
    const labelled = consulted
      .map((r) => {
        const raw = r.output || "（未取得回覆）";
        const out = raw.length > 3000 ? raw.slice(0, 3000) + "\n…（完整回覆見該同事的子對話）" : raw;
        return `### ${nameOf.get(r.agentId) ?? r.agentId}（${r.status}）\n${out}`;
      })
      .join("\n\n");
    // B5：部分核可時，在回饋開頭附一句「哪些被拿掉」，PM 才知道全貌。
    const notePrefix = opts?.approvalNote ? `${opts.approvalNote}\n\n` : "";
    const feedback = `${CONSULT_FEEDBACK_SENTINEL}\n${notePrefix}以下是你委派同事的回覆。你是主管，不是照單整合的貼上機——先判斷品質，再整合：\n1) 對照你當初交辦時下的 accept／問題焦點，逐位檢查：這份回覆有沒有**真的回答到問題**？是泛泛而談、還是離題、還是漏了關鍵面向？\n2) 若某位回覆不足、離題或明顯漏答：不要硬把它塞進整合。可以**補問一次**（再開一張 DISPATCH 把問題問得更精準），或在整合時**明確標示「這部分尚未得到有效回答」**，不要用空話填補。\n3) 逾時／錯誤的同事就說明未能取得。\n4) 通過檢查的內容，**整合成一段給使用者的回覆**（衝突處註明採用誰、為什麼）。\n\n${labelled.slice(0, 10000)}`;
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
