import { useEffect, useState } from "react";
import { api, type AgentUsage, type StudySchedule } from "../lib/api";
import { MarkdownView } from "./MarkdownView";

interface StudyReport {
  id: string;
  agentId: string;
  report: string;
  sources: string[];
  runId: string;
  createdAt: number;
}

function StudyRow({ a, onRun, onOverride, openReport, onToggleReport, reportData, loadingReport }: {
  a: AgentUsage;
  onRun: (id: string) => void;
  onOverride: (id: string, ov: "hot" | "cold" | "exclude" | null) => void;
  openReport: string | null;
  onToggleReport: (id: string) => void;
  reportData: StudyReport | null | undefined; // undefined = not yet loaded, null = no report
  loadingReport: boolean;
}) {
  const isOpen = openReport === a.agentId;

  return (
    <div className="border-b border-zinc-800/50">
      <div className="flex items-center justify-between px-3 py-1.5 text-sm">
        <span>
          {a.name}{" "}
          <span className="text-zinc-500 text-xs">
            近30天 {a.sessions30d} 次
            {a.lastResearchedAt ? ` · 上次進修 ${new Date(a.lastResearchedAt).toLocaleDateString()}` : " · 未進修"}
          </span>
        </span>
        <span className="flex gap-1">
          <button onClick={() => onRun(a.agentId)} className="text-xs px-2 py-0.5 bg-violet-600 hover:bg-violet-500 rounded text-white">立即進修</button>
          <button onClick={() => onOverride(a.agentId, "hot")} className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded">釘熱</button>
          <button onClick={() => onOverride(a.agentId, "exclude")} className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded">排除</button>
          {a.override && (
            <button onClick={() => onOverride(a.agentId, null)} className="text-xs px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400">清除</button>
          )}
          <button
            onClick={() => onToggleReport(a.agentId)}
            className={`text-xs px-2 py-0.5 rounded ${isOpen ? "bg-amber-700 hover:bg-amber-600 text-white" : "bg-zinc-700 hover:bg-zinc-600"}`}
          >
            📄 報告
          </button>
        </span>
      </div>
      {isOpen && (
        <div className="px-3 pb-3 pt-1 bg-zinc-900/50 text-sm space-y-2">
          {loadingReport ? (
            <div className="text-zinc-500 text-xs">載入中…</div>
          ) : reportData === null || reportData === undefined ? (
            <div className="text-zinc-500 text-xs">尚無進修報告</div>
          ) : (
            <>
              <MarkdownView className="text-zinc-300">{reportData.report}</MarkdownView>
              {reportData.sources && reportData.sources.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-zinc-500 text-xs font-semibold">參考來源</div>
                  <ul className="space-y-0.5">
                    {reportData.sources.map((url, i) => (
                      <li key={i}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2 break-all"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AutonomousStudyPanel() {
  const [tiers, setTiers] = useState<{ hot: AgentUsage[]; cold: AgentUsage[]; dormant: AgentUsage[]; excluded: AgentUsage[] } | null>(null);
  const [schedules, setSchedules] = useState<StudySchedule[]>([]);
  const [openReport, setOpenReport] = useState<string | null>(null);
  // undefined = not fetched yet, null = fetched but empty, StudyReport = has data
  const [reportCache, setReportCache] = useState<Record<string, StudyReport | null>>({});
  const [loadingReport, setLoadingReport] = useState<string | null>(null);

  const load = () => {
    api.studyTiers().then(setTiers).catch(() => {});
    api.studySchedules().then(setSchedules).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const setOverride = async (agentId: string, override: "hot" | "cold" | "exclude" | null) => {
    try { await api.studyOverride(agentId, override); load(); }
    catch (e: any) { alert("設定失敗：" + (e?.message || e)); }
  };
  const runNow = async (agentId: string) => {
    try { await api.studyRun(agentId); alert("已開始進修，完成後到「能力學習」面板審核提案"); }
    catch (e: any) { alert("啟動失敗：" + (e?.message || e)); }
  };
  const toggleSchedule = async (tier: string, enabled: boolean) => {
    try { await api.studyPatchSchedule(tier, { enabled }); api.studySchedules().then(setSchedules).catch(() => {}); }
    catch (e: any) { alert("更新失敗：" + (e?.message || e)); }
  };

  const toggleReport = async (agentId: string) => {
    if (openReport === agentId) {
      setOpenReport(null);
      return;
    }
    setOpenReport(agentId);
    // Already cached — no need to fetch again
    if (agentId in reportCache) return;
    setLoadingReport(agentId);
    try {
      const data = await api.studyReport(agentId);
      setReportCache((prev) => ({ ...prev, [agentId]: data ?? null }));
    } catch {
      setReportCache((prev) => ({ ...prev, [agentId]: null }));
    } finally {
      setLoadingReport(null);
    }
  };

  if (!tiers) return <div className="p-4 text-zinc-500">載入中…</div>;

  const hotCount = tiers.hot.length;

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
        {hotCount > 0 && (
          <div className="text-xs text-zinc-500 pt-0.5">
            💰 粗估成本：熱層 {hotCount} 支 × 每週 ≈ <span className="text-zinc-300 font-medium">NT${hotCount * 30}</span>（單支 Opus＋網路研究約 NT$15–60）
          </div>
        )}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">🔥 熱層（{tiers.hot.length}）</div>
        {tiers.hot.map((a) => (
          <StudyRow
            key={a.agentId}
            a={a}
            onRun={runNow}
            onOverride={setOverride}
            openReport={openReport}
            onToggleReport={toggleReport}
            reportData={reportCache[a.agentId]}
            loadingReport={loadingReport === a.agentId}
          />
        ))}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">🌡️ 冷層（{tiers.cold.length}）</div>
        {tiers.cold.map((a) => (
          <StudyRow
            key={a.agentId}
            a={a}
            onRun={runNow}
            onOverride={setOverride}
            openReport={openReport}
            onToggleReport={toggleReport}
            reportData={reportCache[a.agentId]}
            loadingReport={loadingReport === a.agentId}
          />
        ))}
      </div>
      <div>
        <div className="text-xs text-zinc-400 mb-1">💤 休眠（{tiers.dormant.length}，不自動跑{tiers.dormant.length > 30 ? "，顯示前 30" : ""}）</div>
        {tiers.dormant.slice(0, 30).map((a) => (
          <StudyRow
            key={a.agentId}
            a={a}
            onRun={runNow}
            onOverride={setOverride}
            openReport={openReport}
            onToggleReport={toggleReport}
            reportData={reportCache[a.agentId]}
            loadingReport={loadingReport === a.agentId}
          />
        ))}
      </div>
      {tiers.excluded.length > 0 && (
        <div>
          <div className="text-xs text-zinc-400 mb-1">🚫 已排除（{tiers.excluded.length}，不自動跑）</div>
          {tiers.excluded.map((a) => (
            <div key={a.agentId} className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-zinc-800/50">
              <span>
                {a.name}{" "}
                <span className="text-zinc-500 text-xs">
                  近30天 {a.sessions30d} 次
                  {a.lastResearchedAt ? ` · 上次進修 ${new Date(a.lastResearchedAt).toLocaleDateString()}` : " · 未進修"}
                </span>
              </span>
              <button
                onClick={() => setOverride(a.agentId, null)}
                className="text-xs px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
              >
                清除排除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
