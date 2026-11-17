/**
 * Background auto-titler. After the first user→assistant exchange in a
 * session that still has its default title, spawn a quick claude call to
 * generate a concise title + tags, then patch the session.
 */
import { runClaudeOneShot } from "./claudeOneShot.js";
import { getSession, upsertSession } from "./store.js";
import { loadAgents } from "./agentLoader.js";
import { modelFor } from "./models.js";
import { isDefaultTitle, displayTitle } from "./sessionTitles.js";

// sessions we've already attempted (avoid retrying on every result)
const attempted = new Set<string>();

/** onTitled：取名成功後通知（agentManager 用 socket 推給前端，讓分頁標題即時更新）。 */
export function maybeAutoTitle(sessionId: string, onTitled?: (sessionId: string, title: string) => void): Promise<void> | undefined {
  if (attempted.has(sessionId)) return;
  const rec = getSession(sessionId);
  if (!rec) return;
  // Need at least one user msg + one assistant msg
  const userCount = rec.messages.filter((m) => m.role === "user").length;
  const assistantCount = rec.messages.filter((m) => m.role === "assistant").length;
  if (userCount < 1 || assistantCount < 1) return;

  // Skip if user/orchestrator already gave a custom-looking title.
  // Default titles are one of:
  //   "${agentId} 對話"                  — frontend didn't pass title
  //   the agent's display name           — orchestrator / openAgent default
  //   `${agentName} · {topic}`           — meeting room custom topic
  //   anything starting with "[排程" / "[批次" / "[workflow"  — automated runs
  //
  // Only the first two count as "default — please replace me".
  const agent = loadAgents().find((a) => a.id === rec.agentId);
  const agentDisplayName = agent?.name || rec.agentId;
  if (!isDefaultTitle(rec.title, rec.agentId, agentDisplayName)) {
    console.log(`[auto-titler] skip ${sessionId.slice(0, 8)} (custom title: "${rec.title.slice(0, 30)}")`);
    return;
  }

  attempted.add(sessionId);

  // 前 2 則＋最後 2 則：長對話（補命名舊紀錄時）標題才不會只反映開場
  const picked = rec.messages.length > 4 ? [...rec.messages.slice(0, 2), ...rec.messages.slice(-2)] : rec.messages.slice(0, 4);
  const transcript = picked.map((m) => {
    const who = m.role === "user" ? "USER" : "ASSISTANT";
    return `### ${who}\n${m.content.slice(0, 1500)}`;
  }).join("\n\n");

  const prompt = `為以下對話產生:
1. 一個 5-15 字的精準標題(繁體中文,直接點題,不要"關於"、"討論"等贅字)
2. 3 個簡短的繁體 tag(每個 2-6 字,用斜線分隔)

對話:
\`\`\`
${transcript.slice(0, 6000)}
\`\`\`

請嚴格用以下格式輸出(不要解釋):
TITLE: 標題
TAGS: tag1 / tag2 / tag3
`;

  // 走 runClaudeOneShot：spawn 失敗 / 逾時安全回 ok:false（背景任務，靜默略過只 log 一行，絕不拋）。
  return runClaudeOneShot([
    "-p", "--output-format", "json", "--model", modelFor("fast"),
    "--no-session-persistence",
    "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 180_000, source: "titler" }).then((r) => {
    if (!r.ok) { console.warn(`[auto-titler] ${sessionId.slice(0, 8)} 失敗：${r.error}`); return; }
    try {
      const j = JSON.parse(r.stdout);
      const text = String(j.result || "");
      const tm = text.match(/TITLE:\s*(.+)/);
      const gm = text.match(/TAGS:\s*(.+)/);
      const cur = getSession(sessionId);
      if (!cur) return;
      const rawTitle = tm?.[1]?.trim().slice(0, 40);
      const tags = gm?.[1]?.split(/[\/、,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 4);
      // 專案經理不加前綴（歷史/分頁已標示角色）；其他 agent 維持「名稱 · 標題」。
      const newTitle = rawTitle ? displayTitle(rawTitle, rec.agentId, agentDisplayName) : null;
      if (newTitle) cur.title = newTitle;
      if (tags && tags.length > 0) {
        // merge with existing
        const set = new Set([...(cur.tags || []), ...tags]);
        cur.tags = Array.from(set).slice(0, 6);
      }
      cur.updatedAt = Date.now();
      upsertSession({ ...cur, messages: undefined as any });
      if (newTitle) onTitled?.(sessionId, newTitle);
      console.log(`[auto-titler] ${sessionId.slice(0, 8)} → "${newTitle}" tags=${tags?.join(",")}`);
    } catch (e: any) {
      console.warn("[auto-titler] parse failed:", e.message);
    }
  });
}
