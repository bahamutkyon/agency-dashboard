import { AgentSession, type Provider } from "./agentSession.js";
import {
  upsertSession, getSession, listSessions, deleteSession, appendMessage, setSessionClaudeId,
  setSessionCodexThread,
  getWorkspace, getAgentMemory,
  DEFAULT_WORKSPACE_ID, type SessionRecord,
} from "./store.js";
import { logActivity, summarizeTool } from "./store/activity.js";
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCraftMemoryFor, getCategoryMemoryFor } from "./learningStore.js";
import { buildCapabilityBlockFor } from "./learningInjector.js";
import { readAgentDefinition, categoryFor } from "./agentLoader.js";
import { buildMCPConfigForWorkspace } from "./mcpDetector.js";
import { usageTracker } from "./usageTracker.js";
import { noteRateLimited, withBackgroundSlot, unmarkShadow } from "./backgroundLimiter.js";
import { maybeDistillOnReclaim } from "./memoryDistiller.js";
import { maybeAutoTitle } from "./autoTitler.js";
import { findRelevantNotes, buildNotesContext } from "./notesRetrieval.js";
import { buildSkillPrimingBlock } from "./skillPriming.js";
import { ensureWorkspaceDir } from "./workspaceDir.js";
import { parseDispatchMarker, serializeDispatchItem } from "./dispatchParser.js";
import { createPendingAction, listPending, getActiveRunForSession } from "./store/autonomy.js";
import { notify } from "./notifier.js";
import { getProjectMemory } from "./store/projects.js";
import { getDelegationProgress } from "./store/delegationProgress.js";
import { detectGoalUpdates, updateGoal } from "./store/goals.js";
import { detectFollowups, createOutcomeCheck, hasOpenDuplicate } from "./store/outcomes.js";
import fs from "node:fs";
import path from "node:path";

/**
 * G1 — 從 PM 訊息偵測 AUTORUN 標記並 emit 確認事件給前端。
 * 格式：=== AUTORUN: <目標句> ===
 * Gate（仿 detectAndEnqueueDispatch）：只認 agents-orchestrator 的輸出；
 * 子 agent 常處理不可信外部內容（網頁/檔案），照抄標記不得觸發起 run。
 * 偵測到後 emit autonomy:event(kind:"autorun:pending", goal) 讓前端彈確認卡；
 * 使用者按確認才打 startRun 端點——不自動起 run（符合「不批 0 花費」原則）。
 */
export function detectAndEnqueueAutorun(
  sess: { id: string; agentId: string; workspaceId: string },
  content: string,
  io?: { emit: (event: string, payload: any) => void },
): void {
  if (sess.agentId !== "agents-orchestrator") return;  // orchestrator-only gate
  const m = /===\s*AUTORUN:\s*(.+?)\s*===/s.exec(content);
  if (!m) return;
  const goal = m[1].trim();
  if (!goal) return;  // 防空目標
  io?.emit("autonomy:event", { sessionId: sess.id, kind: "autorun:pending", goal });
}

/** 從 PM 訊息偵測 DISPATCH 並入待批佇列（手動派工，runId 空）。
 *  去重：同 session 已有相同 summary 的 pending dispatch 則跳過。
 *  有自主 run 進行中時跳過（交給 autonomyRunner，避免雙重入列）。 */
