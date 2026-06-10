import { useEffect, useState } from "react";
import { api, type AgentUsage, type StudySchedule } from "../lib/api";

export function AutonomousStudyPanel() {
  const [tiers, setTiers] = useState<{ hot: AgentUsage[]; cold: AgentUsage[]; dormant: AgentUsage[] } | null>(null);
  const [schedules, setSchedules] = useState<StudySchedule[]>([]);

  const load = () => {
    api.studyTiers().then(setTiers).catch(() => {});
    api.studySchedules().then(setSchedules).catch(() => {});
  };
  useEffect(load, []);

  const setOverride = async (agentId: string, override: "hot" | "cold" | "exclude" | null) => {
    await api.studyOverride(agentId, override);
    load();
  };
  const runNow = async (agentId: string) => {
    await api.studyRun(agentId);
    alert("已開始進修，完成後到「能力學習」面板審核提案");
  };
  const toggleSchedule = async (tier: string, enabled: boolean) => {
    await api.studyPatchSchedule(tier, { enabled });
    api.studySchedules().then(setSchedules).catch(() => {});
  };

  if (!tiers) return <div className="p-4 text-zinc-500">載入中…</div>;

  const Row = ({ a }: { a: AgentUsage }) => (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-zinc-800/50">
      <span>
        {a.name}{" "}
        <span className="text-zinc-500 text-xs">
          近30天 {a.sessions30d} 次
          {a.lastResearchedAt ? ` · 上次進修 ${new Date(a.lastResearchedAt).toLocaleDateString()}` : " · 未進修"}
        </span>
      </span>
      <span className="flex gap-1">
        <button onClick={() => runNow(a.agentId)} className="text-xs px-2 py-0.5 bg-violet-600 hover:bg-violet-500 rounded text-white">立即進修</button>
        <button onClick={() => setOverride(a.agentId, "hot")} className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded">釘熱</button>
        <button onClick={() => setOverride(a.agentId, "exclude")} className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded">排除</button>
        {a.override && (
          <button onClick={() => setOverride(a.agentId, null)} className="text-xs px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400">清除</button>
        )}
      </span>
    </div>
  );

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="text-xs text-zinc-400">
        自主進修：常用 agent 定期上網研究領域最新做法，產出提案到「能力學習」面板審核。
      </div>
      <div className="space-y-1">
        {schedules.map((s) => (
          <label key={s.tier} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.enabled} onChange={(e) => toggleSchedule(s.tier, e.target.checked)} />
            {s.tier === "hot" ? "🔥 熱層每週自主進修" : "🌡️ 冷層每月自主進修"}（每次上限 {s.perRunCap} 支）
          </label>
        ))}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">🔥 熱層（{tiers.hot.length}）</div>
        {tiers.hot.map((a) => <Row key={a.agentId} a={a} />)}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">🌡️ 冷層（{tiers.cold.length}）</div>
        {tiers.cold.map((a) => <Row key={a.agentId} a={a} />)}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">💤 休眠（{tiers.dormant.length}，不自動跑）</div>
        {tiers.dormant.slice(0, 30).map((a) => <Row key={a.agentId} a={a} />)}
      </div>
    </div>
  );
}
