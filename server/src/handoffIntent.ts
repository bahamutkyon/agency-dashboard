// server/src/handoffIntent.ts
/**
 * 使用者訊息像是要交接（換新對話）→ 送給專案經理時附一段提醒，逼它輸出 HANDOFF 區塊。
 * 背景：長對話裡 PM 會沿用自己的舊習慣（寫 md 檔、叫使用者自己開新對話），手冊規則被蓋過
 * （2026-11-23 實測 96 則的場次即如此）。提醒只送模型，不進對話歷史。
 */
const INTENT = /交接|(換|開)(到|個|一個)?新的?對話|接續到下(一)?(個|位|場)/;

export function isHandoffIntent(text: string): boolean {
  return INTENT.test(text);
}

const BLOCK = `=== HANDOFF ===
🎯 目標：
✅ 已決定：
🔄 進行中：
⏭️ 下一步：
❓ 等你拍板：
📎 重要資料：
=== END HANDOFF ===`;

/** forced=true：使用者按了 🔁 交接鈕（一定是要交接）；false：從文字判斷，可能誤判。 */
export function handoffHint(forced: boolean): string {
  const head = forced
    ? "[系統提示] 使用者按了交接鈕（🔁 交接）。"
    : "[系統提示] 使用者這句話看起來是要交接到新對話。";
  const tail = forced ? "" : "\n如果不是要交接，忽略這段提示，照常回覆。";
  return `${head}這次回覆必須包含下面格式的交接單（每欄填實際內容，沒有就寫「無」，2000 字內），系統才會自動開新對話並帶入：
${BLOCK}
不要只寫檔案、不要叫使用者自己開新對話或貼開場白——系統會自動處理。${tail}`;
}
