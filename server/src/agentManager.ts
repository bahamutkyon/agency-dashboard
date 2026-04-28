import { AgentSession } from "./agentSession.js";
import { upsertSession, getSession, listSessions, deleteSession, appendMessage, setSessionClaudeId, DEFAULT_WORKSPACE_ID, type SessionRecord } from "./store.js";
import { usageTracker } from "./usageTracker.js";

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

  start(agentId: string, title?: string, extraSystemPrompt?: string, workspaceId?: string): AgentSession {
    const session = new AgentSession(agentId, undefined, extraSystemPrompt);
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
