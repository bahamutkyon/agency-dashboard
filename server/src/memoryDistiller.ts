/**
 * Agent memory distiller.
 *
 * 從某個 session 的對話內容(以及該 (workspace, agent) 既有的 memory)
 * 蒸餾出新版同事記憶。Output ≤ 4KB,寫回 agent_memory。
 *
 * 設計原則:
 *   - 手動觸發(POST /api/agent-memory/distill)或 idle TTL 回收時自動觸發
 *   - 用 Haiku(便宜快),不是 Opus
 *   - 結果**取代**舊 memory,不是 append(避免無限累積)
 *   - 蒸餾失敗不噴錯給使用者,只 log
 *
 * 自動觸發路徑(idle TTL 回收):
 *   - agentManager.cleanupIdleSessions 回收閒置 Claude session 時呼叫
 *     maybeDistillOnReclaim — 背景、fail-safe、去重、短對話跳過
 */
import { runClaudeOneShot } from "./claudeOneShot.js";
import { getSession, getAgentMemory, setAgentMemory } from "./store.js";
import { loadAgents } from "./agentLoader.js";

export interface DistillResult {
  ok: boolean;
  newMemory?: string;
  error?: string;
}

export async function distillAgentMemory(
  sessionId: string,
  workspaceId: string,
  agentId: string,
): Promise<DistillResult> {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "session not found" };

  const messages = session.messages || [];
  if (messages.length < 2) {
    return { ok: false, error: "對話太短,至少要有一輪 user → agent 才能蒸餾" };
  }

  const existing = getAgentMemory(workspaceId, agentId);
  const existingContent = existing?.content || "";

  const agent = loadAgents().find((a) => a.id === agentId);
  const agentName = agent?.name || agentId;

  // Take last ~30 messages, truncated, to keep prompt manageable
  const transcript = messages.slice(-30).map((m) => {
    const who = m.role === "user" ? "USER" : "ASSISTANT";
    return `### ${who}\n${m.content.slice(0, 1500)}`;
  }).join("\n\n");

  const prompt = `你是「${agentName}」這位 agent。你正在更新「對這位使用者的個人理解(同事記憶)」。

# 任務
讀完以下兩份資料,輸出一份新版的同事記憶 markdown:
1. 你目前對使用者的理解(若為空則是第一次蒸餾)
2. 這場對話的內容

新版記憶要包含哪些東西(只有確認過的事實,不要推測):
- 使用者是誰(背景、角色、業務)
- 進行中的專案 / 議題(本次對話相關的更新進度)
- 使用者的偏好 / 風格 / 禁忌
- 你們已經做出的關鍵決定
- 任何「下次跟這位使用者開會時應該記得」的事

# 嚴格規則
- 用繁體中文
- 用 markdown,結構分明(## 標題 + 條列)
- **總字數 ≤ 1500 字**(超過 4KB 會被截斷)
- **不要照抄對話**,要消化成有用的事實
- **不要記今天天氣這種瑣事**,只記跨會議有用的長期理解
- 若這場對話沒新資訊,**保留舊記憶不要硬改**

---

# 你目前對使用者的理解(可能為空)

\`\`\`markdown
${existingContent || "(尚無記憶,這是第一次蒸餾)"}
\`\`\`

---

# 本次對話內容(最近 30 則)

\`\`\`
${transcript.slice(0, 12000)}
\`\`\`

---

請直接輸出新版同事記憶 markdown,不要解釋,不要 code fence:`;

  // Use Haiku for cost — fast & cheap; this is a background distillation task。
  // 走 runClaudeOneShot：spawn 失敗 / 逾時安全回 ok:false，只 log 不拋（背景任務不該崩 server）。
  const r = await runClaudeOneShot([
    "-p", "--output-format", "json",
    "--model", "claude-haiku-4-5-20251001",
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 180_000 });

  if (!r.ok) {
    console.warn(`[memoryDistiller] claude 失敗 for session ${sessionId.slice(0, 8)}: ${r.error}`);
    return { ok: false, error: r.error || "claude 失敗" };
  }
  try {
    const j = JSON.parse(r.stdout);
    const text = String(j.result || "").trim();
    if (!text) {
      return { ok: false, error: "空回應" };
    }
    // Strip leading/trailing markdown code fences if present
    const cleaned = text
      .replace(/^```(?:markdown|md)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    setAgentMemory(workspaceId, agentId, cleaned, sessionId);
    console.log(`[memoryDistiller] updated memory for (${workspaceId}, ${agentId}) — ${cleaned.length} chars`);
    return { ok: true, newMemory: cleaned };
  } catch (e: any) {
    console.warn("[memoryDistiller] parse failed:", e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * idle TTL 回收後自動蒸餾同事記憶的入口。背景非阻塞、fail-safe。
 *
 * Guards（任一成立就跳過，不打 LLM）：
 *   1. 去重：agent_memory.distilledFromSessionId === sessionId → 已蒸餾過，跳過
 *   2. 短對話：session 訊息數 < 2 → 對話不夠，跳過
 *   3. session 不存在 → 跳過
 *
 * @param distiller 可注入的蒸餾函式（預設 distillAgentMemory；測試時傳入 fake 避免打真 LLM）
 */
export async function maybeDistillOnReclaim(
  sessionId: string,
  workspaceId: string,
  agentId: string,
  distiller: (sid: string, wsId: string, aid: string) => Promise<DistillResult> = distillAgentMemory,
): Promise<void> {
  try {
    // Guard 1: 去重 — 同一 session 已蒸餾過就跳過
    const existing = getAgentMemory(workspaceId, agentId);
    if (existing?.distilledFromSessionId === sessionId) {
      console.log(`[memoryDistiller] skip reclaim — already distilled from session ${sessionId.slice(0, 8)}`);
      return;
    }
    // Guard 2 & 3: 短對話前置 guard — session 不存在或訊息 < 2 就跳過
    // （distillAgentMemory 裡也有同樣 guard，但在此提前跳過省一次 LLM 呼叫）
    const sess = getSession(sessionId);
    const msgCount = (sess?.messages || []).length;
    if (msgCount < 2) {
      console.log(`[memoryDistiller] skip reclaim — too short (msgs=${msgCount}) for session ${sessionId.slice(0, 8)}`);
      return;
    }
    const result = await distiller(sessionId, workspaceId, agentId);
    if (!result.ok) {
      console.warn(`[memoryDistiller] reclaim distill failed (${workspaceId}, ${agentId}): ${result.error}`);
    }
  } catch (e: any) {
    // fail-safe: 任何意外錯誤只 log，不拋，確保呼叫端（agentManager 回收迴圈）不受影響
    console.warn(`[memoryDistiller] maybeDistillOnReclaim error (${sessionId.slice(0, 8)}):`, e?.message || e);
  }
}
