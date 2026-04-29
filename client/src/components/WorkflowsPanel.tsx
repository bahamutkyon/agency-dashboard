import { useEffect, useState } from "react";
import { api, type AgentMeta, type Workflow, type WorkflowRun, type WorkflowStep } from "../lib/api";
import { getSocket } from "../lib/socket";
import { WORKFLOW_TEMPLATES } from "../lib/workflowTemplates";
import { WorkflowPlan } from "./WorkflowPlan";

interface Props {
  agents: AgentMeta[];
  onOpenSession?: (sessionId: string, agentId: string, title: string) => void;
  onLaunchDraftAssistant?: (sessionId: string) => void;
}

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-TW", { hour12: false });
}

export function WorkflowsPanel({ agents, onOpenSession, onLaunchDraftAssistant }: Props) {
  const [list, setList] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | "new" | null>(null);
  const [draft, setDraft] = useState<{ name: string; description: string; steps: WorkflowStep[]; maxConcurrency?: number }>(
    { name: "", description: "", steps: [{ agentId: "", prompt: "" }], maxConcurrency: 2 }
  );
  const [runs, setRuns] = useState<Record<string, WorkflowRun[]>>({});
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);

  const reload = () => api.workflows().then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);

  // socket: live update on running workflows
  useEffect(() => {
    const sock = getSocket();
    const h = (run: WorkflowRun) => {
      setActiveRun((cur) => (cur && cur.id === run.id) ? run : cur);
      // refresh runs list for that workflow
      api.workflowRuns(run.workflowId).then((r) => setRuns((prev) => ({ ...prev, [run.workflowId]: r })));
    };
    sock.on("workflow:update", h);
    return () => { sock.off("workflow:update", h); };
  }, []);

  const startNew = () => {
    setEditing("new");
    setDraft({ name: "", description: "", steps: [{ agentId: "", prompt: "" }], maxConcurrency: 2 });
  };

  const startEdit = (w: Workflow) => {
    setEditing(w);
    setDraft({
      name: w.name, description: w.description,
      steps: w.steps.length ? w.steps : [{ agentId: "", prompt: "" }],
      maxConcurrency: w.maxConcurrency ?? 2,
    });
  };

  const save = async () => {
    const cleanSteps = draft.steps.filter((s) => s.agentId && s.prompt.trim());
    if (!draft.name.trim() || cleanSteps.length === 0) {
      alert("名稱跟至少一個有效步驟必填");
      return;
    }
    const payload = { ...draft, steps: cleanSteps, maxConcurrency: draft.maxConcurrency || 2 };
    if (editing === "new") {
      await api.createWorkflow(payload);
    } else if (editing) {
      await api.updateWorkflow(editing.id, payload);
    }
    setEditing(null);
    reload();
  };

  const remove = async (w: Workflow) => {
    if (!confirm(`刪除 workflow「${w.name}」?所有歷史執行紀錄會一起消失`)) return;
    await api.deleteWorkflowApi(w.id);
    reload();
  };

  const runIt = async (w: Workflow) => {
    const initial = prompt(`為 workflow「${w.name}」提供起始輸入(可空,${"{{out}}"} 在第一步會被替換):`) ?? "";
    try {
      const run = await api.runWorkflow(w.id, initial);
      setActiveRun(run);
      api.workflowRuns(w.id).then((r) => setRuns((prev) => ({ ...prev, [w.id]: r })));
    } catch (e: any) {
      alert("執行失敗:" + e.message);
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    await api.cancelRun(activeRun.id);
  };

  const loadRuns = async (id: string) => {
    if (runs[id]) return;
    const r = await api.workflowRuns(id);
    setRuns((prev) => ({ ...prev, [id]: r }));
  };

  const addStep = () => setDraft({ ...draft, steps: [...draft.steps, { agentId: "", prompt: "" }] });
  const removeStep = (i: number) => setDraft({ ...draft, steps: draft.steps.filter((_, idx) => idx !== i) });
  const updateStep = (i: number, patch: Partial<WorkflowStep>) =>
    setDraft({ ...draft, steps: draft.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s) });

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">🔗 自動接力 Workflow</h2>
            <p className="text-xs text-zinc-500 mt-1">
              設定 N 個步驟,每步派一位 agent。前一步的輸出可用 <code className="bg-zinc-900 px-1 rounded">{"{{out}}"}</code> 注入下一步。
              觸發後自動跑完,你只需收結果。
            </p>
          </div>
          {!editing && (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const { id } = await api.startWorkflowDraft();
                  onLaunchDraftAssistant?.(id);
                }}
                className="px-3 py-2 rounded bg-gradient-to-r from-accent to-violet-500 hover:from-violet-500 hover:to-fuchsia-500 text-sm text-white"
                title="跟專案經理對話 5-10 分鐘,它幫你設計 workflow"
              >
                🤖 讓專案經理幫我設計
              </button>
              <button onClick={startNew} className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">
                + 新增
              </button>
            </div>
          )}
        </div>

        {editing && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
            <div className="font-medium text-sm">{editing === "new" ? "新增 workflow" : `編輯「${editing.name}」`}</div>

            {editing === "new" && (
              <select
                className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
                onChange={(e) => {
                  const t = WORKFLOW_TEMPLATES.find((x) => x.id === e.target.value);
                  if (t) {
                    setDraft({
                      name: t.label,
                      description: t.description,
                      steps: t.steps.length ? t.steps : [{ agentId: "", prompt: "" }],
                    });
                  }
                  e.target.value = "";
                }}
                defaultValue=""
              >
                <option value="">📋 從範本快速填入…</option>
                {WORKFLOW_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.emoji} {t.label} — {t.description}</option>
                ))}
              </select>
            )}

            <input
              className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
              placeholder="名稱(例如:每週選題到審稿)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
              placeholder="描述(可選)"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <div className="flex items-center gap-2 text-xs">
              <label className="text-zinc-400">並行上限:</label>
              <select
                className="bg-zinc-900 px-2 py-1 rounded"
                value={draft.maxConcurrency || 2}
                onChange={(e) => setDraft({ ...draft, maxConcurrency: Number(e.target.value) })}
              >
                <option value={1}>1(嚴格序列)</option>
                <option value={2}>2(預設)</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5(注意配額)</option>
              </select>
              <span className="text-zinc-600">同一時間最多幾個 step 並行,設大會更快但更耗 quota</span>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-zinc-400">步驟</div>
              {draft.steps.map((s, i) => {
                const stepId = s.id || `step_${i + 1}`;
                const otherIds = draft.steps
                  .map((x, idx) => x.id || `step_${idx + 1}`)
                  .filter((id, idx) => idx !== i);
                const deps = s.dependsOn !== undefined ? s.dependsOn : (i === 0 ? [] : [`step_${i}`]);
                return (
                <div key={i} className="bg-zinc-900 rounded p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="bg-zinc-950 px-2 py-1 rounded text-xs font-mono w-24 text-zinc-400"
                      placeholder={`step_${i + 1}`}
                      value={s.id || ""}
                      onChange={(e) => updateStep(i, { id: e.target.value.replace(/[^a-z0-9_-]/gi, "") })}
                      title="步驟 ID(用於依賴引用)"
                    />
                    <select
                      className="flex-1 bg-zinc-950 px-2 py-1 rounded text-sm"
                      value={s.agentId}
                      onChange={(e) => updateStep(i, { agentId: e.target.value })}
                    >
                      <option value="">— 選 agent —</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>[{a.category}] {a.name}</option>
                      ))}
                    </select>
                    {draft.steps.length > 1 && (
                      <button onClick={() => removeStep(i)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded">×</button>
                    )}
                  </div>

                  {otherIds.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-zinc-500">依賴:</span>
                        {otherIds.map((oid) => (
                          <label key={oid} className="text-[11px] flex items-center gap-1 cursor-pointer">
                            <input type="checkbox"
                              checked={deps.includes(oid)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...deps, oid]
                                  : deps.filter((d) => d !== oid);
                                updateStep(i, { dependsOn: next });
                              }}
                            />
                            <span className="font-mono text-zinc-400">{oid}</span>
                          </label>
                        ))}
                        {deps.length === 0 && (
                          <span className="text-[10px] text-emerald-400">⚡ 無依賴 → 平行起跑</span>
                        )}
                      </div>
                      {deps.length > 1 && (
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-zinc-500">觸發模式:</span>
                          <select
                            className="bg-zinc-950 px-1 py-0.5 rounded text-[11px]"
                            value={s.dependsOnMode || "all"}
                            onChange={(e) => updateStep(i, { dependsOnMode: e.target.value as any })}
                          >
                            <option value="all">all(等所有依賴完成)</option>
                            <option value="any">any(任一依賴完成就跑,賽跑)</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  <textarea
                    className="w-full bg-zinc-950 px-2 py-1.5 rounded text-xs font-mono"
                    rows={3}
                    placeholder={i === 0
                      ? "第一步指令(可用 {{out}} 引用 workflow 的起始輸入)"
                      : `用 {{out}} 引用「最後一個依賴」的輸出,或用 {{stepId.out}} 引用任意上游(例如 {{step_1.out}})`}
                    value={s.prompt}
                    onChange={(e) => updateStep(i, { prompt: e.target.value })}
                  />
                  <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                    {i > 0 && (
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox"
                          checked={!!s.pauseBefore}
                          onChange={(e) => updateStep(i, { pauseBefore: e.target.checked })}
                        />
                        ⏸️ 此步前暫停等批准
                      </label>
                    )}
                    {i > 0 && (
                      <input type="text"
                        className="flex-1 bg-zinc-950 px-2 py-1 rounded text-[11px] font-mono"
                        placeholder="跳過條件 regex(例:不需要|skip)"
                        value={s.skipIfMatch || ""}
                        onChange={(e) => updateStep(i, { skipIfMatch: e.target.value })}
                      />
                    )}
                  </div>
                </div>
                );
              })}
              <button onClick={addStep}
                className="w-full py-1.5 rounded border border-dashed border-zinc-700 hover:border-accent text-xs text-zinc-400 hover:text-accent">
                + 新增步驟
              </button>
            </div>

            {draft.steps.filter((s) => s.agentId).length > 0 && (
              <WorkflowPlan steps={draft.steps.filter((s) => s.agentId)} agents={agents} />
            )}
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm">
                {editing === "new" ? "建立" : "儲存"}
              </button>
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">
                取消
              </button>
            </div>
          </div>
        )}

        {activeRun && (
          <div className="bg-gradient-to-br from-emerald-950/40 to-teal-950/40 border border-emerald-500/40 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="font-medium">{
                  activeRun.status === "running" ? "🏃 執行中" :
                  activeRun.status === "paused" ? "⏸️ 暫停中,等待你的批准" :
                  activeRun.status === "done" ? "✅ 完成" :
                  activeRun.status === "error" ? "❌ 錯誤" : "🛑 取消"
                }</span>
                <span className="text-zinc-400 ml-2">Step {activeRun.currentStep + 1} / {activeRun.sessionIds.length || "?"}</span>
              </div>
              <div className="flex gap-2">
                {activeRun.status === "paused" && (() => {
                  const wf = list.find((w) => w.id === activeRun.workflowId);
                  const completedSteps = Object.keys(activeRun.stepOutputs || {});
                  return (
                    <>
                      <button
                        onClick={async () => { await api.approveRun(activeRun.id); }}
                        className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-medium"
                      >
                        ✓ 批准繼續
                      </button>
                      {completedSteps.length > 0 && (
                        <select
                          className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200"
                          defaultValue=""
                          onChange={async (e) => {
                            const sid = e.target.value;
                            if (!sid) return;
                            const iter = activeRun.iterations?.[sid] || 0;
                            if (!confirm(`回到 step「${sid}」重做?它跟所有下游 step 會重新執行。\n\n目前迭代次數:${iter} / 5`)) {
                              e.target.value = "";
                              return;
                            }
                            try { await api.loopBackRun(activeRun.id, sid); }
                            catch (err: any) { alert(err.message); }
                            e.target.value = "";
                          }}
                        >
                          <option value="">↺ 回到某步重做…</option>
                          {wf?.steps.filter((s) => completedSteps.includes(s.id || "")).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id} {activeRun.iterations?.[s.id!] ? `(已迭代 ${activeRun.iterations[s.id!]}/5)` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  );
                })()}
                {(activeRun.status === "running" || activeRun.status === "paused") && (
                  <button onClick={cancelRun} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded">中止</button>
                )}
                <button onClick={() => setActiveRun(null)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">關閉</button>
              </div>
            </div>
            {activeRun.error && <div className="mt-2 text-xs text-rose-400">{activeRun.error}</div>}
            {(() => {
              const wf = list.find((w) => w.id === activeRun.workflowId);
              if (!wf) return null;
              const currentStepId = wf.steps[activeRun.currentStep]?.id || `step_${activeRun.currentStep + 1}`;
              return (
                <div className="mt-3">
                  <WorkflowPlan
                    steps={wf.steps}
                    agents={agents}
                    highlightStep={activeRun.status === "running" || activeRun.status === "paused" ? currentStepId : null}
                  />
                </div>
              );
            })()}
            <div className="mt-2 flex flex-wrap gap-1">
              {activeRun.sessionIds.map((sid, i) => sid ? (
                <button key={sid + i}
                  onClick={() => onOpenSession?.(sid, "", `Workflow Step ${i + 1}`)}
                  className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
                  Step {i + 1} 對話 →
                </button>
              ) : null)}
            </div>
          </div>
        )}

        {list.length === 0 && !editing && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">🔗</div>
            <div className="text-sm">還沒有 workflow。建一個讓 agent 自動接力幹活</div>
          </div>
        )}

        <div className="space-y-2">
          {list.map((w) => (
            <div key={w.id} className="bg-panel border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{w.name}</div>
                  {w.description && <div className="text-xs text-zinc-500 mt-1">{w.description}</div>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {w.steps.map((s, i) => (
                      <div key={i} className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-300">
                        {i + 1}. {agentName(s.agentId)}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <button
                      onClick={() => loadRuns(w.id)}
                      className="text-[11px] text-zinc-500 hover:text-zinc-200"
                    >
                      {runs[w.id] ? `${runs[w.id].length} 次執行紀錄 ↓` : "載入執行紀錄"}
                    </button>
                    {runs[w.id] && runs[w.id].length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {runs[w.id].slice(0, 5).map((r) => (
                          <div key={r.id} className="text-xs text-zinc-500 flex items-center gap-2">
                            <span className={
                              r.status === "done" ? "text-emerald-400" :
                              r.status === "running" ? "text-amber-400" :
                              r.status === "paused" ? "text-sky-400" :
                              r.status === "error" ? "text-rose-400" : "text-zinc-500"
                            }>●</span>
                            <span>{fmtTime(r.startedAt)}</span>
                            <span className="text-zinc-600">·</span>
                            <span>{r.status}</span>
                            <div className="ml-auto flex gap-1">
                              {(r.status === "error" || r.status === "cancelled" || r.status === "done") && r.stepOutputs && Object.keys(r.stepOutputs).length > 0 && (
                                <button
                                  onClick={async () => {
                                    const stepId = prompt(`從哪一步重跑?(輸入 step id,可用的:${Object.keys(r.stepOutputs || {}).join(", ")})`);
                                    if (!stepId) return;
                                    try {
                                      const newRun = await api.runWorkflow(w.id, { resumeRunId: r.id, fromStepId: stepId });
                                      setActiveRun(newRun);
                                    } catch (e: any) { alert(e.message); }
                                  }}
                                  className="text-[10px] hover:text-zinc-200"
                                  title="從某步開始重跑(保留之前的結果)"
                                >↻ 重跑</button>
                              )}
                              {r.sessionIds.length > 0 && (
                                <button onClick={() => setActiveRun(r)}
                                  className="text-[10px] hover:text-zinc-200">查看 →</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => runIt(w)}
                    className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white">
                    🏃 執行
                  </button>
                  <button onClick={() => startEdit(w)}
                    className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">編輯</button>
                  <button onClick={() => remove(w)}
                    className="text-xs px-3 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white">刪除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
