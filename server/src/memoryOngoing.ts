/**
 * 同事記憶的「與使用者進行中的事」固定區塊。
 * 背景：蒸餾是整份取代，排程執行的那場也會觸發蒸餾——LP audio 的專案經理記憶曾被每週行情數字洗成
 * 大半，使用者手上那件事（電容定價卡在拍照）只剩一小段。現在規定記憶第一個區塊固定是這個標題，
 * 並在寫入前檢查：舊版有、新版不見 → 放棄這次蒸餾，保留舊版。
 */
export const ONGOING_HEADER = "## 與使用者進行中的事（停在哪／等誰）";

const norm = (s: string) => s.replace(/[\s()（）/／]/g, "");
const KEY = norm(ONGOING_HEADER.replace(/^#+/, ""));

function hasOngoing(md: string): boolean {
  return md.split("\n").some((line) => /^#{2,3}\s/.test(line) && norm(line.replace(/^#+/, "")).startsWith(KEY.slice(0, 8)));
}

/** 新版記憶是否把舊版的「進行中的事」區塊弄丟了。 */
export function dropsOngoingSection(oldMemory: string, newMemory: string): boolean {
  return hasOngoing(oldMemory || "") && !hasOngoing(newMemory || "");
}
