// store 領域共用小工具。

/** 解析存成 JSON 字串的 tags/陣列欄位，壞掉就回空陣列。 */
export function parseTags(s: string | null): string[] {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}
