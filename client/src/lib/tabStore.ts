/** 開著的對話分頁依工作區存進 localStorage：重新整理、切走再切回來都還在（舊版切工作區＝關掉所有分頁）。 */
export interface StoredTab {
  sessionId: string;
  agentId: string;
  agentName: string;
  topic?: string;
  status: string;
  provider?: "claude" | "codex" | "gemini";
  onboardingTargetWorkspaceId?: string;
}

const key = (ws: string) => `agency:tabs:${ws}`;

export function saveTabs(ws: string, tabs: StoredTab[]): void {
  try { localStorage.setItem(key(ws), JSON.stringify(tabs)); } catch { /* 私密視窗等：略過 */ }
}

/** existingIds：目前工作區仍存在的 session id；查不到的分頁丟掉。 */
export function loadTabs(ws: string, existingIds: Set<string>): StoredTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(ws)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t) => t && typeof t.sessionId === "string" && existingIds.has(t.sessionId))
      .map((t) => ({ ...t, status: "idle" }));
  } catch {
    return [];
  }
}
