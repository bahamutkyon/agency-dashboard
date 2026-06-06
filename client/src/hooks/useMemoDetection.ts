import { useMemo, useState } from "react";
import { api } from "../lib/api";

interface ChatMsg { role: string; content: string; partial?: boolean }

/**
 * 偵測 onboarding 對話產出的 === MEMO START/END === 區塊，並提供「套用到工作區」。
 */
export function useMemoDetection(
  messages: ChatMsg[],
  sessionId: string,
  onboardingTargetWorkspaceId: string | undefined,
  onMemoApplied: (() => void) | undefined,
) {
  const detectedMemo = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.partial) continue;
      const match = m.content.match(/=== MEMO START ===([\s\S]*?)=== MEMO END ===/);
      if (match) return match[1].trim();
    }
    return null;
  }, [messages]);

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const applyMemo = async () => {
    if (!detectedMemo) return;
    const { getActiveWorkspace } = await import("../lib/workspace");
    const wsId = onboardingTargetWorkspaceId || getActiveWorkspace();
    if (!wsId) {
      alert("請先在右上選好目標工作區再套用");
      return;
    }
    setApplying(true);
    try {
      await api.applyOnboarding(sessionId, wsId, detectedMemo);
      setApplied(true);
      onMemoApplied?.();
    } catch (e) {
      alert("套用失敗:" + (e as any).message);
    } finally {
      setApplying(false);
    }
  };

  return { detectedMemo, applying, applied, applyMemo };
}
