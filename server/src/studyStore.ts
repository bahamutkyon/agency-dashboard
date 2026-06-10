import { db } from "./db.js";

export type TierOverride = "hot" | "cold" | "exclude";

export function setTierOverride(agentId: string, override: TierOverride | null): void {
  if (override === null) {
    db.prepare("DELETE FROM agent_study_prefs WHERE agent_id = ?").run(agentId);
    return;
  }
  db.prepare(`
    INSERT INTO agent_study_prefs (agent_id, tier_override, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET tier_override = excluded.tier_override, updated_at = excluded.updated_at
  `).run(agentId, override, Date.now());
}

export function getTierOverride(agentId: string): TierOverride | null {
  const r = db.prepare("SELECT tier_override FROM agent_study_prefs WHERE agent_id = ?").get(agentId) as any;
  return r?.tier_override ?? null;
}

export function listOverrides(): Record<string, TierOverride> {
  const rows = db.prepare("SELECT agent_id, tier_override FROM agent_study_prefs").all() as any[];
  const out: Record<string, TierOverride> = {};
  for (const r of rows) out[r.agent_id] = r.tier_override;
  return out;
}

export interface CapabilityReport { id: string; agentId: string; report: string; sources: string[]; runId: string | null; createdAt: number; }

export function saveCapabilityReport(input: { agentId: string; report: string; sources: string[]; runId?: string | null }): string {
  const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO agent_capability_reports (id, agent_id, report, sources, run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.agentId, input.report, JSON.stringify(input.sources || []), input.runId ?? null, Date.now());
  return id;
}

export function getLatestReport(agentId: string): CapabilityReport | null {
  const r = db.prepare("SELECT * FROM agent_capability_reports WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1").get(agentId) as any;
  if (!r) return null;
  return { id: r.id, agentId: r.agent_id, report: r.report, sources: JSON.parse(r.sources || "[]"), runId: r.run_id ?? null, createdAt: r.created_at };
}

export function lastResearchedAt(agentId: string): number | null {
  const r = db.prepare("SELECT MAX(created_at) AS t FROM agent_capability_reports WHERE agent_id = ?").get(agentId) as any;
  return r?.t ?? null;
}

export interface StudySchedule { tier: "hot" | "cold"; cron: string; enabled: boolean; perRunCap: number; lastRunAt: number | null; }

export function listStudySchedules(): StudySchedule[] {
  const rows = db.prepare("SELECT * FROM agent_study_schedules ORDER BY tier").all() as any[];
  return rows.map((r) => ({ tier: r.tier, cron: r.cron, enabled: !!r.enabled, perRunCap: r.per_run_cap, lastRunAt: r.last_run_at ?? null }));
}

export function updateStudySchedule(tier: "hot" | "cold", patch: { enabled?: boolean; cron?: string; perRunCap?: number }): void {
  const cur = db.prepare("SELECT * FROM agent_study_schedules WHERE tier = ?").get(tier) as any;
  if (!cur) return;
  db.prepare("UPDATE agent_study_schedules SET cron = ?, enabled = ?, per_run_cap = ? WHERE tier = ?").run(
    patch.cron ?? cur.cron,
    (patch.enabled ?? !!cur.enabled) ? 1 : 0,
    patch.perRunCap ?? cur.per_run_cap,
    tier,
  );
}

export function touchStudyScheduleRun(tier: "hot" | "cold"): void {
  db.prepare("UPDATE agent_study_schedules SET last_run_at = ? WHERE tier = ?").run(Date.now(), tier);
}
