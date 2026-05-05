/**
 * Agent memory distiller — manual trigger only (this version).
 *
 * 從某個 session 的對話內容(以及該 (workspace, agent) 既有的 memory)
 * 蒸餾出新版同事記憶。Output ≤ 4KB,寫回 agent_memory。
 *
 * 設計原則:
 *   - 手動觸發(POST /api/agent-memory/distill),你按按鈕才跑
 *   - 用 Haiku(便宜快),不是 Opus
 *   - 結果**取代**舊 memory,不是 append(避免無限累積)
 *   - 蒸餾失敗不噴錯給使用者,只 log
 */
import { spawnClaude } from "./claudeProcess.js";
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

  return new Promise((resolve) => {
    // Use Haiku for cost — fast & cheap; this is a background distillation task
    const child = spawnClaude([
      "-p", "--output-format", "json",
      "--model", "claude-haiku-4-5-20251001",
      "--no-session-persistence",
      "--disable-slash-commands",
    ]);

    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", () => {});
    child.stdout.setEncoding("utf8");
    child.stdin.write(Buffer.from(prompt, "utf8"));
    child.stdin.end();

    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(`[memoryDistiller] claude exit ${code} for session ${sessionId.slice(0, 8)}`);
        resolve({ ok: false, error: `claude exit ${code}` });
        return;
      }
      try {
        const j = JSON.parse(out);
        const text = String(j.result || "").trim();
        if (!text) {
          resolve({ ok: false, error: "空回應" });
          return;
        }
        // Strip leading/trailing markdown code fences if present
        const cleaned = text
          .replace(/^```(?:markdown|md)?\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();

        setAgentMemory(workspaceId, agentId, cleaned, sessionId);
        console.log(`[memoryDistiller] updated memory for (${workspaceId}, ${agentId}) — ${cleaned.length} chars`);
        resolve({ ok: true, newMemory: cleaned });
      } catch (e: any) {
        console.warn("[memoryDistiller] parse failed:", e.message);
        resolve({ ok: false, error: e.message });
      }
    });
  });
}
