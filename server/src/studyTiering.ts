import { db } from "./db.js";
import { loadAgents } from "./agentLoader.js";
import { listOverrides, lastResearchedAt } from "./studyStore.js";

export const HOT_THRESHOLD = 3;
const HOT_WINDOW_MS = 30 * 86400_000;
const COLD_WINDOW_MS = 90 * 86400_000;

export interface AgentUsage {
  agentId: string;
  name: string;
  sessions30d: number;
  sessions90d: number;
  lastResearchedAt: number | null;
  override: string | null;
}

export interface Tiers {
  hot: AgentUsage[];
  cold: AgentUsage[];
  dormant: AgentUsage[];
  excluded: AgentUsage[];
}

function sessionCounts(): Map<string, { d30: number; d90: number }> {
  const now = Date.now();
  const rows = db
    .prepare("SELECT agent_id, updated_at FROM sessions WHERE updated_at >= ?")
    .all(now - COLD_WINDOW_MS) as any[];
  const m = new Map<string, { d30: number; d90: number }>();
  for (const r of rows) {
    const e = m.get(r.agent_id) || { d30: 0, d90: 0 };
    e.d90++;
    if (r.updated_at >= now - HOT_WINDOW_MS) e.d30++;
    m.set(r.agent_id, e);
  }
  return m;
}

export function computeTiers(): Tiers {
  const counts = sessionCounts();
  const overrides = listOverrides();
  const tiers: Tiers = { hot: [], cold: [], dormant: [], excluded: [] };
  for (const a of loadAgents()) {
    const c = counts.get(a.id) || { d30: 0, d90: 0 };
    const ov = overrides[a.id] ?? null;
    const usage: AgentUsage = {
      agentId: a.id,
      name: a.name,
      sessions30d: c.d30,
      sessions90d: c.d90,
      lastResearchedAt: lastResearchedAt(a.id),
      override: ov,
    };
    if (ov === "exclude") {
      tiers.excluded.push(usage);
      continue;
    }
    if (ov === "hot") {
      tiers.hot.push(usage);
      continue;
    }
    if (ov === "cold") {
      tiers.cold.push(usage);
      continue;
    }
    if (c.d30 >= HOT_THRESHOLD) tiers.hot.push(usage);
    else if (c.d90 >= 1) tiers.cold.push(usage);
    else tiers.dormant.push(usage);
  }
  return tiers;
}

export function pickForRun(tier: "hot" | "cold", cap: number): string[] {
  const t = computeTiers();
  const list = tier === "hot" ? t.hot : t.cold;
  return [...list]
    .sort((a, b) => (a.lastResearchedAt ?? 0) - (b.lastResearchedAt ?? 0))
    .slice(0, cap)
    .map((a) => a.agentId);
}
