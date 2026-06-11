import { AgentSession, type Provider } from "./agentSession.js";
import {
  upsertSession, getSession, listSessions, deleteSession, appendMessage, setSessionClaudeId,
  setSessionCodexThread,
  getWorkspace, getAgentMemory,
  DEFAULT_WORKSPACE_ID, type SessionRecord,
} from "./store.js";
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCraftMemoryFor, getCategoryMemoryFor } from "./learningStore.js";
import { buildCapabilityBlockFor } from "./learningInjector.js";
import { readAgentDefinition, categoryFor } from "./agentLoader.js";
import { buildMCPConfigForWorkspace } from "./mcpDetector.js";
import { usageTracker } from "./usageTracker.js";
import { maybeAutoTitle } from "./autoTitler.js";
import { findRelevantNotes, formatNotesAsContext } from "./notesRetrieval.js";
import { buildSkillPrimingBlock } from "./skillPriming.js";
import { ensureWorkspaceDir } from "./workspaceDir.js";
import { parseDispatchMarker } from "./dispatchParser.js";
import { createPendingAction, listPending, getActiveRunForSession } from "./store/autonomy.js";
import fs from "node:fs";
import path from "node:path";

/** 從 PM 訊息偵測 DISPATCH 並入待批佇列（手動派工，runId 空）。
 *  去重：同 session 已有相同 summary 的 pending dispatch 則跳過。
 *  有自主 run 進行中時跳過（交給 autonomyRunner，避免雙重入列）。 */
export function detectAndEnqueueDispatch(
  sess: { id: string; agentId: string; workspaceId: string },
  content: string,
): void {
  if (sess.agentId !== "agents-orchestrator") return;
  if (getActiveRunForSession(sess.id)) return;
  const plan = parseDispatchMarker(content);
  if (!plan || !plan.items.length) return;
  const summary = `派工給 ${plan.items.length} 位：${plan.items.map((i) => i.agentId).join("、")}`;
  if (listPending(sess.id).some((p) => p.kind === "dispatch" && p.summary === summary)) return;
  createPendingAction({
    sessionId: sess.id, workspaceId: sess.workspaceId, kind: "dispatch", risk: "high",
    summary,
    detail: plan.items.map((i) => `- agentId: ${i.agentId}\n  mode: ${i.mode}\n  task: ${i.task}`).join("\n"),
  });
}

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 算出工作區的 cwd（不存在則建立）。mkdir 失敗不阻斷 session 啟動，回 undefined
 *  讓 AgentSession 退回 process.cwd() 預設行為。start/reattach 共用。 */
function resolveCwd(ws: { id: string; workingDir?: string } | undefined): string | undefined {
  if (!ws) return undefined;
  try {
    return ensureWorkspaceDir(ws);
  } catch (e: any) {
    console.warn(`[agentManager] ensureWorkspaceDir 失敗 ws=${ws.id}:`, e?.message || e);
    return undefined;
  }
}

// In-memory tally so /api/security/status can show "X sessions protected
// since dashboard start" without parsing logs.
export const securityStats = {
  startedAt: Date.now(),
  sessionsWithMcp: 0,
  sessionsWithoutMcp: 0,
  lastInjectionAt: 0 as number | 0,
  lastMcpNames: [] as string[],
};

function recordMcp(injected: boolean, names: string[]) {
  if (injected) {
    securityStats.sessionsWithMcp++;
    securityStats.lastInjectionAt = Date.now();
    securityStats.lastMcpNames = names;
  } else {
    securityStats.sessionsWithoutMcp++;
  }
}

