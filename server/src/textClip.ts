/**
 * textClip.ts —— 長文截斷的共用工具。
 *
 * 起因：舊版各處用 `text.slice(0, N)` 只保留「開頭」。對「對話紀錄」這類越後面越重要的內容
 * 是錯的——長對話做摘要／蒸餾時，最新的進展、決定反而整段被丟掉。這裡提供兩種語意明確的截法。
 * 以 code point 為單位計算，避免把 emoji 等 astral 字元切成 lone surrogate（會讓整包 prompt
 * 變非法 UTF-8 被 API 拒收，見 routes/sessions.ts truncateForCatalog 的同款處理）。
 */

const MIDDLE_MARKER = "\n\n…（中間省略 {n} 字，保留開頭與最新的部分）…\n\n";
const TAIL_MARKER = "…（較早的 {n} 字已省略，以下保留最新的部分）…\n\n";

/** 保留頭尾、省略中段。headRatio＝開頭佔可用額度的比例（預設 0.3，其餘留給結尾）。 */
export function clipMiddle(text: string, max: number, headRatio = 0.3): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const budget = Math.max(0, max);
  const headLen = Math.floor(budget * Math.min(Math.max(headRatio, 0), 1));
  const tailLen = budget - headLen;
  const omitted = chars.length - headLen - tailLen;
  return chars.slice(0, headLen).join("")
    + MIDDLE_MARKER.replace("{n}", String(omitted))
    + chars.slice(chars.length - tailLen).join("");
}

/** 只保留最新（結尾）的 max 字。 */
export function clipKeepTail(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = Math.max(0, max);
  const omitted = chars.length - keep;
  return TAIL_MARKER.replace("{n}", String(omitted)) + chars.slice(chars.length - keep).join("");
}
