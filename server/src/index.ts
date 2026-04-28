import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { loadAgents, categoryLabel } from "./agentLoader.js";
import { agentManager } from "./agentManager.js";
import { scheduler } from "./scheduler.js";
import { usageTracker } from "./usageTracker.js";
import { v4 as uuid } from "uuid";
import {
  getSession, listSessions, listTemplates, upsertTemplate, deleteTemplate as removeTemplate,
  upsertSession, listNotes, upsertNote, deleteNote as removeNote,
  listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace as removeWorkspace,
  searchSessions, aggregateTags, DEFAULT_WORKSPACE_ID,
} from "./store.js";

const PORT = Number(process.env.PORT || 5191);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- REST ---

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/usage", (_req, res) => res.json(usageTracker.summary()));

// --- Workspaces ---

app.get("/api/workspaces", (_req, res) => res.json(listWorkspaces()));

app.post("/api/workspaces", (req, res) => {
  const { name, description, standingContext } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  res.json(createWorkspace({ name, description, standingContext }));
});

app.patch("/api/workspaces/:id", (req, res) => {
  const updated = updateWorkspace(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/workspaces/:id", (req, res) => {
  if (req.params.id === DEFAULT_WORKSPACE_ID) {
    return res.status(400).json({ error: "預設工作區無法刪除" });
  }
  const ok = removeWorkspace(req.params.id);
  res.json({ ok });
});

app.get("/api/agents", (_req, res) => {
  const agents = loadAgents();
  const categories = Array.from(new Set(agents.map((a) => a.category))).map((c) => ({
    id: c,
    label: categoryLabel(c),
    count: agents.filter((a) => a.category === c).length,
  }));
  res.json({ agents, categories });
});

function ws(req: any): string | undefined {
  const w = req.query?.workspace || req.headers["x-workspace"];
  return w ? String(w) : undefined;
}

app.get("/api/sessions", (req, res) => {
  const out = listSessions(ws(req)).map((s) => ({
    ...s,
    status: agentManager.liveStatus(s.id),
    messages: undefined,
  }));
  res.json(out);
});

app.get("/api/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ ...s, status: agentManager.liveStatus(s.id) });
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  res.json(searchSessions(q, ws(req)));
});

app.post("/api/sessions", (req, res) => {
  const { agentId, title } = req.body || {};
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const standing = getWorkspace(wsId)?.standingContext || "";
  const session = agentManager.start(agentId, title, standing || undefined, wsId);
  res.json({ id: session.id });
});

// Batch — fan out the same prompt to N agents in parallel. Returns the
// session IDs so the client can subscribe to each via socket.io. We do NOT
// fire the messages here; the client sends `session:send` per session, which
// keeps the spawn-on-first-send semantics consistent and lets the user see
// each pane lighting up independently.
app.post("/api/batch", (req, res) => {
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

// Summarize — spawns a fresh claude turn (general-purpose) that reads the
// transcript and produces a structured summary. Doesn't touch the original
// session.
app.post("/api/sessions/:id/summarize", async (req, res) => {
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
  const { spawn } = await import("node:child_process");
  const child = spawn("claude", [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--tools", "",
  ], { shell: process.platform === "win32", windowsHide: true });

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { err += String(d); });
  child.stdin.write(prompt);
  child.stdin.end();

  child.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: err || `claude exited ${code}` });
    }
    try {
      const j = JSON.parse(out);
      res.json({ summary: j.result || "(空)" });
    } catch (e: any) {
      res.status(500).json({ error: `parse error: ${e.message}`, raw: out.slice(0, 500) });
    }
  });
});