// Capability injected into normal user-initiated chats. Lets the agent
// signal "this part should be handled by someone else" via a structured
// marker the frontend detects and turns into an Accept/Reject banner.
const FORK_CAPABILITY = `

# 你可以建議「分支」協作

如果在對話中你判斷某個子問題該交給其他專家處理(例如:你是行銷專家,但問題包含技術細節),可在回答**最末尾**加上分支標記:

\`\`\`
=== FORK: <agent-id> ===
原因: 一句話說明為什麼該由那位 agent 處理
---
要傳給那位 agent 的訊息(它會收到這段作為對話的第一句)
=== END FORK ===
\`\`\`

agent-id 是 dashboard 的識別碼。命名規則:部門 prefix + 角色,例如:
- design-ui-designer, design-brand-guardian, design-image-prompt-engineer
- engineering-code-reviewer, engineering-security-engineer, engineering-data-engineer
- marketing-content-creator, marketing-trend-researcher
- legal-contract-reviewer, finance-financial-analyst
- 各部門皆有 \`部門-角色\` 命名的 agent 可選

## 規則
- **謹慎使用** — 只在子問題明顯不在你專業範圍時才建議,別動不動就丟給別人
- 一次回答**最多 1 個分支建議**
- 使用者會看到提示並選擇接受或忽略,你只是「建議」
`;

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class AgentManager {
  private sessions = new Map<string, AgentSession>();
  // Track when each session was closed (epoch ms). Used for idle eviction.
  private sessionClosedAt = new Map<string, number>();

  constructor() {
    // Run idle-session cleanup every 5 minutes in the background.
    setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000).unref();
  }

  private cleanupIdleSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status === "closed" || session.status === "error") {
        const closedAt = this.sessionClosedAt.get(id) ?? 0;
        if (now - closedAt > SESSION_TTL_MS) {
          session.removeAllListeners();
          this.sessions.delete(id);
          this.sessionClosedAt.delete(id);
          console.log(`[agentManager] evicted idle session ${id.slice(0, 8)}`);
        }
      }
    }
  }

  list(): SessionRecord[] {
    return listSessions().map((rec) => {
      const live = this.sessions.get(rec.id);
      return live ? { ...rec, ...{ /* live status overrides */ } } : rec;
    });
  }

  liveStatus(sessionId: string) {
    const s = this.sessions.get(sessionId);
    return s ? s.status : "closed";
  }

  start(
    agentId: string,
    title?: string,
    extraSystemPrompt?: string,
    workspaceId?: string,
    enableAutoFork: boolean = true,
    provider: Provider = "claude",
  ): AgentSession {
    const wsId = workspaceId || DEFAULT_WORKSPACE_ID;

    // Inject workspace memory if any. This lets agents accumulate knowledge
    // across sessions in the same workspace.
    const memory = getWorkspace(wsId)?.memory || "";
    let memoryBlock = "";
    if (memory.trim()) {
      memoryBlock = `\n\n# 你對這個工作區的累積記憶\n以下是過去對話中你已經學到、確認過的事實。請以此為前提繼續對話,不需要重新確認:\n\n${memory}\n`;
    }

    // Layer 2: agent × workspace 同事記憶 — 這位 agent 對這個使用者在這個
    // 工作區累積的個人理解。透過 memoryDistiller 蒸餾或使用者手動編輯。
    const agentMem = getAgentMemory(wsId, agentId);
    let agentMemoryBlock = "";
    if (agentMem && agentMem.content.trim()) {
      agentMemoryBlock = `\n\n# 你對這位使用者的個人理解(同事記憶)\n以下是你跟這位使用者過去合作中累積的關鍵理解 — 包含他是誰、進行中的專案、他的偏好、過去的關鍵決定。請以此為基礎繼續合作,**不要每次都重新自我介紹或重新詢問同樣的事**:\n\n${agentMem.content.trim()}\n`;
    }

    // 工作區若有專屬登入 Chrome（chromeCdpPort + 勾了 playwright），明確告訴 agent：
    // playwright 已自動連到那個 Chrome、直接用工具操作，**不要自己拿 shell 開新 chrome**。
    // 起因：agent 有 bash 工具 + bypassPermissions，會自作聰明 spawn 一個新 profile 的
    // chrome，結果使用者要再登一次（明明已經登好了）。這段是治本。
    let chromeBrowserBlock = "";
    const wsRecForChrome = getWorkspace(wsId);
    if (wsRecForChrome?.chromeCdpPort && (wsRecForChrome.enabledMcps || []).includes("playwright")) {
      chromeBrowserBlock = `\n\n# 🌐 本工作區已備好專屬瀏覽器（已登入）—— 直接用 playwright，不要自己開

使用者已經在本工作區啟動一個專屬 Chrome（CDP port ${wsRecForChrome.chromeCdpPort}）並登入相關帳號（例如 露天/蝦皮/FB Marketplace/IG 等）。**\`playwright\` MCP 已透過 \`--cdp-endpoint\` 自動連到那個 Chrome**——零設定。

**要操作瀏覽器時**：直接呼叫 \`playwright\` 提供的工具（\`browser_navigate\`、\`browser_snapshot\`、\`browser_click\`、\`browser_type\` 等），它會操作那個**已登入**的視窗。

⚠️ **嚴禁**：
- 不要用 bash/shell/cmd 自己跑 \`chrome.exe\`、不要設新的 \`--user-data-dir\` 或 \`--remote-debugging-port\`
- 不要呼叫 playwright 的 \`launch\` 類工具開新瀏覽器
- 不要假設要重新登入——使用者已經登入好了；你直接 navigate 過去就會看到已登入狀態

若 playwright 工具回錯（例如「未連線」），請直接告訴使用者：「專屬 Chrome 可能未啟動，請到工作區設定按『🌐 啟動專屬 Chrome』」，**不要自己嘗試啟動**。
`;
    }

    // Skill priming:從 agent-skill-map.json 拿這位 agent 應該特別善用的 3-5
    // 個 skill,在 system prompt 開頭點名讓 LLM 更容易觸發。
    const skillPrimingBlock = buildSkillPrimingBlock(agentId);
    // v2：手藝記憶與類能力記憶現在是 workspace-aware。
    // - global / legacy-global 條目：跨工作區可見（legacy 是遷移前的全域記憶，待使用者重審）
    // - workspace 條目：只對該工作區的 agent 可見
    // 注意:craftBlock 與下方的 memoryBlock/agentMemoryBlock 都只在 start()
    // (新開對話)注入。reattach() 喚醒既有對話時不會重建 system prompt,
    // 因此批准後的學習成果只對「之後新開的對話」生效,進行中的舊對話需新開才看得到。
    const craftBlock = buildCapabilityBlockFor(
      getCategoryMemoryFor(categoryFor(agentId), wsId),
      getCraftMemoryFor(agentId, wsId),
    );

    const learningCapability = `

# 學習能力（輸出學習標記）

如果在對話中你發現了**跨對話有長期價值**的東西，可在回答**最末尾**輸出學習標記，系統會收進「學習審核佇列」等使用者批准：

\`\`\`
=== LEARN kind=<下方四選一> ===
一行描述（< 200 字）
=== END LEARN ===
\`\`\`

kind 四選一（直接影響該條會落到哪個範圍）：
- \`fact\` — 關於使用者的事實（他是誰、專案背景、品牌規則）→ **限本工作區**
- \`craft\` — 你的工作手藝改進（下次該怎麼做更好）→ **預設限本工作區**（會綁定當下對話的工作區）
- \`domain\` — 你專業領域的**通用**新知識／演算法／趨勢（與任何客戶/專案無關）→ **跨工作區共享**
- \`calibration\` — 使用者對你的回饋（讚 / 改 / 否定）轉成的行為準則 → **限本工作區**

**重要**：含**具體客戶名、品牌名、專案名、產品名**的條目絕對不可標 \`domain\`（會跨工作區汙染其他客戶的對話）。
這類條目請用 \`fact\` 或 \`craft\`，系統會自動鎖到當下工作區。

規則：每次回答最多 3 條；只記跨對話有用的；不記當下瑣事。
`;

    let combined = (extraSystemPrompt || "") + skillPrimingBlock + craftBlock + memoryBlock + agentMemoryBlock + chromeBrowserBlock + (enableAutoFork ? FORK_CAPABILITY : "") + learningCapability;

    // Codex doesn't have native --agent loading like Claude does. Inject
    // the agent's persona definition into the system prompt manually.
    if (provider === "codex") {
      const def = readAgentDefinition(agentId);
      if (def) {
        combined = `# 你的角色:${def.name}\n\n${def.body}\n\n${combined}`;
      }
    }

    const ws = getWorkspace(wsId);
    const mcpConfig = provider === "claude" ? buildMCPConfigForWorkspace(ws?.enabledMcps || [], ws?.chromeCdpPort) : null;
    if (mcpConfig) {
      const names = Object.keys(JSON.parse(mcpConfig).mcpServers || {});
      console.log(`[agentManager] start session=${agentId} provider=${provider} mcp=${names.join(",")}`);
      recordMcp(true, names);
    } else {
      console.log(`[agentManager] start session=${agentId} provider=${provider} mcp=(none)`);
      recordMcp(false, []);
    }
    // 沙箱：把 agent 的 cwd 指向工作區目錄（不存在則建立）。
    const cwd = resolveCwd(ws);
    const session = new AgentSession(agentId, undefined, combined || undefined, mcpConfig || undefined, provider, cwd);
    // Stash workspace id on session so attachPersistence can append memory
    (session as any).workspaceId = wsId;
    const now = Date.now();
    upsertSession({
      id: session.id,
      workspaceId: wsId,
      agentId,
      title: title || `${agentId} 對話`,
      provider,
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
    this.sessions.set(session.id, session);
    this.attachPersistence(session);
    return session;
  }

  reattach(sessionId: string): AgentSession | undefined {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const rec = getSession(sessionId);
    if (!rec) return;
    // Re-build MCP config so baseline (shellward) gets re-injected. Without
    // this, resumed Claude sessions skipped baseline guards entirely.
    const ws = getWorkspace(rec.workspaceId);
    const mcpConfig = rec.provider === "claude" ? buildMCPConfigForWorkspace(ws?.enabledMcps || [], ws?.chromeCdpPort) : null;
    if (mcpConfig) {
      const names = Object.keys(JSON.parse(mcpConfig).mcpServers || {});
      console.log(`[agentManager] reattach session=${rec.agentId} provider=${rec.provider} mcp=${names.join(",")}`);
      recordMcp(true, names);
    }
    // 沙箱：resume 既有對話時同樣把 cwd 指回工作區目錄。
    const cwd = resolveCwd(ws);
    const session = new AgentSession(rec.agentId, rec.id, undefined, mcpConfig || undefined, rec.provider, cwd);
    if (rec.claudeSessionId) (session as any).claudeSessionId = rec.claudeSessionId;
    if (rec.codexThreadId) (session as any).codexThreadId = rec.codexThreadId;
    (session as any).workspaceId = rec.workspaceId;
    this.sessions.set(session.id, session);
    this.attachPersistence(session);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  send(sessionId: string, text: string): { ok: boolean; injectedNotes?: { title: string }[] } {
    const s = this.sessions.get(sessionId) || this.reattach(sessionId);
    if (!s) return { ok: false };

    // Refresh MCP config from current workspace state — picks up enabledMcps
    // changes made AFTER session was created (e.g. user just enabled
    // playwright in workspace settings, an existing session should immediately
    // get the new tool, no restart needed).
    const wsIdForMcp = (s as any).workspaceId as string | undefined;
    if (s.provider === "claude" && wsIdForMcp) {
      const ws = getWorkspace(wsIdForMcp);
      const fresh = buildMCPConfigForWorkspace(ws?.enabledMcps || [], ws?.chromeCdpPort);
      if (fresh !== s.mcpConfigJson) {
        const oldNames = s.mcpConfigJson ? Object.keys(JSON.parse(s.mcpConfigJson).mcpServers || {}) : [];
        const newNames = fresh ? Object.keys(JSON.parse(fresh).mcpServers || {}) : [];
        console.log(`[agentManager] session=${sessionId.slice(0, 8)} MCP refresh: ${oldNames.join(",") || "(none)"} → ${newNames.join(",") || "(none)"}`);
        s.mcpConfigJson = fresh || undefined;
        // Force respawn so next claude invocation picks up new --mcp-config
        s.stop();
      }
    }

    // Persist the original (clean) user message — don't bloat history with
    // auto-injected note context.
    appendMessage(sessionId, { role: "user", content: text, ts: Date.now() });

    // Auto-inject relevant workspace notes into what we actually send to claude.
    const wsId = (s as any).workspaceId as string | undefined;
    let augmented = text;
    let injectedNotes: { title: string }[] = [];
    if (wsId && !text.includes("<context source=")) {
      // skip injection if user already attached notes manually
      const relevant = findRelevantNotes(wsId, text, 2);
      if (relevant.length > 0) {
        const ctx = formatNotesAsContext(relevant);
        augmented = `${ctx}\n\n${text}`;
        injectedNotes = relevant.map((n) => ({ title: n.title }));
      }
    }
    s.send(augmented);
    return { ok: true, injectedNotes };
  }

  stop(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.stop();
      this.sessionClosedAt.set(sessionId, Date.now());
    }
    this.sessions.delete(sessionId);
    this.sessionClosedAt.delete(sessionId);
  }

  remove(sessionId: string) {
    this.stop(sessionId);
    deleteSession(sessionId);
  }

  private attachPersistence(s: AgentSession) {
    let buffer = "";
    let assistantPersisted = false;
    s.on("event", (evt) => {
      // Track when session reaches a terminal state for idle eviction.
      if (evt.type === "status" && (evt.payload === "closed" || evt.payload === "error")) {
        if (!this.sessionClosedAt.has(s.id)) {
          this.sessionClosedAt.set(s.id, Date.now());
        }
      }
      if (evt.type === "delta") {
        buffer += evt.payload;
      } else if (evt.type === "message") {
        appendMessage(s.id, { role: "assistant", content: evt.payload.content, ts: Date.now() });
        if (s.claudeSessionId) setSessionClaudeId(s.id, s.claudeSessionId);
        if (s.codexThreadId) setSessionCodexThread(s.id, s.codexThreadId);
        assistantPersisted = true;
        // Detect LEARN markers — create proposals for user review
        const wsId = (s as any).workspaceId as string | undefined;
        if (wsId) {
          const drafts = parseLearnMarkers(String(evt.payload.content));
          for (const d of drafts) {
            try {
              createProposal({
                agentId: s.agentId,
                workspaceId: wsId,
                kind: d.kind,
                scope: d.scope,
                content: d.content,
                source: `conversation:${s.id}`,
              });
            } catch (e: any) {
              console.warn(`[agentManager] createProposal failed:`, e?.message || e);
            }
          }
        }
        // 手動派工：偵測 PM 輸出的 DISPATCH 標記 → 寫入 server 待批佇列（根治 client localStorage 競態）。
        const wsForDispatch = (s as any).workspaceId as string | undefined;
        if (wsForDispatch) {
          try { detectAndEnqueueDispatch({ id: s.id, agentId: s.agentId, workspaceId: wsForDispatch }, String(evt.payload.content)); }
          catch (e: any) { console.warn("[agentManager] detectAndEnqueueDispatch", e?.message); }
        }
        buffer = "";
      } else if (evt.type === "result") {
        if (buffer && !assistantPersisted) {
          appendMessage(s.id, { role: "assistant", content: buffer, ts: Date.now() });
          if (s.claudeSessionId) setSessionClaudeId(s.id, s.claudeSessionId);
        }
        buffer = "";
        assistantPersisted = false;
        usageTracker.recordTurn(evt.payload);
        // background auto-titler: kicks in once after first turn
        setTimeout(() => maybeAutoTitle(s.id), 500);
      } else if (evt.type === "tool_image") {
        // MCP 工具回傳的圖片(主要是 playwright 截圖)— 存到 uploads 目錄,
        // 在對話裡插一條 markdown 圖訊息,讓使用者直接看得到。
        try {
          const { base64, mediaType } = evt.payload;
          const ext = (mediaType || "image/png").split("/")[1] || "png";
          const ts = Date.now();
          const fname = `agent-${s.id.slice(0, 8)}-${ts}.${ext}`;
          const filepath = path.join(UPLOAD_DIR, fname);
          fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
          const url = `/api/uploads/${fname}`;
          const md = `![agent screenshot](${url})`;
          appendMessage(s.id, { role: "assistant", content: md, ts: Date.now() });
        } catch (e: any) {
          console.warn(`[agentManager] failed to save tool_image:`, e.message);
        }
      } else if (evt.type === "rate_limit") {
        usageTracker.recordRateLimit(evt.payload);
      }
    });
  }
}

export const agentManager = new AgentManager();
