/**
 * 對話視窗自動捲動決策。
 * - 剛打開對話（歷史第一次載入）→ 直接跳到最底，接續時不用自己往下拉。
 * - 自己剛送出訊息 → 捲到底。
 * - 貼近底部時有新內容 → 跟著捲；往上翻舊訊息時不打擾。
 */
export function autoScrollMode(o: {
  initialPending: boolean;
  prevCount: number;
  count: number;
  lastRole?: string;
  distanceFromBottom: number;
}): "jump" | "smooth" | "none" {
  if (o.initialPending) return o.count > 0 ? "jump" : "none";
  if (o.count > o.prevCount && o.lastRole === "user") return "smooth";
  if (o.distanceFromBottom < 80) return "smooth";
  return "none";
}
