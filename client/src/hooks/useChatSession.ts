import { useEffect, useRef, useState } from "react";
import { getSocket } from "../lib/socket";
import { notify } from "../lib/notifications";

export interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  partial?: boolean;
}

/**
 * 對話 session 核心：訊息串流（socket delta/message/status/result/error/notes-injected/
 * dispatch:done）、訊息狀態、自動捲動、後端自動注入筆記提示。
 * 歷史載入由 ChatWindow 統一處理（同時 hydrate tags），透過回傳的 setter 寫入。
 */
export function useChatSession(
  sessionId: string,
  agentName: string,
  onStatusChange: ((status: string) => void) | undefined,
) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [autoInjectedNotes, setAutoInjectedNotes] = useState<{ title: string }[]>([]);
  const streamingRef = useRef<string>("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  // socket subscription
  useEffect(() => {
    const sock = getSocket();
    sock.emit("session:join", sessionId);

    const handler = (evt: any) => {
      if (evt.sessionId !== sessionId) return;
      switch (evt.type) {
        case "delta": {
          streamingRef.current += evt.payload;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.partial) {
              return [...prev.slice(0, -1), { ...last, content: streamingRef.current }];
            }
            return [...prev, { role: "assistant", content: streamingRef.current, ts: Date.now(), partial: true }];
          });
          break;
        }
        case "message": {
          streamingRef.current = "";
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const finalMsg: Msg = { role: "assistant", content: evt.payload.content, ts: Date.now() };
            if (last && last.partial) return [...prev.slice(0, -1), finalMsg];
            return [...prev, finalMsg];
          });
          break;
        }
        case "status": {
          setStatus(evt.payload);
          onStatusChange?.(evt.payload);
          break;
        }
        case "result": {
          setStatus("idle");
          onStatusChange?.("idle");
          notify(`${agentName} 回應完畢`, "切回儀表板查看結果", { tag: sessionId });
          break;
        }
        case "error": {
          setMessages((prev) => [...prev, { role: "system", content: `[錯誤] ${evt.payload}`, ts: Date.now() }]);
          break;
        }
        case "notes-injected": {
          setAutoInjectedNotes(evt.payload || []);
          setTimeout(() => setAutoInjectedNotes([]), 8000);
          break;
        }
        case "dispatch:done": {
          const ok = evt.payload?.status === "ok";
          notify(`外包任務${ok ? "完成" : "結束"}`, `${evt.payload?.agentId || "同事"} 已回報,專案經理整理中`, { tag: sessionId });
          break;
        }
      }
    };
    sock.on("session:event", handler);
    return () => { sock.off("session:event", handler); };
  }, [sessionId, onStatusChange, agentName]);

  // autoscroll
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return { messages, setMessages, status, setStatus, autoInjectedNotes, scrollerRef, streamingRef };
}
