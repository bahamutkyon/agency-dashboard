import { useEffect, useState, useCallback } from "react";
import { getSocket } from "../lib/socket";
import { api, AgentMeta, CategoryMeta } from "../lib/api";

interface RunProgress {
  runId: string;
  status: string;
  total: number;
  done: number;
  current: string | null;
  failed: { target: string; error: string }[];
  createdProposals: number;
}

interface LearningSchedule {
  id: string;
  name: string;
  targets: { type: "category" | "agent"; id: string }[];
  cron: string;
  enabled: boolean;
  lastRunAt?: number;
  createdAt: number;
}

const CRON_PRESETS = [
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "每週一 09:00", value: "0 9 * * 1" },
  { label: "每月 1 號 09:00", value: "0 9 1 * *" },
];

export function CapabilityLearningPanel() {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Schedule state
  const [schedules, setSchedules] = useState<LearningSchedule[]>([]);
  const [selectedCron, setSelectedCron] = useState(CRON_PRESETS[0].value);
  const [scheduleName, setScheduleName] = useState("");
  const [schedBusy, setSchedBusy] = useState(false);

  const fetchSchedules = useCallback(() => {
    fetch("/api/learning/schedules")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setSchedules(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.agents()
      .then((d) => {
        setAgents(d.agents || []);
        setCategories(d.categories || []);
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
    fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    const sock = getSocket();
    const onProgress = (p: RunProgress) => {
      setProgress(p);
      if (p.status === "done" || p.status === "error") setBusy(false);
    };
    sock.on("learning:progress", onProgress);
    return () => { sock.off("learning:progress", onProgress); };
  }, []);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleExpand(catId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  }

  async function createSchedule() {
    const targets = [...picked].map((k) => {
      const [type, ...rest] = k.split(":");
      return { type, id: rest.join(":") };
    });
    if (targets.length === 0) { alert("請先勾選目標"); return; }
    setSchedBusy(true);
    try {
      const r = await fetch("/api/learning/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scheduleName.trim() || "能力學習排程",
          targets,
          cron: selectedCron,
        }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error || "建立失敗"); }
      else fetchSchedules();
    } catch { alert("建立失敗"); }
    finally { setSchedBusy(false); }
  }

  async function toggleSchedule(s: LearningSchedule) {
    await fetch(`/api/learning/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    fetchSchedules();
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/learning/schedules/${id}`, { method: "DELETE" });
    fetchSchedules();
  }

  async function start() {
    const targets = [...picked].map((k) => {
      const [type, ...rest] = k.split(":");
      return { type, id: rest.join(":") };
    });
    if (targets.length === 0) return;
    setBusy(true);
    setProgress(null);
    try {
      const r = await fetch("/api/learning/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
    } catch {
      setBusy(false);
      alert("啟動失敗");
    }
  }

  const pickedCount = picked.size;

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold">🎓 能力學習進程</h2>
          <p className="text-xs text-zinc-500 mt-1">
            選擇類別或個別 agent，讓 Claude 從對話紀錄中萃取能力學習提案，再到「學習佇列」批准。
          </p>
        </div>

        {/* Guidance */}
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 mb-4 text-xs text-zinc-400 space-y-1">
          <div className="font-medium text-zinc-300 mb-1">📋 建議流程</div>
          <div>① 勾選類別（或個別 agent）→ ② 點「開始學習」→ ③ 到「學習佇列」批准提案</div>
          <div className="mt-2 text-amber-400/80">
            ⚠️ 能力學習使用 Claude Opus 4.7，每次執行會消耗訂閱額度。agent 數量多時耗時較長，請耐心等待。
          </div>
        </div>

        {/* Category + Agent Checklist */}
        <div className="bg-panel border border-zinc-800 rounded-lg mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-medium">選擇目標</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const allKeys = [
                    ...categories.map((c) => `category:${c.id}`),
                    ...agents.map((a) => `agent:${a.id}`),
                  ];
                  setPicked(new Set(allKeys));
                }}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                全選
              </button>
              <button
                onClick={() => setPicked(new Set())}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                清除
              </button>
            </div>
          </div>

          {!loaded && (
            <div className="p-6 text-center text-zinc-500 text-sm">
              載入中…
            </div>
          )}
          {loaded && categories.length === 0 && (
            <div className="p-6 text-center text-zinc-500 text-sm">
              沒有可用的類別
            </div>
          )}

          <div className="divide-y divide-zinc-800">
            {categories.map((cat) => {
              const catKey = `category:${cat.id}`;
              const catAgents = agents.filter((a) => a.category === cat.id);
              const isExpanded = expanded.has(cat.id);
              const isCatPicked = picked.has(catKey);

              return (
                <div key={cat.id}>
                  {/* Category row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50">
                    <input
                      type="checkbox"
                      checked={isCatPicked}
                      onChange={() => toggle(catKey)}
                      className="rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900"
                      id={`cat-${cat.id}`}
                    />
                    <label
                      htmlFor={`cat-${cat.id}`}
                      className="flex-1 text-sm cursor-pointer select-none"
                    >
                      <span className="font-medium">{cat.label}</span>
                      <span className="text-zinc-500 text-xs ml-2">({cat.count} 個 agent)</span>
                    </label>
                    {catAgents.length > 0 && (
                      <button
                        onClick={() => toggleExpand(cat.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                        title={isExpanded ? "收合" : "展開個別 agent"}
                      >
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </div>

                  {/* Agent rows (expanded) */}
                  {isExpanded && catAgents.map((agent) => {
                    const agentKey = `agent:${agent.id}`;
                    const isAgentPicked = picked.has(agentKey);
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center gap-3 px-4 py-2 pl-10 bg-zinc-900/30 hover:bg-zinc-900/60"
                      >
                        <input
                          type="checkbox"
                          checked={isAgentPicked}
                          onChange={() => toggle(agentKey)}
                          className="rounded border-zinc-600 text-accent focus:ring-accent focus:ring-offset-zinc-900"
                          id={`agent-${agent.id}`}
                        />
                        <label
                          htmlFor={`agent-${agent.id}`}
                          className="flex-1 text-xs text-zinc-300 cursor-pointer select-none"
                        >
                          {agent.name}
                        </label>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Start Button */}
        <div className="mb-6">
          <button
            disabled={busy || pickedCount === 0}
            onClick={start}
            className="px-5 py-2.5 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
          >
            {busy
              ? "⏳ 執行中…"
              : pickedCount > 0
              ? `🚀 開始學習（已選 ${pickedCount} 個）`
              : "請先勾選目標"}
          </button>
        </div>

        {/* Progress area */}
        {progress && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-medium">執行進度</span>
              <span>
                {progress.done} / {progress.total}
                {progress.status === "done" && " ✅ 完成"}
                {progress.status === "error" && " ❌ 錯誤"}
                {progress.status === "running" && " ⏳ 執行中"}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  progress.status === "done"
                    ? "bg-emerald-500"
                    : progress.status === "error"
                    ? "bg-rose-500"
                    : "bg-violet-500"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {/* Current target */}
            {progress.current && progress.status === "running" && (
              <div className="text-xs text-zinc-400">
                正在處理：<span className="text-zinc-200">{progress.current}</span>
              </div>
            )}

            {/* Done summary */}
            {progress.status === "done" && (
              <div className="text-sm text-emerald-400 font-medium">
                已產生 {progress.createdProposals} 條提案，請到「學習佇列」批准
              </div>
            )}

            {/* Failed list */}
            {progress.failed && progress.failed.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-rose-400 font-medium">失敗項目：</div>
                {progress.failed.map((f) => (
                  <div key={f.target} className="text-xs text-zinc-500 pl-2">
                    <span className="text-rose-400">{f.target}</span>
                    {f.error && <span className="ml-2">— {f.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---- 定期自動學習排程 ---- */}
        <div className="mt-8">
          <h3 className="text-base font-semibold mb-1">定期自動學習排程</h3>
          <p className="text-xs text-zinc-500 mb-3">
            自動排程同樣會消耗 Claude 訂閱額度（Opus 4.7），請斟酌設定頻率。
          </p>

          {/* Create schedule form */}
          <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
            <div className="text-xs font-medium text-zinc-300 mb-1">建立新排程</div>

            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="排程名稱（選填）"
                value={scheduleName}
                onChange={(e) => setScheduleName(e.target.value)}
                className="flex-1 min-w-[160px] px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
              />
              <select
                value={selectedCron}
                onChange={(e) => setSelectedCron(e.target.value)}
                className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-violet-500"
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="text-xs text-zinc-500">
              使用上方已勾選的 {pickedCount} 個目標建立排程
            </div>

            <button
              onClick={createSchedule}
              disabled={schedBusy || pickedCount === 0}
              className="px-4 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium"
            >
              {schedBusy ? "建立中…" : pickedCount > 0 ? `建立排程（${pickedCount} 個目標）` : "請先勾選目標"}
            </button>
          </div>

          {/* Schedule list */}
          {schedules.length === 0 ? (
            <div className="text-xs text-zinc-600 px-1">尚無排程</div>
          ) : (
            <div className="bg-panel border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
              {schedules.map((s) => {
                const preset = CRON_PRESETS.find((p) => p.value === s.cron);
                return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/40">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">{s.name}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        <span className="text-zinc-400">{preset ? preset.label : s.cron}</span>
                        <span className="mx-1.5 text-zinc-700">·</span>
                        <span>{s.targets.length} 個目標</span>
                        {s.lastRunAt && (
                          <>
                            <span className="mx-1.5 text-zinc-700">·</span>
                            <span>上次執行 {new Date(s.lastRunAt).toLocaleString("zh-TW", { hour12: false })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${s.enabled ? "bg-emerald-900/50 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                        {s.enabled ? "啟用" : "停用"}
                      </span>
                      <button
                        onClick={() => toggleSchedule(s)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
                      >
                        {s.enabled ? "停用" : "啟用"}
                      </button>
                      <button
                        onClick={() => deleteSchedule(s.id)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-900/50 hover:text-rose-400 rounded text-zinc-500"
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
