/**
 * Background auto-titler. After the first user→assistant exchange in a
 * session that still has its default title, spawn a quick claude call to
 * generate a concise title + tags, then patch the session.
 */
import { spawnClaude } from "./claudeProcess.js";
import { getSession, upsertSession } from "./store.js";
import { loadAgents } from "./agentLoader.js";

// sessions we've already attempted (avoid retrying on every result)
const attempted = new Set<string>();

export function maybeAutoTitle(sessionId: string) {
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
  const looksLikeDefault =
    rec.title === `${rec.agentId} 對話` ||
    rec.title === agentDisplayName ||
    rec.title.endsWith(" 對話");
  if (!looksLikeDefault) {
    console.log(`[auto-titler] skip ${sessionId.slice(0, 8)} (custom title: "${rec.title.slice(0, 30)}")`);
    return;
  }
  if (rec.title.includes("[排程") || rec.title.includes("[批次") || rec.title.includes("[workflow")) return;

  attempted.add(sessionId);

  const transcript = rec.messages.slice(0, 4).map((m) => {
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

  const child = spawnClaude([
    "-p", "--output-format", "json",
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
    if (code !== 0) return;
    try {
      const j = JSON.parse(out);
      const text = String(j.result || "");
      const tm = text.match(/TITLE:\s*(.+)/);
      const gm = text.match(/TAGS:\s*(.+)/);
      const cur = getSession(sessionId);
      if (!cur) return;
      const rawTitle = tm?.[1]?.trim().slice(0, 40);
      const tags = gm?.[1]?.split(/[\/、,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 4);
      // Prefix with agent display name so titles never lose the "who" —
      // e.g. "👨‍💼 專案經理 · 三週衝刺規劃" instead of just "三週衝刺規劃".
      // Skip if AI happens to already include the name (avoid duplication).
      const newTitle = rawTitle
        ? (rawTitle.includes(agentDisplayName) ? rawTitle : `${agentDisplayName} · ${rawTitle}`)
        : null;
      if (newTitle) cur.title = newTitle;
      if (tags && tags.length > 0) {
        // merge with existing
        const set = new Set([...(cur.tags || []), ...tags]);
        cur.tags = Array.from(set).slice(0, 6);
      }
      cur.updatedAt = Date.now();
      upsertSession({ ...cur, messages: undefined as any });
      console.log(`[auto-titler] ${sessionId.slice(0, 8)} → "${title}" tags=${tags?.join(",")}`);
    } catch (e: any) {
      console.warn("[auto-titler] parse failed:", e.message);
    }
  });
}
