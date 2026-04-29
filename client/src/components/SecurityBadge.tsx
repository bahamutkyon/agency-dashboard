import { useEffect, useState } from "react";

interface SecurityStatus {
  healthy: boolean;
  baseline: { name: string; configured: boolean }[];
  stats: {
    sessionsWithMcp: number;
    sessionsWithoutMcp: number;
    lastInjectionAt: number;
    lastMcpNames: string[];
    uptimeMs: number;
  };
}

function fmtAgo(ts: number): string {
  if (!ts) return "尚未注入";
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  return `${h} 小時前`;
}

export function SecurityBadge() {
  const [s, setS] = useState<SecurityStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      fetch("/api/security/status")
        .then((r) => r.json())
        .then((d) => alive && setS(d))
        .catch(() => {});
    refresh();
    const t = setInterval(refresh, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!s) {
    return <div className="px-2 text-xs text-zinc-500">🛡️ …</div>;
  }

  const dotColor = s.healthy ? "bg-emerald-400" : "bg-rose-500";
  const ringColor = s.healthy ? "ring-emerald-400/30" : "ring-rose-500/30";
  const labelColor = s.healthy ? "text-emerald-300" : "text-rose-300";
  const tip = s.healthy
    ? `shellward 保護中｜已注入 ${s.stats.sessionsWithMcp} 場對話`
    : "保護未啟用 — 點擊查看詳情";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-zinc-800 ${labelColor}`}
        title={tip}
      >
        <span className="text-sm">🛡️</span>
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor} ring-2 ${ringColor}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 z-50 text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-zinc-100">底層安全防護</div>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="關閉"
            >×</button>
          </div>

          <div className={`flex items-center gap-2 mb-3 px-2 py-1.5 rounded ${
            s.healthy ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
          }`}>
            <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
            <span className="font-medium">
              {s.healthy ? "保護中" : "保護未啟用"}
            </span>
          </div>

          <div className="space-y-1.5 mb-3">
            <div className="text-zinc-400 mb-1">基線 MCP(強制啟用):</div>
            {s.baseline.length === 0 && (
              <div className="text-zinc-500 italic">無</div>
            )}
            {s.baseline.map((b) => (
              <div key={b.name} className="flex items-center gap-2">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  b.configured ? "bg-emerald-400" : "bg-rose-500"
                }`} />
                <span className="font-mono text-zinc-200">{b.name}</span>
                <span className="text-zinc-500">
                  {b.configured ? "已配置" : "未配置(請檢查 ~/.claude.json)"}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 pt-2 space-y-1 text-zinc-400">
            <div className="flex justify-between">
              <span>已保護對話</span>
              <span className="text-emerald-300 font-mono">{s.stats.sessionsWithMcp}</span>
            </div>
            {s.stats.sessionsWithoutMcp > 0 && (
              <div className="flex justify-between">
                <span>未保護對話</span>
                <span className="text-amber-300 font-mono">{s.stats.sessionsWithoutMcp}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>最近一次注入</span>
              <span className="text-zinc-300">{fmtAgo(s.stats.lastInjectionAt)}</span>
            </div>
            {s.stats.lastMcpNames.length > 0 && (
              <div className="flex justify-between">
                <span>最近注入內容</span>
                <span className="text-zinc-300 font-mono text-[10px]">
                  {s.stats.lastMcpNames.join(", ")}
                </span>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-800 pt-2 mt-2 text-[10px] text-zinc-500 leading-relaxed">
            shellward 攔截 prompt injection、危險命令、PII 外洩、資料外送鏈。
            Claude / Codex session 自動套用,Gemini 已是 plan 模式無攻擊面。
          </div>
        </div>
      )}
    </div>
  );
}
