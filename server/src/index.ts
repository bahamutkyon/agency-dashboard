import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { loadAgents, categoryLabel } from "./agentLoader.js";
import { agentManager, securityStats } from "./agentManager.js";
import { scheduler } from "./scheduler.js";
import { usageTracker } from "./usageTracker.js";
import { workflowRunner } from "./workflowRunner.js";
import { listInstalledMCPServers, buildMCPConfigForWorkspace, BASELINE_MCPS } from "./mcpDetector.js";
import { buildCapabilitiesSummary } from "./capabilitiesDetector.js";
import { isCodexAvailable } from "./codexProcess.js";
import { isGeminiAvailable } from "./geminiProcess.js";
import { routePrompt } from "./smartRouter.js";
import { importWorkflowYaml, exportWorkflowYaml } from "./yamlAdapter.js";
import { v4 as uuid } from "uuid";
import {
  getSession, listSessions, listTemplates, upsertTemplate, deleteTemplate as removeTemplate,
  upsertSession, listNotes, upsertNote, deleteNote as removeNote,
  listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace as removeWorkspace,
  searchSessions, aggregateTags, listSchedules, DEFAULT_WORKSPACE_ID,
  listWorkflows, getWorkflow, upsertWorkflow, deleteWorkflow as removeWorkflow,
  listRuns, getRun,
} from "./store.js";

const PORT = Number(process.env.PORT || 5191);

import fs from "node:fs";
import path from "node:path";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // bumped for base64 file uploads

// --- REST ---

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/usage", (_req, res) => res.json(usageTracker.summary()));

// File upload — drag-and-drop from chat. Saves to server/data/uploads/ and
// returns the absolute path so the client can mention it in the next prompt
// (claude CLI can read paths via its Read tool / image support).
app.post("/api/upload", (req, res) => {
  const { name, content, encoding } = req.body || {};
  if (!name || !content) return res.status(400).json({ error: "name and content required" });
  const safe = String(name).replace(/[^\w.一-鿿-]/g, "_").slice(0, 100);
  const filename = `${Date.now().toString(36)}_${safe}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  try {
    if (encoding === "base64") {
      fs.writeFileSync(filepath, Buffer.from(String(content), "base64"));
    } else {
      fs.writeFileSync(filepath, String(content), "utf8");
    }
    const stats = fs.statSync(filepath);
    res.json({ path: filepath, name, size: stats.size });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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

// MCP — list available servers from user's ~/.claude.json
app.get("/api/mcp/servers", (_req, res) => {
  res.json(listInstalledMCPServers());
});

// Security status — for the top-right protection indicator. Returns
// whether shellward (or any baseline MCP) is configured + injection stats.
app.get("/api/security/status", (_req, res) => {
  const installed = listInstalledMCPServers();
  const installedNames = new Set(installed.map((s) => s.name));
  const baselineCheck = BASELINE_MCPS.map((name) => ({
    name,
    configured: installedNames.has(name),
  }));
  const allConfigured = baselineCheck.every((b) => b.configured);
  res.json({
    healthy: allConfigured && BASELINE_MCPS.length > 0,
    baseline: baselineCheck,
    stats: {
      sessionsWithMcp: securityStats.sessionsWithMcp,
      sessionsWithoutMcp: securityStats.sessionsWithoutMcp,
      lastInjectionAt: securityStats.lastInjectionAt,
      lastMcpNames: securityStats.lastMcpNames,
      uptimeMs: Date.now() - securityStats.startedAt,
    },
  });
});

// Capabilities — full inventory of skills + MCPs + agents + CLI tools
// vs the manifest. Powers the CapabilitiesBadge UI and is the same
// source `npm run doctor` reads from.
app.get("/api/capabilities", (_req, res) => {
  try {
    res.json(buildCapabilitiesSummary());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Export — bundle a workspace's metadata + notes + templates + schedules
// (NOT sessions, those are conversation history specific to user) into a
// single JSON file for sharing or backup.
app.get("/api/workspaces/:id/export", (req, res) => {
  const w = getWorkspace(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  const bundle = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    workspace: { name: w.name, description: w.description, standingContext: w.standingContext },
    notes: listNotes(w.id).map(({ id: _i, workspaceId: _w, ...rest }) => rest),
    templates: listTemplates(w.id).map(({ id: _i, workspaceId: _w, ...rest }) => rest),
    schedules: listSchedules(w.id).map(({ id: _i, workspaceId: _w, lastRunAt: _l, nextRunAt: _n, ...rest }) => rest),
  };
  res.setHeader("Content-Disposition", `attachment; filename="workspace-${w.name}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(bundle);
});

