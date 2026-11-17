/**
 * 一次性：替既有的互動式專案經理對話補「停在哪」摘要與狀態（新對話會在閒置回收時自動產生）。
 * 用法（在 server/ 底下）：npx tsx scripts/backfill-pm-digest.ts [--dry]
 */
import { listSessionsWithCounts } from "../src/store/sessions.js";
import { maybeDigestOnReclaim } from "../src/sessionDigest.js";
import { getSessionState } from "../src/store/sessionState.js";
import { ORCHESTRATOR_ID } from "../src/sessionTitles.js";

const dry = process.argv.includes("--dry");
const AUTOMATED = /^\[(排程|批次|workflow)|^🤖 工作區設定顧問|^🤝 受派諮詢|^🛠️ 外包執行/;
const targets = listSessionsWithCounts().filter(
  (s) => s.agentId === ORCHESTRATOR_ID && s.messageCount >= 2 && !AUTOMATED.test(s.title) && !s.stoppedAt,
);
console.log(`待補摘要：${targets.length} 場${dry ? "（dry run）" : ""}`);
for (const s of targets) {
  if (dry) { console.log(`- ${s.id.slice(0, 8)} ${s.title}`); continue; }
  await maybeDigestOnReclaim(s.id);
  const st = getSessionState(s.id);
  console.log(`${st?.stoppedAt ? "✓" : "✗"} ${s.title} → ${st?.state ?? "-"}｜${st?.stoppedAt ?? "（失敗）"}`);
}