// Onboarding — opens a special chat where the orchestrator interviews the
// user about their project and outputs a structured "standing context" memo.
// The frontend detects the marker block in the response and offers a one-click
// "apply to workspace" action.
app.post("/api/onboarding", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const extra = `

# 你現在的特殊任務:工作區設定顧問

使用者剛剛建立了一個新工作區,需要你幫他擬一份「專案備忘錄」(standing context)。
這份備忘錄之後會被自動注入給該工作區所有 agent 的對話,讓 agent 一開口就理解這個專案的脈絡。

## 你的訪問流程

1. **第一句**請開門見山地問:「請用 1-2 句話描述你這個專案在做什麼?」
2. 接著用**結構化的方式**訪問,**一次只問 1-2 題**,別丟一堆問題嚇到使用者。建議涵蓋:
   - 業務領域 / 服務類型
   - 目標客群(年齡/職業/痛點)
   - 品牌語氣與差異化
   - 禁用詞 / 紅線(避免 agent 寫出不適合的內容)
   - 法規與合規要點(若適用)
   - 常用工作流程 / 慣例
3. 大約 5-7 輪對話後,當你覺得資訊夠了,**輸出最終備忘錄**

## 最終備忘錄格式(非常重要,請嚴格遵守)

當你準備輸出最終備忘錄時,請用以下標記框起來,**這樣前端才能偵測並一鍵套用**:

\`\`\`
=== MEMO START ===
# [專案名稱]

## 業務領域
...

## 目標客群
...

## 品牌語氣 / 風格
...

## 禁用詞 / 紅線
...

## 工作流程慣例
...

(其他適用的小節)
=== MEMO END ===
\`\`\`

備忘錄本身用 Markdown 結構化、條列為主、簡潔具體。寫完後問使用者:「這份草稿可以嗎?需要修改哪裡?」

## 重要原則
- **不要一次問 5 題**,每次最多 2 題,讓使用者好回答
- **聽到答案後不要立刻 ack**,如果不夠具體請追問
- **不要自己編內容**,只整理使用者提供的資訊
- 訪問語氣**輕鬆友善**,別像在填表
`;
  const session = agentManager.start(
    "agents-orchestrator",
    "🤖 工作區設定顧問",
    extra,
    wsId,
  );
  res.json({ id: session.id });
});

// Apply onboarding result — extracts the MEMO block from the latest assistant
// message and updates the target workspace's standing context.
app.post("/api/onboarding/apply", (req, res) => {
  const { sessionId, workspaceId, memo } = req.body || {};
  if (!sessionId || !workspaceId || !memo) {
    return res.status(400).json({ error: "sessionId, workspaceId, memo required" });
  }
  const updated = updateWorkspace(workspaceId, { standingContext: String(memo) });
  if (!updated) return res.status(404).json({ error: "workspace not found" });
  res.json(updated);
});

// Orchestrator (Project Manager) — uses the built-in `agents-orchestrator`
// agent and supplements its system prompt with the live catalog of 211 team
// members so it can recommend who to call for a given project.
app.post("/api/orchestrator", (req, res) => {
  const allAgents = loadAgents();
  const catalog = allAgents
    .map((a) => `- [${a.category}] \`${a.id}\` — ${a.name}: ${a.description}`)
    .join("\n");
  const extra = `\n\n# 你目前可動用的團隊（${allAgents.length} 位）\n
請以「專案經理」身份協助使用者：(1) 釐清需求 (2) 推薦最合適的 agent 組合 (3) 建議如何派工。
回覆時請用 Markdown，並在推薦 agent 時用反引號包住其 \`agent-id\`，方便使用者複製對應名稱去儀表板開啟對話。

可用團隊清單：
${catalog}
`;
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const standing = getWorkspace(wsId)?.standingContext || "";
  const session = agentManager.start("agents-orchestrator", "👨‍💼 專案經理", standing + extra, wsId);
  res.json({ id: session.id });
});

app.delete("/api/sessions/:id", (req, res) => {
  agentManager.remove(req.params.id);
  res.json({ ok: true });
});

