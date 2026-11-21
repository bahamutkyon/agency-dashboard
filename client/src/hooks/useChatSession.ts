import { useEffect, useRef, useState } from "react";
import { getSocket, joinSession, leaveSession } from "../lib/socket";
import { notify } from "../lib/notifications";
import { applyDelta, applyFinal } from "../lib/chatMerge";
import { autoScrollMode } from "../lib/chatScroll";

export interface Msg {
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  partial?: boolean;
  tool?: { type: "call" | "result"; name?: string; status?: string; summary: string };
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
  /** CLI 回報的實際模型（socket 的 model 事件；初始值由 ChatWindow 從 session 紀錄 hydrate）。 */
  const [model, setModel] = useState<string | null>(null);
  const streamingRef = useRef<string>("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  // socket subscription
  useEffect(() => {
    const sock = getSocket();
    // Use joinSession so the session is tracked for automatic rejoin after
    // reconnect (mobile lock-screen / Tailscale glitch / network switch).
    joinSession(sessionId);

    const handler = (evt: any) => {
      if (evt.sessionId !== sessionId) return;
      switch (evt.type) {
        case "delta": {
          streamingRef.current += evt.payload;
          const streamed = streamingRef.current;
          setMessages((prev) => applyDelta(prev, streamed));
          break;
        }
        case "message": {
          streamingRef.current = "";
          setMessages((prev) => applyFinal(prev, evt.payload.content));
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
        case "system-note": {
          // A1：後端插入的非 LLM 系統說明（如「已交辦給 X，正在等回覆」），直接顯示為系統泡泡。
          const content = evt.payload?.content;
          if (content) setMessages((prev) => [...prev, { role: "system", content: String(content), ts: Date.now() }]);
          break;
        }
        case "model": {
          if (typeof evt.payload === "string") setModel(evt.payload);
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
        case "tool_call": {
          const name = evt.payload?.name || "工具";
          setMessages((prev) => [...prev, { role: "system", content: "", ts: Date.now(), tool: { type: "call", name, summary: name } }]);
          break;
        }
        case "tool_result": {
          const toolStatus = evt.payload?.status;
          const rawText = evt.payload?.text;
          const fallback = toolStatus === "error" ? "工具錯誤" : "工具完成";
          const summary = rawText ? String(rawText).slice(0, 80) : fallback;
          setMessages((prev) => [...prev, { role: "system", content: "", ts: Date.now(), tool: { type: "result", status: toolStatus, summary } }]);
          break;
        }
      }
    };
    sock.on("session:event", handler);
    return () => {
      leaveSession(sessionId);
      sock.off("session:event", handler);
    };
  }, [sessionId, onStatusChange, agentName]);

  // autoscroll：打開對話時直接跳到最底；自己送出時捲到底；其餘貼近底部才跟著捲
  const initialScrollPendingRef = useRef(true);
  const prevCountRef = useRef(0);
  useEffect(() => {
    initialScrollPendingRef.current = true;
    prevCountRef.current = 0;
  }, [sessionId]);
  useEffect(() => {
    const el = scrollerRef.current;
    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    if (!el) return;
    const mode = autoScrollMode({
      initialPending: initialScrollPendingRef.current,
      prevCount,
      count: messages.length,
      lastRole: messages[messages.length - 1]?.role,
      distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
    });
    if (mode === "none") return;
    if (mode === "jump") {
      initialScrollPendingRef.current = false;
      el.scrollTop = el.scrollHeight;
      // markdown／圖片排版完高度會再長一點，下一幀再補一次
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return { messages, setMessages, status, setStatus, autoInjectedNotes, scrollerRef, streamingRef, model, setModel };
}
