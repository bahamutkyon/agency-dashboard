import type { SessionRecord } from "../lib/api";
import { fmtRelative } from "../lib/relTime";
import { sessionHeading } from "../lib/sessionTitles";
import { sessionBadge } from "../lib/sessionStatus";

interface Props {
  /** 本工作區可接續的專案經理對話（新到舊，最多 3 場） */
  sessions: SessionRecord[];
  onResume: (s: SessionRecord) => void;
  onNewTopic: () => void;
  onMarkDone: (s: SessionRecord) => void;
}

/** 總管簡報最上方「接續上次」：打開工作區就看到中斷的對話停在哪，不用翻歷史。 */
export function ResumeStrip({ sessions, onResume, onNewTopic, onMarkDone }: Props) {
  if (sessions.length === 0) return null;
  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">↩ 接續上次</h2>
        <button onClick={onNewTopic} className="text-xs text-zinc-400 hover:text-zinc-200">＋ 開新話題</button>
      </div>
      {sessions.map((s) => {
        const badge = sessionBadge(s);
        // 有閒置時整理好的「停在哪」就用它；沒有才退回原文最後一句
        const stopped = s.stoppedAt || s.lastSnippet;
        const who = s.stoppedAt ? "" : s.lastRole === "user" ? "我" : "專案經理";
        return (
          <div key={s.id} className="flex items-start gap-3 border-t border-zinc-800/60 pt-2 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{sessionHeading(s)}</span>
                {badge && <span className={`text-[11px] px-1.5 py-0.5 rounded ${badge.className}`}>{badge.icon} {badge.label}</span>}
                <span className="text-[11px] text-zinc-500 whitespace-nowrap">
                  {fmtRelative(s.updatedAt)}{s.messageCount != null ? ` · ${s.messageCount} 則` : ""}
                </span>
              </div>
              {stopped && (
                <div className="text-xs text-zinc-400 line-clamp-2 mt-0.5">
                  <span className="text-zinc-500 mr-1">{who ? `停在［${who}］` : "停在："}</span>
                  {stopped}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={() => onResume(s)} className="text-xs px-2 py-1 rounded bg-accent hover:bg-violet-500 text-white">
                繼續
              </button>
              <button onClick={() => onMarkDone(s)} className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" title="這件事講完了，不再列在這裡（可在歷史重新開啟）">
                ✓ 標記完成
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
