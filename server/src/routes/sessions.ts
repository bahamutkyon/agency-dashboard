import { Router } from "express";
import { agentManager } from "../agentManager.js";
import { loadAgents as loadAgentsImpl } from "../agentLoader.js";
import {
  getSession, listSessionsWithCounts, upsertSession,
  getWorkspace, searchSessions, aggregateTags,
  getAgentMemory, setAgentMemory, deleteAgentMemory,
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
  const { agentId, title, provider } = req.body || {};
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

  const session = agentManager.start(agentId, title, extra || undefined, wsId, true, chosen);
  res.json({ id: session.id, provider: chosen });
});

sessionsRouter.delete("/sessions/:id", (req, res) => {
  agentManager.remove(req.params.id);
  res.json({ ok: true });
});

sessionsRouter.patch("/sessions/:id", (req, res) => {
  const { title, tags } = req.body || {};
  const cur = getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur };
  if (typeof title === "string") next.title = title;
  if (Array.isArray(tags)) next.tags = tags.map((t) => String(t)).filter(Boolean);
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

  // Use a one-shot claude call (no agent persona) for cheap/fast summarization
  const { spawnClaude } = await import("../claudeProcess.js");
  const child = spawnClaude([
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--disable-slash-commands",
  ]);

  let out = "";
  let err = "";
  let summarySettled = false;
  const summaryDone = (code: number | null) => {
    if (summarySettled) return;
    summarySettled = true;
    if (code !== 0) {
      return res.status(500).json({ error: err || `claude exited ${code}` });
    }
    try {
      const j = JSON.parse(out);
      res.json({ summary: j.result || "(空)" });
    } catch (e: any) {
      res.status(500).json({ error: `parse error: ${e.message}`, raw: out.slice(0, 500) });
    }
  };
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (d) => {
    out += String(d);
    if (out.length > 5_000_000) { child.kill(); if (!summarySettled) { summarySettled = true; res.status(500).json({ error: "輸出超過上限" }); } }
  });
  child.stderr!.on("data", (d) => { err += String(d); });
  child.stdin!.write(Buffer.from(prompt, "utf8"));
  child.stdin!.end();

  child.on("close", summaryDone);
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

  const { spawnClaude } = await import("../claudeProcess.js");
  const child = spawnClaude([
    "-p", "--output-format", "json",
    "--no-session-persistence",
    "--disable-slash-commands",
  ]);

  let out = ""; let err = "";
  let mergeSettled = false;
  const mergeDone = (code: number | null) => {
    if (mergeSettled) return;
    mergeSettled = true;
    if (code !== 0) return res.status(500).json({ error: err || `exit ${code}` });
    try {
      const j = JSON.parse(out);
      res.json({ merged: j.result || "(空)" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  };
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (d) => {
    out += String(d);
    if (out.length > 5_000_000) { child.kill(); if (!mergeSettled) { mergeSettled = true; res.status(500).json({ error: "輸出超過上限" }); } }
  });
  child.stderr!.on("data", (d) => { err += String(d); });
  child.stdin!.write(Buffer.from(mergePrompt, "utf8"));
  child.stdin!.end();

  child.on("close", mergeDone);
});

