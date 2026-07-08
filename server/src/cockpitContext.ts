import { listWorkspaces, listSessions, DEFAULT_WORKSPACE_ID } from "./store.js";
import { listPendingProposals } from "./learningStore.js";
import { listGoals } from "./store/goals.js";
import type { CockpitContextPack } from "./cockpitTypes.js";

const MEMO_EXCERPT = 800;

function latestReportFor(workspaceId: string): string | undefined {
  const sessions = listSessions(workspaceId).filter((s) => (s.title || "").includes("排程"));
  if (!sessions.length) return undefined;
  return sessions[0].title;  // listSessions 依 updated_at DESC
}

export function buildCockpitContext(): CockpitContextPack {
  const workspaces = listWorkspaces()
    .filter((w) => !w.id.startsWith("__"))
    .map((w) => {
      const goals = listGoals(w.id, "active").map((g) => ({
        id: g.id,
        title: g.title,
        metric: g.metric,
        currentValue: g.currentValue,
        targetValue: g.targetValue,
        deadline: g.deadline,
      }));
      return {
        id: w.id,
        name: w.name,
        memoryExcerpt: (w.memory || "").slice(0, MEMO_EXCERPT),
        latestReport: latestReportFor(w.id),
        goals,
      };
    })
    .filter((w) => w.memoryExcerpt.trim() || w.latestReport || w.goals.length > 0);

  const pendingProposals = listPendingProposals(DEFAULT_WORKSPACE_ID)
    .map((p) => ({ id: p.id, agentId: p.agentId, kind: p.kind, content: p.content }));

  return { generatedAtIso: new Date().toISOString(), workspaces, pendingProposals, staleTopics: [] };
}
