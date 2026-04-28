import { useEffect, useMemo, useState } from "react";
import { api, type AgentMeta, type Schedule } from "../lib/api";
import { getSocket } from "../lib/socket";

const PRESETS: { label: string; cron: string }[] = [
  { label: "每天 09:00", cron: "0 9 * * *" },
  { label: "每天 18:00", cron: "0 18 * * *" },
  { label: "每週一 09:00", cron: "0 9 * * 1" },
  { label: "每週五 17:00", cron: "0 17 * * 5" },
  { label: "每月 1 號 09:00", cron: "0 9 1 * *" },
  { label: "每小時整點", cron: "0 * * * *" },
  { label: "每 30 分鐘", cron: "*/30 * * * *" },
];

function fmtTime(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("zh-TW", { hour12: false });
}

interface Props {
  agents: AgentMeta[];
}

export function SchedulePanel({ agents }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cronExpr, setCronExpr] = useState(PRESETS[0].cron);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.schedules().then(setSchedules).catch(() => {});

  useEffect(() => {
    reload();
    const sock = getSocket();
    const handler = () => reload();
    sock.on("schedule:fired", handler);
    return () => { sock.off("schedule:fired", handler); };
  }, []);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const submit = async () => {
    setError(null);
    if (!agentId) return setError("請選擇 agent");
    if (!prompt.trim()) return setError("請填指示內容");
    if (!cronExpr.trim()) return setError("請填 cron 表達式");
    try {
      await api.createSchedule({
        name: name.trim() || `${agentMap.get(agentId)?.name || agentId} 例行任務`,
        agentId,
        prompt: prompt.trim(),
        cron: cronExpr.trim(),
        enabled: true,
      });
      setCreating(false);
      setName(""); setPrompt(""); setAgentId("");
      reload();
    } catch (e: any) {
      setError(e.message || "建立失敗");
    }
  };

  const toggle = async (s: Schedule) => {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
    reload();
  };

  const remove = async (s: Schedule) => {
    if (!confirm(`確定刪除「${s.name}」?`)) return;
    await api.deleteSchedule(s.id);
    reload();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">⏰ 排程管理</h2>
            <p className="text-xs text-zinc-500 mt-1">
              交代任務後讓員工到時間自動跑。注意:每次排程觸發都會消耗你的 Claude 訂閱額度。
            </p>
          </div>
          <button
            onClick={() => setCreating(!creating)}
            className="px-3 py-2 rounded bg-accent hover:bg-violet-500 text-sm text-white"
          >
            {creating ? "取消" : "+ 新增排程"}
          </button>
        </div>

        {creating && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
            <div>
              <label className="text-xs text-zinc-400">名稱(自動命名可留空)</label>
              <input
                className="w-full mt-1 bg-zinc-900 px-3 py-2 rounded text-sm"
                placeholder="例如:每週一晨會選題"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">指派 agent</label>
              <select
                className="w-full mt-1 bg-zinc-900 px-3 py-2 rounded text-sm"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">— 選擇 —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    [{a.category}] {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-zinc-400">交代什麼任務</label>
              <textarea
                className="w-full mt-1 bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                rows={4}
                placeholder="例如:整理本週小紅書熱門選題,給我 5 個適合 AI 工具教學切入的角度"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">什麼時候跑</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    onClick={() => setCronExpr(p.cron)}
                    className={`text-xs px-2 py-1 rounded ${
                      cronExpr === p.cron ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                className="w-full mt-2 bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                placeholder="cron 表達式"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
              />
              <div className="text-xs text-zinc-500 mt-1">
                格式:分 時 日 月 週(0=週日)。範例:<code className="bg-zinc-900 px-1">0 9 * * 1-5</code> = 平日早上 9 點
              </div>
            </div>

            {error && <div className="text-rose-400 text-xs">{error}</div>}

            <button
              onClick={submit}
              className="w-full py-2 rounded bg-accent hover:bg-violet-500 text-sm text-white"
            >
              建立排程
            </button>
          </div>
        )}

        {schedules.length === 0 && !creating && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">📅</div>
            <div className="text-sm">還沒有排程任務。點右上「+ 新增排程」開始。</div>
          </div>
        )}

        <div className="space-y-2">
          {schedules.map((s) => {
            const agent = agentMap.get(s.agentId);
            return (
              <div
                key={s.id}
                className={`bg-panel border rounded-lg p-4 ${
                  s.enabled ? "border-zinc-800" : "border-zinc-800/50 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">
                        {agent ? agent.name : s.agentId}
                      </span>
                      {!s.enabled && (
                        <span className="text-xs px-2 py-0.5 bg-zinc-900 rounded text-zinc-500">已停用</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{s.prompt}</div>
                    <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                      <span>cron: <code className="bg-zinc-900 px-1">{s.cron}</code></span>
                      <span>下次:{fmtTime(s.nextRunAt)}</span>
                      <span>上次:{fmtTime(s.lastRunAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => toggle(s)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded"
                    >
                      {s.enabled ? "暫停" : "啟用"}
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white"
                    >
                      刪除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
