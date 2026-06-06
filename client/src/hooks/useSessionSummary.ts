import { useState } from "react";
import { api } from "../lib/api";

/** Session 摘要：呼叫後端產生對話摘要。 */
export function useSessionSummary(sessionId: string) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    setSummary(null);
    try {
      const r = await api.summarize(sessionId);
      setSummary(r.summary);
    } catch (e: any) {
      setSummary(`摘要失敗:${e.message || "未知錯誤"}`);
    } finally {
      setSummarizing(false);
    }
  };

  const clearSummary = () => setSummary(null);

  return { summary, summarizing, summarize, clearSummary };
}
