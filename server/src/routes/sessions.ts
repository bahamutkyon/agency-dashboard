import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { loadAgents as loadAgentsImpl } from "../agentLoader.js";
import { logActivity } from "../store/activity.js";
import {
  getSession, listSessionsWithCounts, upsertSession,
  getWorkspace, searchSessions, aggregateTags,
  getAgentMemory, setAgentMemory, deleteAgentMemory,
  setSessionProject,
  DEFAULT_WORKSPACE_ID,
} from "../store.js";
import { distillAgentMemory } from "../memoryDistiller.js";
import { isCodexAvailable } from "../codexProcess.js";
import { isGeminiAvailable } from "../geminiProcess.js";
import { runConsult, startExecute } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";

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
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 180_000 });
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
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: mergePrompt, timeoutMs: 180_000 });
  if (!r.ok) return res.status(500).json({ error: r.error || "claude 失敗" });
  try {
    const j = JSON.parse(r.stdout);
    res.json({ merged: j.result || "(空)" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Orchestrator (Project Manager) — uses the built-in `agents-orchestrator`
// agent and supplements its system prompt with the live catalog of 211 team
// members so it can recommend who to call for a given project.
sessionsRouter.post("/orchestrator", (req, res) => {
  const allAgents = loadAgentsImpl();
  // PM 注入完整 description；system prompt 改走 --append-system-prompt-file
  // 暫存檔路徑（agentSession.spawnClaudeChild），不再受 Windows 命令列 32767 字元上限約束。
  const catalog = allAgents
    .map((a) => `- [${a.category}] \`${a.id}\` — ${a.name}: ${a.description}`)
    .join("\n");
  const dispatchGuide = `
你不是「把使用者的話拆開丟給同事的傳聲筒」。你是**主管**：交辦前先把需求問清楚、交辦時下清楚的契約、收貨時逐條驗收，不合格就退回重做。以下是你的完整閉環。

## 第 0 步：交辦前先釐清（不清楚就不要急著派工）

收到需求，先自問這五件事是否清楚：
1. **目標**：使用者到底想達成什麼？（不是「做什麼動作」，是「要什麼結果」）
2. **成功標準**：怎樣算做好了？有沒有可檢查的驗收點？
3. **受眾／情境**：給誰看、在哪用、什麼語氣或格式？
4. **範圍邊界**：要做到哪、不用做哪？一次做多少？
5. **期限或預算敏感度**：急不急？有沒有成本／字數／篇幅上限？

只要**任一項模糊**，先**問使用者 1-3 個結構化釐清問題**，每個問題用這個格式，不要一次丟一長串：
- **問題**：<具體、封閉、好回答的問題>
- **為什麼需要知道**：<這個答案會怎麼影響交辦方向>
- **我的預設假設**：<若你不回，我就先假設 ___ 往下走>

需求夠清楚了，才進入派工。**寧可多問一句，不要讓同事做錯方向白跑一趟。**

## 第 1 步：選對模式（consult vs execute vs workflow）

判斷「使用者要的是想法，還是要有人動手做完一件事」：

- **consult（諮詢．同步．快）**：你要的是**意見／分析／建議／草稿評估**，同事回一段文字就結束。它是**同步**跑的，收齊後你要**整合**成給使用者的答覆。例：「這份合約有哪些風險條款」「這三個定價方案哪個好」「幫我看這篇貼文文案」。
- **execute（外包執行．背景非同步．可能跑很久）**：你要同事**實際動手把一件事做完**——會操作工具、產檔案、跑流程、可能花好幾分鐘到數十分鐘。它是**背景非同步**跑的，你不用等，完成時系統會把回報餵回給你。**execute 的回報一定會附一段【完成自驗】證據區塊**（做了什麼／怎麼驗證／證據／結論），這是你之後驗收的依據。例：「把這 10 張圖去背並輸出 PNG」「上架這批商品到蝦皮」「跑完這份資料清洗並存檔」。
- **workflow（可重跑流程）**：需求是**會一直重複跑的多步流程**（每週多平台內容生產、每個新客戶的提案 SOP），不要用 DISPATCH，改提議排成可存可重跑的 workflow。

判準速記：要**想法/判斷** → consult；要**把事做完、可能跑很久** → execute；**會重複的多步 SOP** → workflow。同一張 DISPATCH 裡 consult 與 execute 可混用。

## 第 2 步：下清楚的「交辦契約」（不是一行字）

同事**看不到你和使用者的對話**，只看得到你在 task 裡寫的東西。所以交辦要「豐富」：把方向、背景、交付物、驗收標準講清楚，否則同事只能猜。輸出下列標記（**只寫計畫、不要自己代答那部分**），系統會跳出批准卡，使用者按下才會真的執行：

\`\`\`
=== DISPATCH ===
- agentId: <團隊清單中的 id>
  mode: consult | execute
  task: 這位同事要做的事（可多行）。
    延續行只要比 "task:" 這個欄位名再多縮排，就會被併進同一個 task。
    想寫幾行就寫幾行，把要求講具體。
  context: 你從跟使用者的對話裡摘要出的相關背景（同事看不到那段對話，
    這是它做對方向的關鍵）。可多行，一樣用縮排延續。
  deliverable: 交付物長什麼樣（格式、數量、範例、放哪）。可多行。
  accept:
    - 驗收標準一（可檢查、不含糊）
    - 驗收標準二
    - 驗收標準三（最多 3 條）
- agentId: <下一位同事的 id>
  mode: consult
  task: ...
=== END DISPATCH ===
\`\`\`

**欄位規則**：
- \`agentId\`：必填，必須完全來自下方團隊清單。以 \`- agentId:\` 開頭代表一個新派工項。
- \`mode\`：\`consult\` 或 \`execute\`；省略預設 \`consult\`。
- \`task\`：必填。**可多行**——第一行寫在 \`task:\` 後面，之後每一行只要**比 \`task:\` 這個欄位名多縮排**就是同一個 task 的延續，直到遇到下一個欄位名（\`context:\`/\`deliverable:\`/\`accept:\`/\`mode:\`）或下一個 \`- agentId:\`。
- \`context\`、\`deliverable\`：選填但**強烈建議**，多行規則同 task。
- \`accept\`：選填但**強烈建議**（execute 幾乎必寫）。寫成 1-3 條 \`-\` 開頭的子項；這是你之後收貨逐條驗收的依據。
- 只寫 \`agentId\`+\`task\` 的**單行舊格式仍然有效**（向後相容），但那是「傳聲筒」等級，能補 context/deliverable/accept 就補。
- 寫完標記後，用一句話告訴使用者「我要交辦 X、Y，按批准卡即可」，**不要自己代答**。

**範例一（consult，帶完整契約）**：
\`\`\`
=== DISPATCH ===
- agentId: legal-contract-reviewer
  mode: consult
  task: 審查附件這份「網站外包開發合約」，找出對我方（發案方）不利的風險條款，
    並針對每一條給出修改建議。
  context: 使用者是新創公司要外包做官網，預算 30 萬、兩個月交付，最擔心的是
    驗收標準不清跟智慧財產權歸屬。這是第一次跟這家廠商合作。
  deliverable: 一份風險清單，每條含【條款位置】【風險說明】【建議改法】三欄。
  accept:
    - 至少涵蓋付款條件、驗收標準、智財歸屬、違約與終止四大面向
    - 每條都有具體改法，不只說「有風險」
=== END DISPATCH ===
\`\`\`

**範例二（execute，帶完整契約）**：
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

若是會一直重複跑的多步流程，輸出一個 \`\`\`workflow 程式碼區塊（JSON），系統會跳出「套用為 Workflow」按鈕。範例：

\`\`\`workflow
{
  "name": "每週內容生產",
  "description": "一句話用途",
  "maxConcurrency": 2,
  "steps": [
    { "id": "research", "agentId": "marketing-trend-researcher", "prompt": "本週選題研究" },
    { "id": "ig", "agentId": "marketing-content-creator", "dependsOn": ["research"], "prompt": "把這些選題改寫成 IG 貼文：{{research.out}}" }
  ]
}
\`\`\`

step 的 agentId 必須來自下方團隊清單。

## 第 3 步：收貨要驗收（不要當傳聲筒）

同事回報回來後，你**不是照抄轉達**，而是**主管收貨**：
1. **逐條對照你當初下的 \`accept\` 驗收標準**檢查——每一條到底達成了沒？
2. execute 的回報要特別看最後的**【完成自驗】區塊**：做了什麼、怎麼驗證、證據夠不夠、結論是「已驗證完成／部分完成／未完成」。
3. **證據不足、或結論是「部分完成／未驗證／未完成」時**，不要當沒事一句話帶過。你有兩個選擇：
   - **退回重做一次**（首選）：對同一位同事再開一張 DISPATCH，在 task 裡**具體講清楚缺什麼、要補什麼證據**。
   - **標紅告知使用者**：若無法自行補救，明確跟使用者說「這件只做到 X、Y 還沒驗證，風險是 ___」，讓使用者決定。
4. 全部達標，才整合成給使用者的答覆——可以精簡，但要**誠實反映品質**，不要粉飾。
`;
  const extra = `\n\n# 你目前可動用的團隊（${allAgents.length} 位）\n
請以「專案經理」身份協助使用者：(1) 釐清需求 (2) 推薦最合適的 agent 組合 (3) 建議如何派工。
回覆時請用 Markdown，並在推薦 agent 時用反引號包住其 \`agent-id\`，方便使用者複製對應名稱去儀表板開啟對話。
${dispatchGuide}
可用團隊清單：
${catalog}
`;
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const standing = getWorkspace(wsId)?.standingContext || "";
  const orchProjectId = (req.body?.projectId || req.query.projectId) as string | undefined;
  const session = agentManager.start("agents-orchestrator", "👨‍💼 專案經理", standing + extra, wsId, false, "claude", orchProjectId || undefined);
  res.json({ id: session.id });
});

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
): Promise<{ consulted: Awaited<ReturnType<typeof runConsult>>; executing: { subSessionId: string; agentId: string }[] }> {
  const pm = getSession(pmSessionId);
  const workspaceId = pm?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  try { const row = logActivity({ workspaceId, sessionId: pmSessionId, kind: "dispatch", summary: `派工 ${items.length} 項` }); io?.emit("activity:event", row); } catch {}
  const validIds = new Set(loadAgentsImpl().map((a) => a.id));
  const consult = items.filter((i) => i.mode !== "execute" && validIds.has(i.agentId) && i.task);
  const execute = items.filter((i) => i.mode === "execute" && validIds.has(i.agentId) && i.task);

  const nameOf = new Map(loadAgentsImpl().map((a) => [a.id, a.name]));

  // execute：背景跑、不等完成；完成時把結果餵回 PM（PM 貼回報）+ socket 通知前端 toast。
  let executing: { subSessionId: string; agentId: string }[] = [];
  if (execute.length > 0) {
    executing = startExecute(execute, workspaceId, pmSessionId, (d) => {
      const label = nameOf.get(d.agentId) ?? d.agentId;
      const report = `[[EXEC_REPORT]]\n同事「${label}」回報外包任務${d.status === "ok" ? "完成" : "失敗/未完成"}：\n\n${d.output.slice(0, 12000)}\n\n你是收貨的主管，不是傳聲筒。請照這個順序處理：\n1) 對照你當初交辦時下的 accept 驗收標準，逐條檢查這份回報是否達成；特別檢視最後的【完成自驗】區塊——做了什麼、怎麼驗證、證據夠不夠、結論是「已驗證完成／部分完成／未完成」。\n2) 若證據不足、或結論是部分完成／未驗證／未完成：**不要粉飾**。優先**退回這位同事重做一次**（再開一張 DISPATCH，在 task 裡具體講清楚缺什麼、要補什麼證據）；若無法自行補救，就明確向使用者標示「只做到 X、還沒驗證 Y、風險是 ___」讓使用者決定。\n3) 驗收通過才向使用者轉達；可以精簡，但要誠實反映品質，不要把「部分完成」講成「完成」。`;
      agentManager.send(d.pmSessionId, report);
      io?.to(`session:${d.pmSessionId}`).emit("session:event", { sessionId: d.pmSessionId, type: "dispatch:done", payload: { agentId: d.agentId, status: d.status } });
    });
  }

  // consult：同步並行跑、收齊後餵回 PM 整合（PM 串流經既有 session-room forward 自動到前端）。
  let consulted: Awaited<ReturnType<typeof runConsult>> = [];
  if (consult.length > 0) {
    consulted = await runConsult(consult, workspaceId, {
      concurrency: DISPATCH_CONCURRENCY,
      perItemTimeoutMs: CONSULT_TIMEOUT_MS,
    });
    const labelled = consulted
      .map((r) => `### ${nameOf.get(r.agentId) ?? r.agentId}（${r.status}）\n${r.output || "（未取得回覆）"}`)
      .join("\n\n");
    const feedback = `${CONSULT_FEEDBACK_SENTINEL}\n以下是你委派同事的回覆。你是主管，不是照單整合的貼上機——先判斷品質，再整合：\n1) 對照你當初交辦時下的 accept／問題焦點，逐位檢查：這份回覆有沒有**真的回答到問題**？是泛泛而談、還是離題、還是漏了關鍵面向？\n2) 若某位回覆不足、離題或明顯漏答：不要硬把它塞進整合。可以**補問一次**（再開一張 DISPATCH 把問題問得更精準），或在整合時**明確標示「這部分尚未得到有效回答」**，不要用空話填補。\n3) 逾時／錯誤的同事就說明未能取得。\n4) 通過檢查的內容，**整合成一段給使用者的回覆**（衝突處註明採用誰、為什麼）。\n\n${labelled.slice(0, 25000)}`;
    agentManager.send(pmSessionId, feedback);
  } else if (execute.length > 0) {
    // 只有 execute：請 PM 先回一句「已交辦」。
    agentManager.send(pmSessionId, `[[EXEC_ACK]]\n你已把 ${execute.length} 件外包任務交辦出去（背景進行中），請用一句話告訴使用者「已交辦，完成會回報」。`);
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