// Import — create a new workspace from a JSON bundle. Generates fresh ids
// for everything (so re-importing gives you a separate copy).
app.post("/api/workspaces/import", (req, res) => {
  const bundle = req.body;
  if (!bundle?.workspace?.name) return res.status(400).json({ error: "invalid bundle: missing workspace.name" });
  const ws = createWorkspace({
    name: bundle.workspace.name,
    description: bundle.workspace.description || "",
    standingContext: bundle.workspace.standingContext || "",
  });
  const now = Date.now();
  let n = 0, t = 0, s = 0;
  for (const note of bundle.notes || []) {
    upsertNote({
      id: uuid(), workspaceId: ws.id,
      title: note.title, body: note.body, pinned: !!note.pinned,
      createdAt: now, updatedAt: now,
    });
    n++;
  }
  for (const tpl of bundle.templates || []) {
    upsertTemplate({
      id: uuid(), workspaceId: ws.id,
      name: tpl.name, body: tpl.body, agentId: tpl.agentId,
      tags: tpl.tags || [], createdAt: now, updatedAt: now,
    });
    t++;
  }
  for (const sc of bundle.schedules || []) {
    try {
      scheduler.create({
        workspaceId: ws.id,
        name: sc.name, agentId: sc.agentId, prompt: sc.prompt, cron: sc.cron,
        enabled: false, // import as paused — user opts in to re-enable
      });
      s++;
    } catch (e) {
      console.warn("[import] schedule skipped:", (e as any).message);
    }
  }
  res.json({ workspaceId: ws.id, imported: { notes: n, templates: t, schedules: s } });
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

// Smart router: classify a prompt and recommend a provider.
app.post("/api/route", async (req, res) => {
  const { prompt, defaultProvider } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  try {
    const decision = await routePrompt(prompt, defaultProvider || "claude");
    res.json(decision);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Provider availability check
app.get("/api/providers", (_req, res) => {
  res.json({
    available: {
      claude: true,
      codex: isCodexAvailable(),
      gemini: isGeminiAvailable(),
    },
  });
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

// Merge best — takes N agent answers (from a batch run) and asks claude to
// synthesize the strongest combined version, citing which parts came from
// which agent.
app.post("/api/batch/merge", async (req, res) => {
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

  const { spawnClaude } = await import("./claudeProcess.js");
  const child = spawnClaude([
    "-p", "--output-format", "json",
    "--no-session-persistence",
    "--disable-slash-commands",
  ]);

  let out = ""; let err = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { err += String(d); });
  child.stdout.setEncoding("utf8");
  child.stdin.write(Buffer.from(mergePrompt, "utf8"));
  child.stdin.end();

  child.on("close", (code) => {
    if (code !== 0) return res.status(500).json({ error: err || `exit ${code}` });
    try {
      const j = JSON.parse(out);
      res.json({ merged: j.result || "(空)" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
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
  const { spawnClaude } = await import("./claudeProcess.js");
  const child = spawnClaude([
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--disable-slash-commands",
  ]);

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { err += String(d); });
  child.stdout.setEncoding("utf8");
  child.stdin.write(Buffer.from(prompt, "utf8"));
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

// Workflow drafting — orchestrator interviews the user about a recurring
// task and outputs a workflow JSON that the UI auto-detects + lets user
// apply with one click.
app.post("/api/workflow/draft", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const allAgents = loadAgents();
  const catalog = allAgents
    .map((a) => `- \`${a.id}\` (${a.category}) — ${a.name}: ${a.description.slice(0, 80)}`)
    .join("\n");

  const extra = `

# 你現在的特殊任務:Workflow 設計顧問(進階版)

使用者想自動化某個重複性流程,你幫他設計一個 **DAG-based workflow**(支援平行 / 暫停 / 條件)。

## 訪問流程

1. 第一句問:「你想自動化什麼工作?例如『每週多平台內容生產』、『新客戶提案完整流程』、『競品深度分析』。」
2. 釐清:
   - 流程的輸入(workflow 起始點是什麼?)與最終產出
   - **中間哪些步驟可以平行進行?**(多個獨立子任務同時跑)
   - 是否有需要人工確認 / 暫停的關鍵節點
   - 是否有條件性步驟(某結果出現才需要某 agent)
3. 從可用團隊中挑最合適的 agent,**設計 4-8 個步驟,主動使用 DAG 平行**
4. 輸出最終 workflow

## 輸出格式(嚴格遵守)

\`\`\`workflow
{
  "name": "簡潔的 workflow 名稱",
  "description": "一句話描述用途",
  "maxConcurrency": 2,
  "steps": [
    {
      "id": "research",
      "agentId": "marketing-trend-researcher",
      "prompt": "第一步指令,可用 {{out}} 引用 workflow 起始輸入"
    },
    {
      "id": "ig_version",
      "agentId": "marketing-content-creator",
      "dependsOn": ["research"],
      "prompt": "把以下找到的選題改編成 IG 貼文:\\n\\n{{research.out}}"
    },
    {
      "id": "rednote_version",
      "agentId": "marketing-content-creator",
      "dependsOn": ["research"],
      "prompt": "把以下找到的選題改編成小紅書筆記:\\n\\n{{research.out}}"
    },
    {
      "id": "review",
      "agentId": "design-brand-guardian",
      "dependsOn": ["ig_version", "rednote_version"],
      "pauseBefore": true,
      "prompt": "請審以下兩平台內容:\\n\\nIG:{{ig_version.out}}\\n\\n小紅書:{{rednote_version.out}}"
    }
  ]
}
\`\`\`

## 設計規則(重要)

1. **每個 step 都要有 id**(唯一,小寫 + 底線,例:research / ig_version / final_review)
2. **主動找平行機會**:獨立的子任務(多平台改編、多角度分析、不同部門 brief)→ 一定要 dependsOn 同樣的上游,不要寫成直線
3. **{{stepId.out}}** 引用任意上游的輸出;**{{out}}** 取最後依賴的輸出(直線時用)
4. **dependsOnMode: "any"** 適合「賽跑」場景(多個 agent 同時嘗試,先出結果就用),預設是 "all"
5. **pauseBefore: true** 在關鍵節點(發布前、合約前、決策前)插入,讓使用者批准
6. **skipIfMatch: "regex"** 條件跳過(上一步輸出符合則跳過此步)
7. **maxConcurrency**:多平台/多面向同跑可設 3-4;一般 2
8. step 數 **4-8 步最佳**;前 1-2 步是研究/輸入,中段平行展開,最後合併/審稿
9. agentId **必須來自下方清單,完全一致**;prompt 用**繁體中文**

## 設計典範(快速啟發)

- **多平台內容**:research → ig + rednote + threads(平行)→ brand_review
- **競品分析**:intel → market + tech + finance(平行)→ synthesis
- **客戶提案**:intake → research → draft(pause)→ legal + finance(平行)→ final
- **內容發佈前審查**:author → fact + brand + legal + seo(平行)→ consolidate(pause)
- **CEO 多部門委派**:plan → product + marketing + finance(平行)→ ceo_review(pause)

## 任務完成後

寫完後告訴使用者:「我產出了 workflow 草稿(N 步,其中 X 個並行)。對話頂部會跳出綠色按鈕「套用為 Workflow」一鍵建立。」

## 可用團隊
${catalog}
`;
  const session = agentManager.start(
    "agents-orchestrator",
    "🔗 Workflow 設計顧問",
    extra,
    wsId,
    false,
  );
  res.json({ id: session.id });
});

// Apply workflow draft — extract the JSON block from a session's latest
// assistant message and create the workflow in the target workspace.
app.post("/api/workflow/draft/apply", (req, res) => {
  const { sessionId, workspaceId, workflow } = req.body || {};
  if (!sessionId || !workspaceId || !workflow?.name || !Array.isArray(workflow?.steps)) {
    return res.status(400).json({ error: "sessionId, workspaceId, workflow{name, steps[]} required" });
  }
  // validate agentIds exist
  const allAgents = loadAgents();
  const validIds = new Set(allAgents.map((a) => a.id));
  for (const s of workflow.steps) {
    if (!s.agentId || !validIds.has(s.agentId)) {
      return res.status(400).json({ error: `unknown agentId: ${s.agentId}` });
    }
    if (!s.prompt) return res.status(400).json({ error: "step missing prompt" });
  }
  const now = Date.now();
  const wf = {
    id: uuid(),
    workspaceId,
    name: workflow.name,
    description: workflow.description || "",
    steps: workflow.steps.map((s: any) => ({ agentId: s.agentId, prompt: s.prompt })),
    createdAt: now,
    updatedAt: now,
  };
  upsertWorkflow(wf);
  res.json(wf);
});

// Onboarding — opens a special chat where the orchestrator interviews the
// user about their project and outputs a structured "standing context" memo.
// The frontend detects the marker block in the response and offers a one-click
// "apply to workspace" action.
app.post("/api/onboarding", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const extra = `

# 🚨 重要:你現在是「工作區設定顧問」,不是普通對話 agent

使用者剛剛點了「🤖 AI 訪問我」按鈕,**期望你訪問他、產出工作區備忘錄**,**不是回答他的業務問題本身**。

## 規則(絕對遵守)

1. **不論使用者第一句話是什麼**(就算他問「怎麼做最好」、「教我」、「給我建議」),你**都不要直接回答**。先**禮貌打斷**:「我是工作區設定顧問,先幫你建好專案脈絡,之後你跟其他 agent 對話它們才能對上頻率。我問你幾個問題就好,5 分鐘搞定。」
2. 然後**第一個正式問題**:「請用 1-2 句話描述你這個專案在做什麼?(例如:給上班族的 AI 工具教學自媒體 / 外勞人力仲介 B2B 服務)」
3. 接著用結構化方式訪問,**每次最多 1-2 題**:
   - 業務領域 / 服務類型
   - 目標客群(年齡/職業/痛點/在哪)
   - 品牌語氣 / 差異化
   - 禁用詞 / 紅線
   - 法規與合規要點(若適用)
   - 常用工作流程慣例
4. 大約 5-7 輪後資訊夠了,**輸出最終備忘錄**(格式見下)
5. 寫完後問:「這份草稿可以嗎?需要修改哪裡?」

## 最終備忘錄格式(嚴格遵守,前端會自動偵測)

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
=== MEMO END ===
\`\`\`

## 反例(絕對不要這樣做)

❌ 使用者問「自媒體怎麼做才會紅?」→ 你直接給三種做法 + 變現策略 + 建議
✓ 你應該:「我先幫你建好專案脈絡再來規劃。第一題:你這個自媒體想專攻什麼題材?」

❌ 跳過訪問流程直接寫 MEMO
✓ 至少 5 輪對話後才寫

如果使用者一直想跳過訪問,**直接接著問下一題就好**,不要解釋規則。
`;
  const session = agentManager.start(
    "agents-orchestrator",
    "🤖 工作區設定顧問",
    extra,
    wsId,
    false,
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
  const session = agentManager.start("agents-orchestrator", "👨‍💼 專案經理", standing + extra, wsId, false);
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

// --- Workflows ---

app.get("/api/workflows", (req, res) => {
  res.json(listWorkflows(ws(req)));
});

app.get("/api/workflows/:id", (req, res) => {
  const w = getWorkflow(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  res.json(w);
});

app.post("/api/workflows", (req, res) => {
  const { name, description, steps } = req.body || {};
  if (!name || !Array.isArray(steps)) {
    return res.status(400).json({ error: "name and steps[] required" });
  }
  const now = Date.now();
  const w = {
    id: uuid(),
    workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
    name, description: description || "",
    steps,
    createdAt: now, updatedAt: now,
  };
  upsertWorkflow(w);
  res.json(w);
});

app.patch("/api/workflows/:id", (req, res) => {
  const cur = getWorkflow(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const next = { ...cur, ...req.body, id: cur.id, createdAt: cur.createdAt, updatedAt: Date.now() };
  upsertWorkflow(next);
  res.json(next);
});

app.delete("/api/workflows/:id", (req, res) => {
  removeWorkflow(req.params.id);
  res.json({ ok: true });
});

app.post("/api/workflows/:id/run", async (req, res) => {
  try {
    const { initialInput, resumeRunId, fromStepId } = req.body || {};
    const run = await workflowRunner.run({
      workflowId: req.params.id,
      initialInput,
      resumeRunId,
      fromStepId,
    });
    res.json(run);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/workflows/:id/validate", (req, res) => {
  res.json(workflowRunner.validate(req.params.id));
});

app.post("/api/runs/:id/cancel", (req, res) => {
  workflowRunner.cancel(req.params.id);
  res.json({ ok: true });
});

app.post("/api/runs/:id/approve", (req, res) => {
  workflowRunner.approve(req.params.id);
  res.json({ ok: true });
});

app.post("/api/runs/:id/loop-back", (req, res) => {
  const { stepId } = req.body || {};
  if (!stepId) return res.status(400).json({ error: "stepId required" });
  const r = workflowRunner.loopBack(req.params.id, stepId);
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

app.get("/api/workflows/:id/runs", (req, res) => {
  res.json(listRuns(req.params.id));
});

// Workflow YAML export — returns text/yaml file for download
app.get("/api/workflows/:id/yaml", (req, res) => {
  const wf = getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: "not found" });
  const yaml = exportWorkflowYaml(wf);
  res.setHeader("Content-Type", "application/x-yaml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${wf.name.replace(/[^\w-]/g, "_")}.yaml"`);
  res.send(yaml);
});

// Workflow YAML import — accept YAML body, create new workflow in workspace
app.post("/api/workflows/import-yaml", express.text({ type: "*/*", limit: "1mb" }), (req, res) => {
  try {
    const text = typeof req.body === "string" ? req.body : (req.body?.yaml || "");
    if (!text || text.length < 10) return res.status(400).json({ error: "YAML 內容為空" });
    const parsed = importWorkflowYaml(text);
    if (!parsed.steps || parsed.steps.length === 0) {
      return res.status(400).json({ error: "找不到任何 steps" });
    }
    // validate agentIds
    const known = new Set(loadAgents().map((a) => a.id));
    const unknown = parsed.steps.filter((s) => s.agentId && !known.has(s.agentId)).map((s) => s.agentId);
    const now = Date.now();
    const wf = {
      id: uuid(),
      workspaceId: ws(req) || DEFAULT_WORKSPACE_ID,
      name: parsed.name,
      description: parsed.description,
      steps: parsed.steps,
      maxConcurrency: parsed.maxConcurrency,
      createdAt: now,
      updatedAt: now,
    };
    upsertWorkflow(wf);
    res.json({
      workflowId: wf.id,
      stepCount: wf.steps.length,
      unknownAgents: Array.from(new Set(unknown)),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/runs/:id", (req, res) => {
  const r = getRun(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
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
    const result = agentManager.send(sessionId, text);
    if (!result.ok) {
      console.warn(`[ws] send failed ${sessionId}`);
      socket.emit("session:error", { sessionId, error: "send failed" });
      return;
    }
    if (result.injectedNotes && result.injectedNotes.length > 0) {
      io.to(`session:${sessionId}`).emit("session:event", {
        sessionId,
        type: "notes-injected",
        payload: result.injectedNotes,
      });
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
  scheduler.onFire((s) => io.emit("schedule:fired", { id: s.id, lastRunAt: s.lastRunAt }));
  workflowRunner.on("update", (runId: string) => {
    const r = getRun(runId);
    if (r) io.emit("workflow:update", r);
  });
});