export function detectAndEnqueueDispatch(
  sess: { id: string; agentId: string; workspaceId: string },
  content: string,
  io?: { emit: (event: string, payload: any) => void },
): void {
  if (sess.agentId !== "agents-orchestrator") return;
  if (getActiveRunForSession(sess.id)) return;
  const plan = parseDispatchMarker(content);
  if (!plan || !plan.items.length) return;
  const summary = `派工給 ${plan.items.length} 位：${plan.items.map((i) => i.agentId).join("、")}`;
  const detail = plan.items.map(serializeDispatchItem).join("\n");
  // 去重用 detail（含 task），避免「同 agent 不同 task」被誤判重複漏單
  if (listPending(sess.id).some((p) => p.kind === "dispatch" && p.detail === detail)) return;
  createPendingAction({
    sessionId: sess.id, workspaceId: sess.workspaceId, kind: "dispatch", risk: "high",
    summary, detail,
  });
  // A2：建立 pending 成功後立即 emit，讓前端 useAutonomy 現成 refresh 即時彈出批准卡
  //（沿用既有 autonomy:event 事件名，不新增事件型別）。
  io?.emit("autonomy:event", { sessionId: sess.id, kind: "pending:new" });
  // 員工化推播：手動派工待批 → Telegram（未設定 env 時 no-op；fire-and-forget）
  void notify({ kind: "待批", title: summary.slice(0, 80) });
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

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — evict closed/error sessions from memory
/** 閒置 Claude 子程序 TTL：超過後殺掉子程序，但保留 DB 紀錄與 claudeSessionId，
 *  下次 send() 可透過 --resume 無感恢復。可用 IDLE_SESSION_TTL_MS env 覆蓋（ms）。 */
const IDLE_SESSION_TTL_MS = process.env.IDLE_SESSION_TTL_MS
  ? Math.max(0, Number(process.env.IDLE_SESSION_TTL_MS))
  : 30 * 60 * 1000;

/** 把 tool_call/tool_result 事件寫進 activity_log。回傳寫入 row（供廣播）或 null。 */
export function recordToolActivity(
  sess: { id: string; agentId: string; workspaceId: string },
  evt: { type: string; payload: any },
) {
  try {
    if (evt.type === "tool_call") {
      let detail: string;
      try { detail = JSON.stringify(evt.payload.input); } catch { detail = String(evt.payload.input); }
      return logActivity({ workspaceId: sess.workspaceId, sessionId: sess.id, kind: "tool_call",
        summary: summarizeTool(evt.payload.name, evt.payload.input), detail });
    }
    if (evt.type === "tool_result") {
      return logActivity({ workspaceId: sess.workspaceId, sessionId: sess.id, kind: "tool_result",
        summary: evt.payload.status === "error" ? "工具錯誤" : "工具完成",
        status: evt.payload.status, detail: evt.payload.text || "" });
    }
  } catch (e: any) { console.warn("[agentManager] recordToolActivity", e?.message); }
  return null;
}

function getBusyWatchdogMs(): number {
  const raw = Number(process.env.AUTONOMY_BUSY_WATCHDOG_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45 * 60 * 1000;
}

export class AgentManager {
  private sessions = new Map<string, AgentSession>();
  // Track when each session was closed (epoch ms). Used for idle eviction.
  private sessionClosedAt = new Map<string, number>();
  /** Session-level note dedup: noteIds already injected for each sessionId.
   *  Prevents the same note from being re-injected in every turn of the same session. */
  private injectedNotesBySession = new Map<string, Set<string>>();
  // F4: track when background sessions started being busy (for watchdog)
  private busySince = new Map<string, number>();
  private io?: any;

  /**
   * 可注入的同事記憶蒸餾鉤子（測試時替換，避免打真 LLM）。
   * 預設實作：以 withBackgroundSlot 包住 maybeDistillOnReclaim，背景非阻塞、fail-safe。
   */
  _distillHook: (sessionId: string, workspaceId: string, agentId: string) => void = (sid, wsId, aid) => {
    withBackgroundSlot(() => maybeDistillOnReclaim(sid, wsId, aid))
      .catch((e: any) => console.warn(`[agentManager] reclaim distill error ${sid.slice(0, 8)}:`, e?.message || e));
  };

  setIo(io: any) { this.io = io; }

  constructor() {
    // Run idle-session cleanup every 5 minutes in the background.
    setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000).unref();
  }

  private cleanupIdleSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status === "closed" || session.status === "error") {
        // 已關閉/錯誤的 session — 達到記憶體 TTL 後從 Map 清除
        const closedAt = this.sessionClosedAt.get(id) ?? 0;
        if (now - closedAt > SESSION_TTL_MS) {
          session.removeAllListeners();
          this.sessions.delete(id);
          this.sessionClosedAt.delete(id);
          this.injectedNotesBySession.delete(id);
          console.log(`[agentManager] evicted closed session ${id.slice(0, 8)} from memory`);
        }
      } else if (session.status === "idle" && session.provider === "claude") {
        // 閒置 Claude 子程序 TTL 回收：
        // - 只殺子程序（stop()），DB 紀錄與 claudeSessionId 完整保留
        // - session 留在 Map 中（status 已變 "closed"），下次 send() 仍可找到它
        //   並透過 spawnClaudeChild() → --resume 無感恢復
        // - 絕不回收 busy 狀態（正在執行的對話）
        if (now - session.lastActivityAt > IDLE_SESSION_TTL_MS) {
          this.reclaimClaudeSubprocess(id, session, now, "TTL-killed");
        }
      }
    }
    // F4: Busy watchdog — kill background sessions stuck busy > threshold
    const watchdogMs = getBusyWatchdogMs();
    for (const [id, session] of this.sessions) {
      if (session.status === "busy" && (session as any)._isBackground) {
        const bs = this.busySince.get(id);
        if (bs && now - bs > watchdogMs) {
          console.warn(`[agentManager] busy watchdog: killing background session ${id.slice(0, 8)} (busy ${Math.round((now - bs) / 60000)}min)`);
          this.busySince.delete(id);
          unmarkShadow(id); // watchdog 殺掉逾時仍 busy 的 shadow 子程序 → 一併解除標記，否則永不回收=只增不減
          session.stop();
          this.sessionClosedAt.set(id, now);
        }
      }
    }
  }

  /**
   * 回收一個 idle Claude 子程序的共用實作（TTL 路徑與 dispatch reclaim 路徑共用）：
   * - 只殺子程序（stop()），DB 紀錄與 claudeSessionId 完整保留，下次 send() 走 --resume 無感恢復
   * - 記錄 sessionClosedAt，讓既有的記憶體清除路徑接手
   * - 觸發同事記憶蒸餾（背景 fail-safe 旁路，不可讓回收流程崩）
   * @param source 僅供 log 區分來源（如 "TTL-killed" / "dispatch-reclaimed"）
   */
  private reclaimClaudeSubprocess(id: string, session: AgentSession, now: number, source: string) {
    unmarkShadow(id); // F4: 僅對確實 mark 過的 shadow session 生效（未 mark 為 no-op）
    session.stop(); // 殺子程序，session.status 設為 "closed"
    this.sessionClosedAt.set(id, now); // 讓既有的記憶體清除路徑接手
    console.log(`[agentManager] ${source} idle claude subprocess for session ${id.slice(0, 8)}`);
    // 同事記憶自動蒸餾：背景 fail-safe 旁路，不可讓回收流程崩
    const wsId = (session as any).workspaceId as string | undefined;
    const agentId = (session as any).agentId as string | undefined;
    if (wsId && agentId) {
      try {
        this._distillHook(id, wsId, agentId);
      } catch (e: any) {
        console.warn(`[agentManager] _distillHook error for ${id.slice(0, 8)}:`, e?.message || e);
      }
    }
  }

  /**
   * 派工子 session 拿到結果後立即回收其 claude 子程序（不必等 idle TTL）。
   * 一批派工可能同時有 3-5 個子程序（每個數百 MB），拿到 result 就該立刻釋放，
   * 而非白佔記憶體到 30 分鐘的 TTL 才回收。
   *
   * - 找不到 session → false
   * - 非 idle（busy=可能已被使用者透過「開啟對話」接手深聊；closed/error=已回收或已終態，
   *   重複回收會重複觸發蒸餾並重置 closedAt）→ 保守跳過、false
   * - provider !== "claude"（無常駐子程序可回收）→ false
   * - idle 的 claude session → 與 TTL 路徑完全相同的回收（stop + closedAt + 蒸餾）→ true
   *
   * 回收後 session 仍留在 Map、DB 與 claudeSessionId 完整保留，下次 send() 走 --resume 無感恢復。
   */
  reclaimSubprocess(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.status !== "idle") return false; // 只回收確定 idle 的（busy=接手深聊中；closed=避免重複蒸餾）
    if (session.provider !== "claude") return false; // 非 claude 無常駐子程序
    this.reclaimClaudeSubprocess(sessionId, session, Date.now(), "dispatch-reclaimed");
    return true;
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
    projectId?: string,
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

    // 專案記憶：若此 session 歸屬某專案，注入該專案的持久記憶/狀態。
    let projectMemoryBlock = "";
    if (projectId) {
      const pm = getProjectMemory(projectId);
      if (pm && pm.trim()) {
        projectMemoryBlock = `\n\n# 本專案的記憶 / 狀態\n以下是這個專案累積的決策、狀態與脈絡，請以此為前提繼續：\n\n${pm.trim()}\n`;
      }
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

    let combined = (extraSystemPrompt || "") + skillPrimingBlock + craftBlock + memoryBlock + agentMemoryBlock + projectMemoryBlock + chromeBrowserBlock + (enableAutoFork ? FORK_CAPABILITY : "") + learningCapability;

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
      projectId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
    this.sessions.set(session.id, session);
    // F4: mark background sessions for busy watchdog
    if (!enableAutoFork) {
      (session as any)._isBackground = true;
    }
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

  send(sessionId: string, text: string): { ok: boolean; injectedNotes?: { title: string }[]; turnId?: number } {
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
        // 搶救佇列：stop() 會清空 queue，但佇列訊息已落庫。
        // 先取快照，stop() 後重新 send（AgentSession.send，不重複落庫），
        // 確保 MCP 重生不丟失已排隊但尚未送達的訊息。
        const savedQueue = [...s.queuedMessages];
        const oldNames = s.mcpConfigJson ? Object.keys(JSON.parse(s.mcpConfigJson).mcpServers || {}) : [];
        const newNames = fresh ? Object.keys(JSON.parse(fresh).mcpServers || {}) : [];
        console.log(`[agentManager] session=${sessionId.slice(0, 8)} MCP refresh: ${oldNames.join(",") || "(none)"} → ${newNames.join(",") || "(none)"}`);
        s.mcpConfigJson = fresh || undefined;
        // Force respawn so next claude invocation picks up new --mcp-config
        s.stop();
        // 把搶救的佇列訊息重新注入（順序保留），當前訊息最後 enqueue。
        for (const msg of savedQueue) {
          s.send(msg);
        }
      }
    }

    // Auto-inject relevant workspace notes into what we actually send to claude.
    // Session-level dedup: each note is injected at most once per session.
    const wsId = (s as any).workspaceId as string | undefined;
    let augmented = text;
    let injectedNotes: { title: string }[] = [];
    if (wsId && !text.includes("<context source=")) {
      // skip injection if user already attached notes manually
      const relevant = findRelevantNotes(wsId, text, 2);
      if (relevant.length > 0) {
        // Filter out notes already injected for this session
        const alreadyInjected = this.injectedNotesBySession.get(sessionId) ?? new Set<string>();
        const fresh = relevant.filter((n) => !alreadyInjected.has(n.id));
        if (fresh.length > 0) {
          // 只把「實際納入 context」的 note 標記為已注入——4000 字總量上限可能把
          // 後段 note 整塊丟掉，若一律標記已注入，被丟掉的會永遠不再重試。
          const { text: ctx, included } = buildNotesContext(fresh);
          if (included.length > 0) {
            augmented = `${ctx}\n\n${text}`;
            injectedNotes = included.map((n) => ({ title: n.title }));
            // Record injected noteIds for this session（僅真正納入的）
            const updated = new Set(alreadyInjected);
            for (const n of included) updated.add(n.id);
            this.injectedNotesBySession.set(sessionId, updated);
          }
        }
      }
    }

    // 先送（或排隊）再落庫：只有 session 確實接受了訊息（sent / queued，兩者都保證
    // 最終會送達模型——busy 現在會排隊、回 idle 抽乾）才把使用者訊息寫入 DB。
    // 這樣杜絕舊有的「落庫了但因 busy 被丟棄、永遠不會送」的 DB↔模型永久分岔。
    // 唯一不落庫的情況是 rejected（佇列爆滿的異常保護），此時本就沒送出。
    const result = s.send(augmented);
    if (result === "rejected") {
      return { ok: false };
    }
    // 透傳這一回合的 turnId 給等待端（send 為同步，此刻 lastTurnId 即這則的 turnId）。
    // 舊/假 session 無 lastTurnId → undefined，等待端會走向後相容全收路徑。
    const turnId = (s as any).lastTurnId as number | undefined;

    // Persist the original (clean) user message — don't bloat history with
    // auto-injected note context.
    appendMessage(sessionId, { role: "user", content: text, ts: Date.now() });
    return { ok: true, injectedNotes, turnId };
  }

  stop(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.stop();
      this.sessionClosedAt.set(sessionId, Date.now());
    }
    this.sessions.delete(sessionId);
    this.sessionClosedAt.delete(sessionId);
    this.injectedNotesBySession.delete(sessionId);
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
      // F4: track busySince for busy watchdog
      if (evt.type === "status") {
        if (evt.payload === "busy") {
          if (!this.busySince.has(s.id)) {
            this.busySince.set(s.id, Date.now());
          }
        } else {
          this.busySince.delete(s.id);
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
          try { detectAndEnqueueDispatch({ id: s.id, agentId: s.agentId, workspaceId: wsForDispatch }, String(evt.payload.content), this.io); }
          catch (e: any) { console.warn("[agentManager] detectAndEnqueueDispatch", e?.message); }
        }
        // G1：偵測 PM 輸出的 AUTORUN 標記 → emit 確認事件給前端彈一鍵起自走確認卡。
        // Gate 在 detectAndEnqueueAutorun 內部（只認 orchestrator）。
        if (wsForDispatch) {
          try { detectAndEnqueueAutorun({ id: s.id, agentId: s.agentId, workspaceId: wsForDispatch }, String(evt.payload.content), this.io); }
          catch (e: any) { console.warn("[agentManager] detectAndEnqueueAutorun", e?.message); }
        }
        // 目標帳本：偵測 PM 輸出的 GOAL_UPDATE 標記 → 直接更新目標現值（低風險自動化）。
        // 邊界（安全）：只認 orchestrator 的輸出——goals block 只注入 PM，子 agent 沒有
        // 正當理由改目標；且子 agent 常處理不可信外部內容（網頁/檔案），若照抄了內容裡的
        // 標記不能讓它觸發 DB 寫入。同時要求 workspaceId 存在並傳入 updateGoal 驗證，
        // 杜絕跨工作區誤改。
        if (s.agentId === "agents-orchestrator" && wsForDispatch) {
          try {
            const goalHits = detectGoalUpdates(String(evt.payload.content));
            for (const goalHit of goalHits) {
              try {
                const updated = updateGoal(goalHit.goalId, { currentValue: goalHit.newValue }, wsForDispatch);
                if (updated) {
                  const row = logActivity({ workspaceId: wsForDispatch, sessionId: s.id, kind: "goal_update", summary: `目標現值更新：${updated.title} → ${goalHit.newValue}` });
                  this.io?.emit("activity:event", row);
                }
              } catch (e: any) { console.warn("[agentManager] detectGoalUpdates item", e?.message); }
            }
          } catch (e: any) { console.warn("[agentManager] detectGoalUpdates", e?.message); }
          // 成效回訪：偵測 PM 輸出的 FOLLOWUP 標記 → 掛一筆到期回訪（第 2 層經營迴路地基）。
          // 同 gate（只認 orchestrator + 有 workspaceId）：goals/outcomes block 只注入 PM，
          // 子 agent 常處理不可信外部內容，不能讓照抄的標記觸發 DB 寫入。壞標記靜默略過。
          try {
            const fus = detectFollowups(String(evt.payload.content));
            for (const fu of fus) {
              try {
                // 去重：同工作區已有未結案（pending/notified）且描述完全相同的回訪 → skip
                // （PM 在多個回合重複吐同一標記時不重複掛，也不 log activity）。
                if (hasOpenDuplicate(wsForDispatch, fu.description)) continue;
                const dueAt = Date.now() + fu.days * 24 * 60 * 60 * 1000;
                const oc = createOutcomeCheck({ workspaceId: wsForDispatch, description: fu.description, dueAt });
                const row = logActivity({ workspaceId: wsForDispatch, sessionId: s.id, kind: "outcome_create", summary: `成效回訪已掛：${fu.days}d｜${oc.description.slice(0, 60)}` });
                this.io?.emit("activity:event", row);
              } catch (e: any) { console.warn("[agentManager] detectFollowups item", e?.message); }
            }
          } catch (e: any) { console.warn("[agentManager] detectFollowups", e?.message); }
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
        // 撞到 rate limit → 觸發全域背景退避，讓所有背景/批量子系統自動暫緩，
        // 不繼續火上加油打爆額度。互動聊天不經過限流器、不受影響。
        // 用預設退避（不吃 resetsAt，避免把軟訊號當成數小時 lockout 凍住背景）。
        noteRateLimited();
      } else if (evt.type === "tool_call" || evt.type === "tool_result") {
        const wsId = (s as any).workspaceId as string | undefined;
        const row = recordToolActivity({ id: s.id, agentId: s.agentId, workspaceId: wsId || "" }, evt);
        if (row) {
          this.io?.emit("activity:event", row);
          // 進度心跳：tool_call 發生時廣播 delegation:progress，
          // 讓前端能即時更新在途 execute 派工的進度（不需輪詢）。
          // 前端依 subSessionId 比對自身持有的 delegation list 來決定是否更新。
          if (evt.type === "tool_call" && this.io) {
            try {
              const prog = getDelegationProgress(s.id);
              this.io.emit("delegation:progress", { subSessionId: s.id, ...prog });
            } catch { /* 不阻斷主流程 */ }
          }
        }
      }
    });
  }
}

export const agentManager = new AgentManager();
