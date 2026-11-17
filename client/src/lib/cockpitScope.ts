import type { BriefingItem, BriefingSection } from "./api";

export interface ScopedEntry { item: BriefingItem; sectionIdx: number; itemIdx: number; }
export interface ScopedSection { kind: BriefingSection["kind"]; title: string; items: BriefingItem[]; entries: ScopedEntry[]; }

/**
 * 總管簡報是跨工作區的全局快照。依目前工作區分流：
 * - current：屬於本工作區、或不屬任何工作區（如學習 triage）的項目，依原區塊排列
 * - others：其他工作區的項目（前端折疊顯示，避免在 LP audio 被帶去討論個人IP）
 * 預設工作區當「總覽」，全部顯示。索引保留原始位置，供就地移除用。
 */
export function scopeBriefing(sections: BriefingSection[], activeWorkspaceId: string): { current: ScopedSection[]; others: ScopedEntry[] } {
  const overview = !activeWorkspaceId || activeWorkspaceId === "default";
  const current: ScopedSection[] = [];
  const others: ScopedEntry[] = [];
  sections.forEach((sec, sectionIdx) => {
    const entries: ScopedEntry[] = [];
    sec.items.forEach((item, itemIdx) => {
      const e = { item, sectionIdx, itemIdx };
      if (overview || !item.workspaceId || item.workspaceId === activeWorkspaceId) entries.push(e);
      else others.push(e);
    });
    if (entries.length) current.push({ kind: sec.kind, title: sec.title, items: entries.map((e) => e.item), entries });
  });
  return { current, others };
}
