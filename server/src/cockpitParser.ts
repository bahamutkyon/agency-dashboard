import type { Briefing, BriefingSection } from "./cockpitTypes.js";

const VALID_KINDS = new Set(["decisions", "new_items", "status", "learning"]);

export function parseBriefing(
  raw: string,
  date: string,
  generatedAt: number,
): { status: "ok" | "parse_failed"; briefing: Briefing | null } {
  const m = raw.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = m ? m[1] : null;
  if (!jsonText) return { status: "parse_failed", briefing: null };
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText.trim());
  } catch {
    return { status: "parse_failed", briefing: null };
  }
  if (!obj || !Array.isArray((obj as Record<string, unknown>).sections)) {
    return { status: "parse_failed", briefing: null };
  }
  const raw_sections = (obj as Record<string, unknown>).sections as unknown[];
  const sections: BriefingSection[] = raw_sections
    .filter((s: unknown) => {
      const sec = s as Record<string, unknown>;
      return sec && VALID_KINDS.has(sec.kind as string) && Array.isArray(sec.items);
    })
    .map((s: unknown) => {
      const sec = s as Record<string, unknown>;
      const items = sec.items as unknown[];
      return {
        kind: sec.kind as BriefingSection["kind"],
        title: String(sec.title || ""),
        items: items.map((it: unknown) => {
          const item = it as Record<string, unknown>;
          const action =
            item.action &&
            ((item.action as Record<string, unknown>).type === "approve" ||
              (item.action as Record<string, unknown>).type === "reject") &&
            Array.isArray((item.action as Record<string, unknown>).proposalIds)
              ? {
                  type: (item.action as Record<string, unknown>).type as "approve" | "reject",
                  proposalIds: ((item.action as Record<string, unknown>).proposalIds as unknown[]).map(String),
                }
              : undefined;
          return {
            title: String(item.title || ""),
            body: String(item.body || ""),
            workspaceId: item.workspaceId ? String(item.workspaceId) : undefined,
            discussSeed: item.discussSeed ? String(item.discussSeed) : undefined,
            action,
          };
        }),
      };
    });
  return { status: "ok", briefing: { date, generatedAt, sections } };
}
