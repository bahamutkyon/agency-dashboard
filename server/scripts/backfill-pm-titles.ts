/**
 * 一次性：替還沒取名的專案經理對話補標題（2026-11-17 修好 auto-titler 判斷式前，
 * 專案經理對話從沒命名成功過，歷史裡全都只叫「專案經理」）。
 * 用法（在 server/ 底下）：npx tsx scripts/backfill-pm-titles.ts [--dry]
 */
import { listSessionsWithCounts } from "../src/store/sessions.js";
import { maybeAutoTitle } from "../src/autoTitler.js";
import { ORCHESTRATOR_ID, ORCHESTRATOR_TITLE } from "../src/sessionTitles.js";

const dry = process.argv.includes("--dry");
const targets = listSessionsWithCounts().filter(
  (s) => s.agentId === ORCHESTRATOR_ID && s.title === ORCHESTRATOR_TITLE && s.messageCount >= 2,
);
console.log(`待補標題：${targets.length} 場${dry ? "（dry run，不呼叫模型）" : ""}`);
for (const s of targets) {
  if (dry) { console.log(`- ${s.id.slice(0, 8)} ${s.messageCount} 則`); continue; }
  await maybeAutoTitle(s.id, (_id, title) => console.log(`✓ ${s.id.slice(0, 8)} → ${title}`));
}
