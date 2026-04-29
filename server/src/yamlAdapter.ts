/**
 * YAML import/export for workflows. Two-way mapping between our internal
 * JSON format and a YAML format that's compatible with jnMetaCode/
 * Agency-orchestrator (where reasonable).
 *
 * On export: we use OUR field names, but include jnMetaCode aliases as
 * comments where helpful so people reading both ecosystems aren't confused.
 *
 * On import: we accept BOTH our format AND jnMetaCode's, mapping known
 * fields. Unknown fields are ignored.
 */
import YAML from "yaml";
import type { Workflow, WorkflowStep } from "./store.js";

// Fields we recognize from jnMetaCode YAML and how they map to ours
const FIELD_MAP_IN: Record<string, string> = {
  // jnMetaCode → ours
  "depends_on": "dependsOn",
  "depends_on_mode": "dependsOnMode",
  "concurrency": "maxConcurrency",
  "condition": "skipIfMatch",        // best-effort; their "condition" is full Jinja2, ours is regex
  "pause_before": "pauseBefore",
  "skip_if_match": "skipIfMatch",
  "max_concurrency": "maxConcurrency",
  "agent_id": "agentId",
  "depends_on_node": "dependsOn",
};

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function normalizeKeys(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const mapped = FIELD_MAP_IN[k] ?? k;
    out[mapped] = normalizeKeys(v);
  }
  return out;
}

// `any_completed` from jnMetaCode → "any" in ours; same for `all_completed` → "all"
function normalizeDepMode(mode: any): "all" | "any" | undefined {
  if (!mode) return undefined;
  const m = String(mode).toLowerCase();
  if (m === "any" || m === "any_completed") return "any";
  if (m === "all" || m === "all_completed") return "all";
  return undefined;
}

export function importWorkflowYaml(text: string): {
  name: string;
  description: string;
  steps: WorkflowStep[];
  maxConcurrency?: number;
} {
  const parsed = YAML.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("YAML 解析失敗:不是一個物件");
  }
  const norm = normalizeKeys(parsed);

  const name = String(norm.name || norm.workflow_name || norm.title || "Imported workflow");
  const description = String(norm.description || norm.desc || "");
  const maxConcurrency = typeof norm.maxConcurrency === "number" ? norm.maxConcurrency : undefined;

  const rawSteps = Array.isArray(norm.steps) ? norm.steps : [];
  const steps: WorkflowStep[] = rawSteps.map((s: any, i: number) => ({
    id: s.id || `step_${i + 1}`,
    agentId: String(s.agentId || s.agent_id || s.role || ""),
    prompt: String(s.prompt || s.task || ""),
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : undefined,
    dependsOnMode: normalizeDepMode(s.dependsOnMode),
    pauseBefore: !!s.pauseBefore || s.type === "approval",
    skipIfMatch: typeof s.skipIfMatch === "string" ? s.skipIfMatch : undefined,
    retries: typeof s.retries === "number" ? s.retries : undefined,
    provider: s.provider === "claude" || s.provider === "codex" || s.provider === "gemini" || s.provider === "auto"
      ? s.provider : undefined,
  }));

  return { name, description, steps, maxConcurrency };
}

export function exportWorkflowYaml(wf: Workflow): string {
  const data: any = {
    name: wf.name,
    description: wf.description || "",
  };
  if (wf.maxConcurrency) data.maxConcurrency = wf.maxConcurrency;
  data.steps = wf.steps.map((s, i) => {
    const out: any = {
      id: s.id || `step_${i + 1}`,
      agentId: s.agentId,
      prompt: s.prompt,
    };
    if (s.dependsOn && s.dependsOn.length > 0) out.dependsOn = s.dependsOn;
    if (s.dependsOnMode && s.dependsOnMode !== "all") out.dependsOnMode = s.dependsOnMode;
    if (s.pauseBefore) out.pauseBefore = true;
    if (s.skipIfMatch) out.skipIfMatch = s.skipIfMatch;
    if (s.retries !== undefined) out.retries = s.retries;
    if (s.provider) out.provider = s.provider;
    return out;
  });

  const header = "# Agency Dashboard workflow\n# Compatible with jnMetaCode/Agency-orchestrator (best-effort field mapping)\n";
  return header + YAML.stringify(data, { lineWidth: 100, doubleQuotedAsJSON: false });
}
