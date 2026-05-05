import { AgentSession, type Provider } from "./agentSession.js";
import {
  upsertSession, getSession, listSessions, deleteSession, appendMessage, setSessionClaudeId,
  setSessionCodexThread,
  appendWorkspaceMemory, getWorkspace, getAgentMemory,
  DEFAULT_WORKSPACE_ID, type SessionRecord,
} from "./store.js";
import { readAgentDefinition } from "./agentLoader.js";
import { buildMCPConfigForWorkspace } from "./mcpDetector.js";
import { usageTracker } from "./usageTracker.js";
import { maybeAutoTitle } from "./autoTitler.js";
import { findRelevantNotes, formatNotesAsContext } from "./notesRetrieval.js";

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

export class AgentManager {
  private sessions = new Map<string, AgentSession>();

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

    const memoryCapability = `\n\n# 累積記憶能力\n如果在對話中你發現使用者揭露了重要的、跨對話有價值的事實(偏好、決定、客戶背景、品牌規則等),你可以**在回答最末尾**輸出記憶標記讓系統累積:\n\n\`\`\`\n=== REMEMBER ===\n簡短描述(一行,< 80 字),例如:使用者偏好親切口語、不要長篇大論\n=== END REMEMBER ===\n\`\`\`\n\n規則:每次回答最多 1 條;只記跨對話有用的事實;不要記當下情境的瑣事。\n`;

    let combined = (extraSystemPrompt || "") + memoryBlock + agentMemoryBlock + (enableAutoFork ? FORK_CAPABILITY : "") + memoryCapability;

    // Codex doesn't have native --agent loading like Claude does. Inject
    // the agent's persona definition into the system prompt manually.
    if (provider === "codex") {
      const def = readAgentDefinition(agentId);
      if (def) {
        combined = `# 你的角色:${def.name}\n\n${def.body}\n\n${combined}`;
      }
    }

    const ws = getWorkspace(wsId);
    const mcpConfig = provider === "claude" ? buildMCPConfigForWorkspace(ws?.enabledMcps || []) : null;
    if (mcpConfig) {
      const names = Object.keys(JSON.parse(mcpConfig).mcpServers || {});
      console.log(`[agentManager] start session=${agentId} provider=${provider} mcp=${names.join(",")}`);
      recordMcp(true, names);
    } else {
      console.log(`[agentManager] start session=${agentId} provider=${provider} mcp=(none)`);
      recordMcp(false, []);
    }
    const session = new AgentSession(agentId, undefined, combined || undefined, mcpConfig || undefined, provider);
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
    const mcpConfig = rec.provider === "claude" ? buildMCPConfigForWorkspace(ws?.enabledMcps || []) : null;
    if (mcpConfig) {
      const names = Object.keys(JSON.parse(mcpConfig).mcpServers || {});
      console.log(`[agentManager] reattach session=${rec.agentId} provider=${rec.provider} mcp=${names.join(",")}`);
      recordMcp(true, names);
    }
    const session = new AgentSession(rec.agentId, rec.id, undefined, mcpConfig || undefined, rec.provider);
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
    if (s) s.stop();
    this.sessions.delete(sessionId);
  }

  remove(sessionId: string) {
    this.stop(sessionId);
    deleteSession(sessionId);
  }

  private attachPersistence(s: AgentSession) {
    let buffer = "";
    let assistantPersisted = false;
    s.on("event", (evt) => {
      if (evt.type === "delta") {
        buffer += evt.payload;
      } else if (evt.type === "message") {
        appendMessage(s.id, { role: "assistant", content: evt.payload.content, ts: Date.now() });
        if (s.claudeSessionId) setSessionClaudeId(s.id, s.claudeSessionId);
        if (s.codexThreadId) setSessionCodexThread(s.id, s.codexThreadId);
        assistantPersisted = true;
        // Detect REMEMBER markers — append to workspace memory
        const wsId = (s as any).workspaceId as string | undefined;
        if (wsId) {
          const matches = String(evt.payload.content).matchAll(/===\s*REMEMBER\s*===\s*\n([\s\S]*?)\n===\s*END\s*REMEMBER\s*===/gi);
          for (const m of matches) {
            const entry = m[1].trim();
            if (entry && entry.length < 200) appendWorkspaceMemory(wsId, entry);
          }
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
      } else if (evt.type === "rate_limit") {
        usageTracker.recordRateLimit(evt.payload);
      }
    });
  }
}

export const agentManager = new AgentManager();