app.patch("/api/sessions/:id", (req, res) => {
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

app.get("/api/tags", (req, res) => {
  res.json(aggregateTags(ws(req)));
});

// --- Schedules ---

app.get("/api/schedules", (req, res) => {
  res.json(scheduler.list(ws(req)));
});

app.post("/api/schedules", (req, res) => {
  try {
    const s = scheduler.create({ ...req.body, workspaceId: ws(req) || DEFAULT_WORKSPACE_ID });
    res.json(s);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/schedules/:id", (req, res) => {
  try {
    const s = scheduler.update(req.params.id, req.body);
    if (!s) return res.status(404).json({ error: "not found" });
    res.json(s);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/schedules/:id", (req, res) => {
  scheduler.delete(req.params.id);
  res.json({ ok: true });
});

// --- Templates ---

app.get("/api/templates", (req, res) => {
  res.json(listTemplates(ws(req)));
});

app.post("/api/templates", (req, res) => {
  const { name, body, agentId, tags } = req.body || {};
  if (!name || !body) return res.status(400).json({ error: "name and body required" });
  const now = Date.now();
  const t = {
    id: uuid(), workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    name, body, agentId, tags: tags || [], createdAt: now, updatedAt: now,
  };
  upsertTemplate(t);
  res.json(t);
});

app.patch("/api/templates/:id", (req, res) => {
  const all = listTemplates();
  const cur = all.find((t) => t.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur, ...req.body, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() };
  upsertTemplate(next);
  res.json(next);
});

app.delete("/api/templates/:id", (req, res) => {
  removeTemplate(req.params.id);
  res.json({ ok: true });
});

// --- Notes ---

app.get("/api/notes", (req, res) => {
  res.json(listNotes(ws(req)));
});

app.post("/api/notes", (req, res) => {
  const { title, body, pinned } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "title and body required" });
  const now = Date.now();
  const n = {
    id: uuid(), workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    title, body, pinned: !!pinned, createdAt: now, updatedAt: now,
  };
  upsertNote(n);
  res.json(n);
});

app.patch("/api/notes/:id", (req, res) => {
  const all = listNotes();
  const cur = all.find((n) => n.id === req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur, ...req.body, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() };
  upsertNote(next);
  res.json(next);
});

app.delete("/api/notes/:id", (req, res) => {
  removeNote(req.params.id);
  res.json({ ok: true });
});

// --- HTTP server + Socket.IO ---

const server = createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log(`[ws] client connected ${socket.id}`);
  socket.on("disconnect", (r) => console.log(`[ws] client disconnected ${socket.id} (${r})`));

  socket.on("session:join", (sessionId: string) => {
    console.log(`[ws] session:join ${sessionId}`);
    const session = agentManager.get(sessionId) || agentManager.reattach(sessionId);
    if (!session) {
      console.warn(`[ws] session not found: ${sessionId}`);
      socket.emit("session:error", { sessionId, error: "session not found" });
      return;
    }
    socket.join(`session:${sessionId}`);

    const forward = (evt: any) => {
      io.to(`session:${sessionId}`).emit("session:event", { sessionId, ...evt });
    };
    if (!(session as any)._wired) {
      session.on("event", forward);
      (session as any)._wired = true;
      console.log(`[ws] wired session ${sessionId}`);
    }
  });

  socket.on("session:send", ({ sessionId, text }: { sessionId: string; text: string }) => {
    console.log(`[ws] session:send ${sessionId} text=${text?.slice(0, 60)}`);
    if (!sessionId || !text) return;
    const ok = agentManager.send(sessionId, text);
    if (!ok) {
      console.warn(`[ws] send failed ${sessionId}`);
      socket.emit("session:error", { sessionId, error: "send failed" });
    }
  });

  socket.on("session:stop", (sessionId: string) => {
    console.log(`[ws] session:stop ${sessionId}`);
    agentManager.stop(sessionId);
  });
});

server.listen(PORT, () => {
  console.log(`[agency-dashboard] listening on http://localhost:${PORT}`);
  console.log(`[agency-dashboard] agents loaded: ${loadAgents().length}`);
  scheduler.init();
  // forward schedule fires to all connected clients so the UI can refresh
  scheduler.onFire((s) => io.emit("schedule:fired", { id: s.id, lastRunAt: s.lastRunAt }));
});
