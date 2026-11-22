/**
 * 對話「停在哪」摘要（方案 C2）。專案經理對話閒置被回收時跑一次快速模型：
 *   STOPPED_AT：一句話，停在哪、下一步等誰
 *   STATE：open | waiting_user | done
 * 只是提示：可能判斷錯，所以不拿來自動隱藏或封存任何對話，使用者可以一鍵手動改（state_source=manual）。
 */
import { runClaudeOneShot } from "./claudeOneShot.js";
import { getSession } from "./store.js";
import { getSessionState, setAutoDigest, type SessionStateValue } from "./store/sessionState.js";
import { modelFor } from "./models.js";
import { ORCHESTRATOR_ID } from "./sessionTitles.js";

const STATES: SessionStateValue[] = ["open", "waiting_user", "done"];
export const AUTOMATED = /^\[(排程|批次|workflow)|^🤖 工作區設定顧問|^🤝 受派諮詢|^🛠️ 外包執行/;

export function parseDigest(text: string): { stoppedAt: string; state: SessionStateValue } | null {
  const stopped = text.match(/STOPPED_AT:\s*(.+)/)?.[1]?.trim();
  const state = text.match(/STATE:\s*([a-z_]+)/)?.[1]?.trim() as SessionStateValue | undefined;
  if (!stopped || !state || !STATES.includes(state)) return null;
  return { stoppedAt: [...stopped].slice(0, 80).join(""), state };
}

async function defaultRunner(prompt: string): Promise<string> {
  const r = await runClaudeOneShot([
    "-p", "--output-format", "json", "--model", modelFor("fast"),
    "--no-session-persistence", "--disable-slash-commands",
  ], { input: prompt, timeoutMs: 120_000, source: "digest" });
  if (!r.ok) throw new Error(r.error || "claude 失敗");
  return String(JSON.parse(r.stdout).result || "");
}

/** 背景、fail-safe：任何失敗只 log。runner 可注入（測試不打真 LLM）。 */
export async function maybeDigestOnReclaim(sessionId: string, runner: (prompt: string) => Promise<string> = defaultRunner): Promise<void> {
  try {
    const s = getSession(sessionId);
    if (!s || s.agentId !== ORCHESTRATOR_ID || AUTOMATED.test(s.title)) return;
    const msgs = (s.messages || []).filter((m) => m.role !== "system");
    if (msgs.length < 2) return;
    const lastTs = Math.max(...msgs.map((m) => m.ts || 0));
    const cur = getSessionState(sessionId);
    if (cur?.digestAt && cur.digestAt >= lastTs) return; // 上次摘要後沒新訊息

    const transcript = msgs.slice(-6).map((m) => `### ${m.role === "user" ? "使用者" : "專案經理"}\n${m.content.slice(0, 2500)}`).join("\n\n");
    const prompt = `以下是使用者和專案經理一場對話的最後幾則。用一句話說明「停在哪、下一步輪到誰」，並判斷狀態。

狀態只能選一個：
- waiting_user：專案經理問了問題、給了選項、或在等使用者提供資料／拍板
- open：事情還在進行，下一步是專案經理或同事要做的
- done：這件事已經講完或做完，沒有待辦

對話：
\`\`\`
${transcript}
\`\`\`

嚴格用以下格式輸出（繁體中文、不要解釋）：
STOPPED_AT: 一句話，60 字內
STATE: waiting_user | open | done`;
    const parsed = parseDigest(await runner(prompt));
    if (!parsed) { console.warn(`[sessionDigest] ${sessionId.slice(0, 8)} 輸出格式不符，略過`); return; }
    setAutoDigest(sessionId, parsed.stoppedAt, parsed.state);
    console.log(`[sessionDigest] ${sessionId.slice(0, 8)} → ${parsed.state}｜${parsed.stoppedAt}`);
  } catch (e: any) {
    console.warn(`[sessionDigest] ${sessionId.slice(0, 8)} 失敗：${e?.message || e}`);
  }
}
