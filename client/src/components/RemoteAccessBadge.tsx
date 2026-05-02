import { useEffect, useState } from "react";

interface RemoteStatus {
  enabled: boolean;
  bindHost: string;
  requiresToken: boolean;
  allowedRangesCount: number;
  note: string;
}

/**
 * Only renders when ENABLE_REMOTE_ACCESS=true on the server. When off (the
 * default for everyone who hasn't opted in), this is invisible — no clutter
 * for users running localhost-only.
 */
export function RemoteAccessBadge() {
  const [s, setS] = useState<RemoteStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/remote-access/status")
      .then((r) => r.json())
      .then((d) => alive && setS(d))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // No badge when remote access is off — keeps the header clean for the
  // 99% of users who don't use this feature.
  if (!s || !s.enabled) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-zinc-800 text-blue-300"
        title="遠端存取已開啟 — 點開看詳情"
      >
        <span className="text-sm">📱</span>
        <span className="hidden md:inline">遠端中</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3 z-50 text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-zinc-100">📱 遠端存取狀態</div>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">×</button>
          </div>

          <div className="bg-blue-500/10 text-blue-300 px-2 py-1.5 rounded mb-3">
            {s.note}
          </div>

          <div className="space-y-1.5 text-zinc-400">
            <div className="flex justify-between">
              <span>綁定 host</span>
              <span className="font-mono text-zinc-200">{s.bindHost}</span>
            </div>
            <div className="flex justify-between">
              <span>允許網段數</span>
              <span className="font-mono text-zinc-200">{s.allowedRangesCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Token 認證</span>
              <span className={s.requiresToken ? "text-emerald-300" : "text-amber-300"}>
                {s.requiresToken ? "已啟用" : "未設定"}
              </span>
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-2 mt-3 text-[10px] text-zinc-500 leading-relaxed">
            從手機連:打開 <code className="bg-zinc-800 px-1 rounded">http://&lt;你電腦的 LAN/Tailscale IP&gt;:5190</code>
            {!s.requiresToken && (
              <div className="mt-1 text-amber-400">
                ⚠️ 沒設 ACCESS_TOKEN — 若你打算用公網 tunnel(例如 Cloudflare Tunnel),強烈建議設一個。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
