import { useCallback, useState } from "react";
import { api, type ClaudeHealth } from "../lib/api";
import { useVisiblePolling } from "../hooks/useVisiblePolling";

/**
 * Claude Code 登入失效的全站橫幅。
 *
 * 起因：2026-09 這台電腦的 Claude CLI 登入過期約 7 週，所有 AI 功能（每日簡報、能力學習、
 * 派工…）都在失敗，卻各自記成「解析失敗」「完成」「0 token」——沒有任何地方直接說「登入掉了」。
 * server 端 claudeHealth 集中判讀所有 claude 呼叫，這裡只負責把結論與修復步驟顯示出來。
 */
const POLL_MS = 60_000;

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-TW", { hour12: false });
}

export function ClaudeHealthBanner() {
  const [health, setHealth] = useState<ClaudeHealth | null>(null);
  const [dismissedSince, setDismissedSince] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const reload = useCallback(() => {
    api.claudeHealth().then(setHealth).catch(() => { /* 端點失敗不打擾使用者 */ });
  }, []);
  useVisiblePolling(reload, POLL_MS);

  const recheck = async () => {
    setChecking(true);
    setNote(null);
    try {
      const h = await api.probeClaudeHealth();
      setHealth(h);
      if (h.status === "ok") {
        setNote({ tone: "ok", text: "✅ 登入已恢復，AI 功能可以正常使用了。" });
        window.setTimeout(() => setNote(null), 6000);
      } else if (h.status === "auth_failed") {
        setNote({ tone: "warn", text: "仍然失效——請照下方步驟重新登入後再按一次。" });
      } else if (h.lastProbe && !h.lastProbe.ok) {
        setNote({ tone: "warn", text: `檢查沒有完成（不是登入問題）：${h.lastProbe.error ?? "未知錯誤"}` });
      }
    } catch (e: any) {
      setNote({ tone: "warn", text: `檢查失敗：${e?.message || e}` });
    } finally {
      setChecking(false);
    }
  };

  // 剛恢復：短暫顯示綠色確認
  if (note?.tone === "ok") {
    return (
      <div role="status" className="px-4 py-2 bg-emerald-900/80 border-b border-emerald-700 text-emerald-100 text-sm z-50 flex-shrink-0">
        {note.text}
      </div>
    );
  }

  if (!health || health.status !== "auth_failed") return null;
  if (dismissedSince !== null && dismissedSince === health.since) return null;

  return (
    <div role="alert" className="px-4 py-2 bg-rose-900/90 border-b border-rose-700 text-rose-100 text-sm z-50 flex-shrink-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium">⚠️ Claude Code 登入已失效——聊天、派工、每日簡報、能力學習等 AI 功能都會失敗</span>
        <span className="text-rose-300 text-xs">
          自 {fmtTime(health.since)} 起 · 已失敗 {health.failures} 次
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs px-2 py-1 rounded border border-rose-600 hover:bg-rose-800"
          >
            {expanded ? "收合" : "怎麼修"}
          </button>
          <button
            onClick={recheck}
            disabled={checking}
            className="text-xs px-2 py-1 rounded bg-rose-700 hover:bg-rose-600 disabled:opacity-60"
          >
            {checking ? "檢查中…" : "重新檢查"}
          </button>
          <button
            onClick={() => setDismissedSince(health.since)}
            className="text-rose-300 hover:text-white font-bold px-2"
            aria-label="暫時關閉登入失效提示"
            title="暫時關閉（這次失效期間不再顯示；之後若再失效會重新出現）"
          >
            ×
          </button>
        </div>
      </div>
      {note && <div className="mt-2 text-amber-200 text-xs">{note.text}</div>}
      {expanded && (
        <div className="mt-2 space-y-2">
          {health.remedy && (
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-rose-50 bg-rose-950/60 rounded p-2">{health.remedy}</pre>
          )}
          {health.lastError && (
            <div className="text-xs text-rose-300 break-words">最近一次錯誤原文：{health.lastError}</div>
          )}
        </div>
      )}
    </div>
  );
}
