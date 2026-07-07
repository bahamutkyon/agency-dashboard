import type { BriefingRow } from "./cockpitTypes.js";

/**
 * 簡報自癒過濾：已批准/駁回的提案不該再以「待拍板建議」出現在簡報裡。
 *
 * 背景：簡報存檔後內容是靜態快照；使用者按「照建議批准」只改了 learning_proposals
 * 的狀態，不會回寫簡報。若不過濾，重新整理/回到簡報頁就會再看到已處理的建議。
 *
 * 規則（純函式、不改動輸入）：
 * - item.action.proposalIds 只保留仍在 pendingIds 裡的
 * - 全部已處理 → 整個 item 移除
 * - section 因此清空 → 整個 section 移除
 */
export function sanitizeBriefingRow(row: BriefingRow, pendingIds: Set<string>): BriefingRow {
  if (!row.content) return row;
  let changed = false;

  const sections: typeof row.content.sections = [];
  for (const sec of row.content.sections) {
    const items: typeof sec.items = [];
    let secChanged = false;
    for (const it of sec.items) {
      if (!it.action) { items.push(it); continue; }
      const keep = it.action.proposalIds.filter((id) => pendingIds.has(id));
      if (keep.length === it.action.proposalIds.length) { items.push(it); continue; }
      secChanged = true;
      if (keep.length > 0) items.push({ ...it, action: { ...it.action, proposalIds: keep } });
      // keep.length === 0 → 建議已全數處理，整個 item 不再顯示
    }
    if (items.length > 0 || sec.items.length === 0) {
      sections.push(secChanged ? { ...sec, items } : sec);
    }
    // items 被清空（且原本非空）→ section 整個移除
    changed = changed || secChanged;
  }

  if (!changed) return row;
  return { ...row, content: { ...row.content, sections } };
}
