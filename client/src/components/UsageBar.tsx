import { useEffect, useState } from "react";

interface UsageSummary {
  today: { date: string; costUSD: number; inputTokens: number; outputTokens: number; turns: number };
  total: { costUSD: number; turns: number };
  rateLimit?: {
    status: string;
    rateLimitType: string;
    resetsAt: number;
    capturedAt: number;
  };
  last7: { date: string; costUSD: number; turns: number }[];
}

function fmtUSD(n: number) { return `$${n.toFixed(2)}`; }
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCountdown(resetsAt: number) {
  const ms = resetsAt * 1000 - Date.now();
  if (ms <= 0) return "已重置";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

export function UsageBar() {
  const [u, setU] = useState<UsageSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetch1 = () => fetch("/api/usage").then((r) => r.json()).then((d) => alive && setU(d)).catch(() => {});
    fetch1();
    const t = setInterval(fetch1, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!u) return <div className="px-3 text-xs text-zinc-500">載入用量…</div>;

  const rl = u.rateLimit;
  const rlColor =
    !rl ? "bg-zinc-700" :
    rl.status === "exceeded" ? "bg-rose-500" :
    rl.status === "approaching_limit" || rl.status === "approaching" ? "bg-amber-400" :
    "bg-emerald-400";
  const rlText =
    !rl ? "未知" :
    rl.status === "exceeded" ? "已耗盡" :
    rl.status === "approaching_limit" || rl.status === "approaching" ? "接近上限" :
    "充足";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 text-xs px-3 py-1 hover:bg-zinc-900 rounded"
        title="點擊查看詳細用量"
      >
        <div className="flex items-center gap-1">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${rlColor}`} />
          <span className="text-zinc-400">5h 額度</span>
          <span className="text-zinc-200">{rlText}</span>
          {rl && rl.resetsAt > 0 && (
            <span className="text-zinc-500">· 重置 {fmtCountdown(rl.resetsAt)}</span>
          )}
        </div>
        <span className="text-zinc-700">|</span>
        <span className="text-zinc-400">今日</span>
        <span className="text-zinc-200">{u.today.turns} 次對話</span>
        <span className="text-zinc-500">{fmtUSD(u.today.costUSD)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-panel border border-zinc-700 rounded-lg shadow-lg z-20 p-4">
          <div className="text-sm font-medium mb-3">用量明細</div>

          <div className="space-y-2 text-xs">
            <Row label="今日成本" value={fmtUSD(u.today.costUSD)} />
            <Row label="今日對話次數" value={`${u.today.turns}`} />
            <Row label="今日 input tokens" value={fmtTokens(u.today.inputTokens)} />
            <Row label="今日 output tokens" value={fmtTokens(u.today.outputTokens)} />
            <div className="border-t border-zinc-800 my-2" />
            <Row label="累計成本" value={fmtUSD(u.total.costUSD)} />
            <Row label="累計對話" value={`${u.total.turns}`} />
          </div>

          <div className="mt-4">
            <div className="text-xs text-zinc-500 mb-2">最近 7 天</div>
            <div className="flex items-end gap-1 h-12">
              {u.last7.map((d) => {
                const max = Math.max(...u.last7.map((x) => x.costUSD), 0.01);
                const h = Math.max(2, (d.costUSD / max) * 48);
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center" title={`${d.date}: ${fmtUSD(d.costUSD)} / ${d.turns} 次`}>
                    <div className="w-full bg-accent/40 rounded-t" style={{ height: `${h}px` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 mt-1">
              {u.last7.map((d) => (
                <div key={d.date} className="flex-1 text-center text-[10px] text-zinc-600">
                  {d.date.slice(5)}
                </div>
              ))}
            </div>
          </div>

          {rl && (
            <div className="mt-4 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
              <div>5 小時額度狀態:<span className="text-zinc-300 ml-1">{rl.status}</span></div>
              {rl.resetsAt > 0 && (
                <div>下次重置:{new Date(rl.resetsAt * 1000).toLocaleString("zh-TW", { hour12: false })}</div>
              )}
            </div>
          )}

          <div className="mt-4 text-[11px] text-zinc-500 border-t border-zinc-800 pt-3">
            提示:成本是 Claude API 的 list price 估算。實際使用 Max 訂閱不會被收這筆,但可拿來判斷哪幾個 agent 燒比較兇。
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 font-mono">{value}</span>
    </div>
  );
}
