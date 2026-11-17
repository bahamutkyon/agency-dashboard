import { useState } from "react";
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
  onPark: (s: SessionRecord) => void;
  /** 在卡片上直接回覆（不用跳進對話視窗） */
  onReply: (s: SessionRecord, text: string) => void;
  /** 本工作區未結束的對話總數；比列出的多時顯示「整理」入口 */
  openCount?: number;
  onOpenTidy?: () => void;
}

function ResumeItem({ s, onResume, onMarkDone, onPark, onReply }: { s: SessionRecord } & Pick<Props, "onResume" | "onMarkDone" | "onPark" | "onReply">) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const badge = sessionBadge(s);
  const stopped = s.stoppedAt || s.lastSnippet;
  const who = s.stoppedAt ? "" : s.lastRole === "user" ? "我" : "專案經理";
  const send = (t: string) => {
    const v = t.trim();
    if (!v) return;
    onReply(s, v);
    setSent(true);
    setReplying(false);
    setText("");
  };

  return (
    <div className="border-t border-zinc-800/60 pt-2 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{sessionHeading(s)}</span>
            {badge && !sent && <span className={`text-[11px] px-1.5 py-0.5 rounded ${badge.className}`}>{badge.icon} {badge.label}</span>}
            <span className="text-[11px] text-zinc-500 whitespace-nowrap">
              {fmtRelative(s.updatedAt)}{s.messageCount != null ? ` · ${s.messageCount} 則` : ""}
            </span>
          </div>
          {stopped && !sent && (
            <div className="text-xs text-zinc-400 line-clamp-2 mt-0.5">
              <span className="text-zinc-500 mr-1">{who ? `停在［${who}］` : "停在："}</span>
              {stopped}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0 items-end">
          <button onClick={() => onResume(s)} className="text-xs px-2 py-1 rounded bg-accent hover:bg-violet-500 text-white">繼續</button>
          {!sent && (
            <div className="flex gap-1">
              <button onClick={() => onMarkDone(s)} className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" title="這件事講完了或不做了">✓ 完成</button>
              <button onClick={() => onPark(s)} className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" title="還沒想開始，先擱著（在整理畫面可拉回）">💤 先擱著</button>
            </div>
          )}
        </div>
      </div>

      {sent ? (
        <div className="mt-1.5 text-xs text-emerald-300 flex items-center gap-2">
          ✓ 已送出，專案經理回覆中…
          <button onClick={() => onResume(s)} className="underline text-zinc-300 hover:text-white">打開看回覆</button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
          {(s.lastOptions || []).map((o) => (
            <button key={o.key} onClick={() => send(o.key)} title={`回覆「${o.key}」`}
              className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:border-accent hover:text-white max-w-full truncate">
              {o.key}. {o.label}
            </button>
          ))}
          {!replying && (
            <button onClick={() => setReplying(true)} className="text-[11px] px-2 py-0.5 rounded text-zinc-400 hover:text-white">✍ 回覆</button>
          )}
        </div>
      )}
      {replying && !sent && (
        <div className="mt-1.5 flex gap-1.5">
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } if (e.key === "Escape") setReplying(false); }}
            placeholder="回覆專案經理…（Enter 送出、Shift+Enter 換行）"
            className="flex-1 bg-zinc-900 px-2 py-1 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={() => send(text)} disabled={!text.trim()} className="text-xs px-3 rounded bg-accent hover:bg-violet-500 text-white disabled:opacity-40">送出</button>
        </div>
      )}
    </div>
  );
}

/** 總管簡報最上方「接續上次」：看到中斷的對話停在哪，能直接回覆、完成或擱著，不用翻歷史。 */
export function ResumeStrip({ sessions, onResume, onNewTopic, onMarkDone, onPark, onReply, openCount, onOpenTidy }: Props) {
  if (sessions.length === 0) return null;
  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-200">↩ 接續上次</h2>
        <div className="flex gap-3">
          {onOpenTidy && openCount != null && openCount > sessions.length && (
            <button onClick={onOpenTidy} className="text-xs text-zinc-400 hover:text-zinc-200">🧹 整理（{openCount} 場未結束）</button>
          )}
          <button onClick={onNewTopic} className="text-xs text-zinc-400 hover:text-zinc-200">＋ 開新話題</button>
        </div>
      </div>
      {sessions.map((s) => (
        <ResumeItem key={s.id} s={s} onResume={onResume} onMarkDone={onMarkDone} onPark={onPark} onReply={onReply} />
      ))}
    </section>
  );
}
