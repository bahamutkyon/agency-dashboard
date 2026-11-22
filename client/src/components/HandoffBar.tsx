import { useEffect, useRef, useState } from "react";
import { shouldNudge, nudgeDismissed, dismissNudge, HANDOFF_REQUEST_TEXT } from "../lib/handoffNudge";
import { getSocket } from "../lib/socket";

interface Props {
  sessionId: string;
  messages: { role: string; content: string }[];
  status: string;
  onSend: (text: string) => void;
  handedOff: boolean;
  /** 伺服器推 session:handoff_failed 的錯誤訊息 */
  failError?: string | null;
}

/** 回合結束的狀態（idle 為正常結束；error/closed 也算這回合沒下文） */
const TURN_END = new Set(["idle", "error", "closed"]);

/** 專案經理對話頂部：🔁 交接鈕、過長提醒、按鈕交接失敗提示。 */
export function HandoffBar({ sessionId, messages, status, onSend, handedOff, failError }: Props) {
  const [dismissed, setDismissed] = useState(() => nudgeDismissed(sessionId));
  const [failed, setFailed] = useState(false);
  // 只追蹤「按鈕觸發」的那一回合：sent → busy → 結束；自然語言觸發不檢查。
  const pending = useRef<"sent" | "busy" | null>(null);

  useEffect(() => { setDismissed(nudgeDismissed(sessionId)); setFailed(false); pending.current = null; }, [sessionId]);
  // 交接請求送出就失敗（伺服器回 session:error、從沒進 busy）：立即提示並清掉追蹤，
  // 否則 pending 停在 "sent"，下一個普通回合結束會被誤判成「交接單沒有產生」。
  useEffect(() => {
    const sock = getSocket();
    const h = (e: { sessionId?: string }) => {
      if (e?.sessionId !== sessionId || pending.current !== "sent") return;
      pending.current = null;
      setFailed(true);
    };
    sock.on("session:error", h);
    return () => { sock.off("session:error", h); };
  }, [sessionId]);
  useEffect(() => {
    if (pending.current === "sent" && status === "busy") pending.current = "busy";
    else if (pending.current === "busy" && TURN_END.has(status)) {
      pending.current = null;
      // session:handoff 會在 result（idle）之前到 → 成功時 handedOff 已是 true，不會誤報。
      if (!handedOff && !failError) setFailed(true);
    }
  }, [status, handedOff, failError]);

  if (handedOff) return null;
  const totalChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const nudge = shouldNudge({ messageCount: messages.length, totalChars, dismissed });
  const request = () => { setFailed(false); pending.current = "sent"; onSend(HANDOFF_REQUEST_TEXT); };

  return (
    <div className="px-4 py-1.5 border-b border-zinc-800 text-xs flex items-center gap-2 flex-wrap">
      {nudge && <span className="text-amber-300">這場已經很長（{messages.length} 則），交接到新對話？</span>}
      {failError
        ? <span className="text-rose-300">交接失敗：{failError}，可以再按一次</span>
        : failed && <span className="text-rose-300">交接單沒有產生，再按一次</span>}
      <span className="flex-1" />
      <button onClick={request} disabled={status === "busy"} className="text-sky-300 hover:text-sky-200 disabled:opacity-40" title="請專案經理整理交接單，自動開新對話接手">🔁 交接</button>
      {nudge && <button onClick={() => { dismissNudge(sessionId); setDismissed(true); }} className="text-zinc-500 hover:text-zinc-300">不用</button>}
    </div>
  );
}
