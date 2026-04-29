import { useMemo } from "react";
import type { AgentMeta, WorkflowStep } from "../lib/api";

interface Props {
  steps: WorkflowStep[];
  agents: AgentMeta[];
  highlightStep?: string | null;  // step id currently executing
  errors?: { stepId: string; reason: string }[];
}

/**
 * Compute topological levels — steps with same level have no inter-deps and
 * can run in parallel.
 */
function computeLevels(steps: WorkflowStep[]): WorkflowStep[][] {
  const normalized = steps.map((s, i) => ({
    ...s,
    id: s.id || `step_${i + 1}`,
    dependsOn: s.dependsOn !== undefined ? s.dependsOn : (i === 0 ? [] : [steps[i - 1].id || `step_${i}`]),
  }));
  const levels: WorkflowStep[][] = [];
  const completed = new Set<string>();
  let remaining = [...normalized];
  let safety = 50;
  while (remaining.length > 0 && safety-- > 0) {
    const ready = remaining.filter((s) => (s.dependsOn || []).every((d) => completed.has(d)));
    if (ready.length === 0) break; // cycle
    levels.push(ready);
    ready.forEach((s) => completed.add(s.id!));
    remaining = remaining.filter((s) => !ready.includes(s));
  }
  return levels;
}

export function WorkflowPlan({ steps, agents, highlightStep, errors }: Props) {
  const levels = useMemo(() => computeLevels(steps), [steps]);
  const total = steps.length;
  const planned = levels.reduce((acc, lvl) => acc + lvl.length, 0);
  const orphans = total - planned; // steps caught in cycles
  const errMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of errors || []) m.set(e.stepId, e.reason);
    return m;
  }, [errors]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  if (steps.length === 0) {
    return <div className="text-xs text-zinc-500 italic">尚無步驟</div>;
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-3 space-y-2">
      <div className="text-xs text-zinc-400">
        🩺 執行計畫:{total} 個步驟 · {levels.length} 個層級(同層平行)
        {orphans > 0 && <span className="text-rose-400 ml-2">⚠️ {orphans} 個步驟在循環中,無法執行</span>}
      </div>
      <div className="space-y-1">
        {levels.map((lvl, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <div className="text-[10px] text-zinc-500 font-mono w-16 pt-1 flex-shrink-0">
              L{idx + 1}{lvl.length > 1 ? ` ⚡×${lvl.length}` : ""}
            </div>
            <div className="flex-1 flex flex-wrap gap-1.5">
              {lvl.map((s) => {
                const isError = errMap.has(s.id!);
                const isActive = highlightStep === s.id;
                return (
                  <div
                    key={s.id}
                    className={`px-2 py-1 rounded text-[11px] border ${
                      isError ? "border-rose-500 bg-rose-950/40" :
                      isActive ? "border-amber-400 bg-amber-950/40 animate-pulse" :
                      lvl.length > 1 ? "border-emerald-700/60 bg-emerald-950/20" :
                      "border-zinc-700 bg-zinc-900"
                    }`}
                    title={isError ? errMap.get(s.id!) : (s.dependsOn?.length ? `← ${s.dependsOn.join(", ")}` : "無依賴")}
                  >
                    <div className="font-mono text-zinc-400">{s.id}</div>
                    <div className="text-zinc-200 mt-0.5">{agentName(s.agentId)}</div>
                    {s.pauseBefore && <div className="text-[9px] text-amber-400">⏸️ 暫停</div>}
                    {s.skipIfMatch && <div className="text-[9px] text-zinc-500">↷ 條件跳過</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
