import { AgentSession } from "./agentSession.js";
import { upsertSession, getSession, listSessions, deleteSession, appendMessage, setSessionClaudeId, DEFAULT_WORKSPACE_ID, type SessionRecord } from "./store.js";
import { usageTracker } from "./usageTracker.js";

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
  ): AgentSession {
    const combined = (extraSystemPrompt || "") + (enableAutoFork ? FORK_CAPABILITY : "");
    const session = new AgentSession(agentId, undefined, combined || undefined);
    const now = Date.now();
    upsertSession({
      id: session.id,
      workspaceId: workspaceId || DEFAULT_WORKSPACE_ID,
      agentId,
      title: title || `${agentId} 對話`,
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
    const session = new AgentSession(rec.agentId, rec.id);
    if (rec.claudeSessionId) (session as any).claudeSessionId = rec.claudeSessionId;
    this.sessions.set(session.id, session);
    this.attachPersistence(session);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  send(sessionId: string, text: string): boolean {
    const s = this.sessions.get(sessionId) || this.reattach(sessionId);
    if (!s) return false;
    appendMessage(sessionId, { role: "user", content: text, ts: Date.now() });
    s.send(text);
    return true;
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
        assistantPersisted = true;
        buffer = "";
      } else if (evt.type === "result") {
        if (buffer && !assistantPersisted) {
          appendMessage(s.id, { role: "assistant", content: buffer, ts: Date.now() });
          if (s.claudeSessionId) setSessionClaudeId(s.id, s.claudeSessionId);
        }
        buffer = "";
        assistantPersisted = false;
        usageTracker.recordTurn(evt.payload);
      } else if (evt.type === "rate_limit") {
        usageTracker.recordRateLimit(evt.payload);
      }
    });
  }
}

export const agentManager = new AgentManager();