// Orchestrator (Project Manager) — uses the built-in `agents-orchestrator`
// agent and supplements its system prompt with the live catalog of 211 team
// members so it can recommend who to call for a given project.
sessionsRouter.post("/orchestrator", (req, res) => {
  const allAgents = loadAgentsImpl();
  const catalog = allAgents
    .map((a) => `- [${a.category}] \`${a.id}\` — ${a.name}: ${a.description}`)
    .join("\n");
  const dispatchGuide = `
## 你可以「請教同事並整合」（consult）

當使用者的問題有部分該由特定專家回答時，你可以**提議去請教同事**。輸出下列標記（**只寫計畫、不要自己回答那部分**），系統會跳出批准卡，使用者按下後才會真的去問：

\`\`\`
=== DISPATCH ===
- agentId: <團隊清單中的 id>
  mode: consult
  task: 要問這位同事的單一明確問題（繁中）
=== END DISPATCH ===
\`\`\`

規則：
- agentId 必須完全來自下方團隊清單。
- 要問幾位就列幾項（1 位=單純請教；多位=召集，回來後你負責整合）。
- task 要具體、單一焦點。
- 寫完標記後用一句話告訴使用者「我想請教 X、Y，按批准卡即可」，**不要自己代答**。

## 重複性多步流程 → 提議排成 Workflow（而非 DISPATCH）

若需求是「會一直重複跑的多步流程」（例：每週多平台內容生產、每個新客戶的提案流程），不要用 DISPATCH，而是提議排成可存可重跑的 workflow：輸出一個 \`\`\`workflow 程式碼區塊（JSON），系統會跳出「套用為 Workflow」按鈕。範例：

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

判斷準則：一次性/臨場（請教或交辦）→ DISPATCH；會重複的多步流程 → workflow。step 的 agentId 必須來自下方團隊清單。
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
  const session = agentManager.start("agents-orchestrator", "👨‍💼 專案經理", standing + extra, wsId, false);
  res.json({ id: session.id });
});

// PM 派工 — 接收已批准的計畫，實際跑子 agent。切片① 僅 consult（execute 見切片②）。
sessionsRouter.post("/orchestrator/:sessionId/dispatch", async (req, res) => {
  const pmSessionId = req.params.sessionId;
  const pm = getSession(pmSessionId);
  if (!pm) return res.status(404).json({ error: "PM session 不存在，請重開專案經理對話" });
  const items: DispatchItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: "items 不可為空" });

  const validIds = new Set(loadAgentsImpl().map((a) => a.id));
  const consult = items.filter((i) => i.mode !== "execute" && validIds.has(i.agentId) && i.task);
  const execute = items.filter((i) => i.mode === "execute" && validIds.has(i.agentId) && i.task);
  if (consult.length === 0 && execute.length === 0) {
    return res.status(400).json({ error: "沒有有效的派工項（agentId 須在團隊清單內、且要有 task）" });
  }

  const nameOf = new Map(loadAgentsImpl().map((a) => [a.id, a.name]));
  const io = req.app.get("io");

  try {
    // execute：背景跑、不等完成；完成時把結果餵回 PM（PM 貼回報）+ socket 通知前端 toast。
    let executing: { subSessionId: string; agentId: string }[] = [];
    if (execute.length > 0) {
      executing = startExecute(execute, pm.workspaceId, pmSessionId, (d) => {
        const label = nameOf.get(d.agentId) ?? d.agentId;
        const report = `[[EXEC_REPORT]]\n同事「${label}」回報外包任務${d.status === "ok" ? "完成" : "失敗/未完成"}：\n\n${d.output.slice(0, 12000)}\n\n請用一句話向使用者轉達此回報。`;
        agentManager.send(d.pmSessionId, report);
        io?.to(`session:${d.pmSessionId}`).emit("session:event", { sessionId: d.pmSessionId, type: "dispatch:done", payload: { agentId: d.agentId, status: d.status } });
      });
    }

    // consult：同步並行跑、收齊後餵回 PM 整合（PM 串流經既有 session-room forward 自動到前端）。
    let consulted: Awaited<ReturnType<typeof runConsult>> = [];
    if (consult.length > 0) {
      consulted = await runConsult(consult, pm.workspaceId, {
        concurrency: DISPATCH_CONCURRENCY,
        perItemTimeoutMs: CONSULT_TIMEOUT_MS,
      });
      const labelled = consulted
        .map((r) => `### ${nameOf.get(r.agentId) ?? r.agentId}（${r.status}）\n${r.output || "（未取得回覆）"}`)
        .join("\n\n");
      const feedback = `${CONSULT_FEEDBACK_SENTINEL}\n以下是你委派同事的回覆，請**整合成一段給使用者的回覆**（衝突處註明採用誰、為什麼；逾時/錯誤的同事就說明未能取得）：\n\n${labelled.slice(0, 25000)}`;
      agentManager.send(pmSessionId, feedback);
    } else if (execute.length > 0) {
      // 只有 execute：請 PM 先回一句「已交辦」。
      agentManager.send(pmSessionId, `[[EXEC_ACK]]\n你已把 ${execute.length} 件外包任務交辦出去（背景進行中），請用一句話告訴使用者「已交辦，完成會回報」。`);
    }

    res.json({ consulted, executing });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});
