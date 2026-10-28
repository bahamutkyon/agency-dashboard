/**
 * 把 Claude model id 轉成好讀的名稱：claude-opus-5-5 → "Opus 5.5"、
 * claude-haiku-4-5-20251001 → "Haiku 4.5"、claude-opus-4-6[1m] → "Opus 4.6 (1M)"。
 * 認不得的 id 原樣回傳（寧可顯示原文，也不要猜錯）。
 */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return "";
  const oneM = /\[1m\]$/i.test(id);
  const bare = id.replace(/\[1m\]$/i, "");
  const m = bare.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (!m) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}${oneM ? " (1M)" : ""}`;
}
