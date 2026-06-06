import { useMemo, useState } from "react";
import { api } from "../lib/api";

interface ChatMsg { role: string; content: string; partial?: boolean }

/**
 * 偵測訊息中的 ```workflow JSON 區塊（PM 會草擬可重跑流程），並提供「套用為 Workflow」。
 */
export function useWorkflowDetection(messages: ChatMsg[], sessionId: string) {
  const detectedWorkflow = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant" || m.partial) continue;
      const match = m.content.match(/```workflow\s*\n([\s\S]*?)\n```/);
      if (!match) continue;
      try {
        const wf = JSON.parse(match[1]);
        if (wf?.name && Array.isArray(wf?.steps)) return wf;
      } catch { /* keep scanning earlier */ }
    }
    return null;
  }, [messages]);

  const [applyingWf, setApplyingWf] = useState(false);
  const [appliedWf, setAppliedWf] = useState(false);

  const applyWorkflow = async () => {
    if (!detectedWorkflow) return;
    const wsId = (await import("../lib/workspace")).getActiveWorkspace();
    setApplyingWf(true);
    try {
      await api.applyWorkflowDraft(sessionId, wsId, detectedWorkflow);
      setAppliedWf(true);
    } catch (e: any) {
      alert("套用失敗:" + e.message);
    } finally {
      setApplyingWf(false);
    }
  };

  return { detectedWorkflow, applyingWf, appliedWf, applyWorkflow };
}
