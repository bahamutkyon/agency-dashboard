import { useEffect, useRef, useState } from "react";
import { api, type Note } from "../lib/api";
import { getSocket } from "../lib/socket";
import { getActiveWorkspace } from "../lib/workspace";

interface ResearchProgressState {
  status: "running" | "done" | "error" | "unknown";
  stage: string;
  total: number;
  done: number;
}

/** 依 stage 回顯示文字。 */
function stageText(stage: string, total: number, done: number): string {
  switch (stage) {
    case "planning": return "規劃子問題…";
    case "planned": return total > 0 ? `研究中 0/${total}` : "規劃完成…";
    case "researching": return `研究中 ${done}/${total}`;
    case "synthesized": return "綜合中…";
    case "done": return "研究完成，成果已存入研究成果庫";
    case "error": return "研究失敗，請稍後重試";
    case "unknown": return "進度未知，完成後成果會出現在下方清單";
    default: return stage;
  }
}

export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", pinned: false });

  // 深入研究狀態
  const [researchQ, setResearchQ] = useState("");
  const [researchProgress, setResearchProgress] = useState<ResearchProgressState | null>(null);
  const [researchSubmitting, setResearchSubmitting] = useState(false);
  const activeRunId = useRef<string | null>(null);

  const reload = () => api.notes().then(setNotes).catch(() => {});
  useEffect(() => { reload(); }, []);

  // 深入研究：socket 進度監聽（依 runId 過濾，避免接到其他 run 的事件）
  useEffect(() => {
    const sock = getSocket();
    const onProgress = (p: { runId: string; status: string; stage: string; total: number; done: number }) => {
      if (!activeRunId.current || p.runId !== activeRunId.current) return;
      setResearchProgress({
        status: p.status as ResearchProgressState["status"],
        stage: p.stage,
        total: p.total,
        done: p.done,
      });
      if (p.status === "done") api.notes().then(setNotes).catch(() => {});
    };
    sock.on("research:progress", onProgress);
    return () => { sock.off("research:progress", onProgress); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 進度輪詢兜底：running 期間每 8 秒查一次 run 狀態（socket 掉線/漏 done 事件時仍能收斂）。
  // done/error/unmount 清 interval。查無此 run（in-flight 未落 DB 或已過期）→ 顯示「進度未知」並解鎖表單。
  useEffect(() => {
    if (researchProgress?.status !== "running") return;
    const runId = activeRunId.current;
    if (!runId) return;
    const iv = setInterval(() => {
      api.getResearchRun(runId)
        .then((r) => {
          setResearchProgress({
            status: r.status as ResearchProgressState["status"],
            stage: r.stage,
            total: r.total,
            done: r.done,
          });
          if (r.status === "done") api.notes().then(setNotes).catch(() => {});
        })
        .catch(() => {
          // 端點回 404 / 查無此 run → 收斂到 unknown（解鎖表單，避免卡在 running 永久禁用）。
          setResearchProgress({ status: "unknown", stage: "unknown", total: 0, done: 0 });
        });
    }, 8000);
    return () => clearInterval(iv);
  }, [researchProgress?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitResearch = async () => {
    const q = researchQ.trim();
    if (!q) return;
    setResearchSubmitting(true);
    setResearchProgress(null);
    try {
      const { runId } = await api.startResearch(q, getActiveWorkspace());
      activeRunId.current = runId;
      setResearchProgress({ status: "running", stage: "planning", total: 0, done: 0 });
    } catch {
      setResearchProgress({ status: "error", stage: "error", total: 0, done: 0 });
    } finally {
      setResearchSubmitting(false);
    }
  };

  const submit = async () => {
    if (!draft.title.trim() || !draft.body.trim()) return;
    if (editing) {
      await api.updateNote(editing.id, draft);
    } else {
      await api.createNote(draft);
    }
    setEditing(null);
    setDraft({ title: "", body: "", pinned: false });
    reload();
  };

  const startEdit = (n: Note) => {
    setEditing(n);
    setDraft({ title: n.title, body: n.body, pinned: !!n.pinned });
  };

  const remove = async (n: Note) => {
    if (!confirm(`刪除「${n.title}」?`)) return;
    await api.deleteNote(n.id);
    reload();
  };

  const togglePin = async (n: Note) => {
    await api.updateNote(n.id, { pinned: !n.pinned });
    reload();
  };

  const cancel = () => { setEditing(null); setDraft({ title: "", body: "", pinned: false }); };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">📒 共享筆記/知識庫</h2>
          <p className="text-xs text-zinc-500 mt-1">
            存品牌語氣、產品資訊、長期 context。對話框旁可一鍵附加筆記到下一條訊息。
          </p>
        </div>

        {/* 深入研究區塊 */}
        <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
          <div className="font-medium text-sm">🔬 深入研究</div>
          <p className="text-xs text-zinc-500">
            輸入主題，AI 自動拆子問題 → 並行多來源研究 → 綜合結論，成果自動存入本庫
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-900 px-3 py-2 rounded text-sm"
              placeholder="輸入研究主題，例如：台灣 AI 產業前景"
              value={researchQ}
              onChange={(e) => setResearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submitResearch(); }}
              disabled={researchSubmitting || researchProgress?.status === "running"}
            />
            <button
              onClick={submitResearch}
              disabled={researchSubmitting || researchProgress?.status === "running"}
              className="px-4 py-2 rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm whitespace-nowrap"
            >
              {researchSubmitting ? "送出中…" : "深入研究"}
            </button>
          </div>
          {researchProgress && (
            <div className={`text-xs px-3 py-2 rounded ${
              researchProgress.status === "error"
                ? "bg-rose-900/40 text-rose-300"
                : researchProgress.status === "done"
                ? "bg-emerald-900/40 text-emerald-300"
                : researchProgress.status === "unknown"
                ? "bg-zinc-800 text-zinc-400"
                : "bg-sky-900/40 text-sky-300 animate-pulse"
            }`}>
              {stageText(researchProgress.stage, researchProgress.total, researchProgress.done)}
            </div>
          )}
        </div>

        <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
          <div className="font-medium text-sm">{editing ? `編輯「${editing.title}」` : "新增筆記"}</div>
          <input
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
            placeholder="標題(例如:我的品牌語氣)"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
            rows={8}
            placeholder={"內容(支援 Markdown)\n例如:\n- 語氣:親切但專業\n- 受眾:25-35 歲剛接觸 AI 的上班族\n- 禁用詞:賦能、生態、賽道"}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
            置頂(對話框附加選單會優先顯示)
          </label>
          <div className="flex gap-2">
            <button onClick={submit} className="px-4 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm">
              {editing ? "儲存修改" : "建立筆記"}
            </button>
            {editing && (
              <button onClick={cancel} className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">取消</button>
            )}
          </div>
        </div>

        {notes.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">📒</div>
            <div className="text-sm">還沒有筆記。建議先寫一份「品牌語氣」+「受眾畫像」的核心知識庫</div>
          </div>
        )}

        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="bg-panel border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {n.pinned && <span title="置頂">📌</span>}
                    <span className="font-medium">{n.title}</span>
                  </div>
                  <pre className="text-xs text-zinc-400 mt-2 font-mono whitespace-pre-wrap break-words">
                    {n.body.length > 300 ? n.body.slice(0, 300) + "…" : n.body}
                  </pre>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => togglePin(n)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">
                    {n.pinned ? "取消置頂" : "置頂"}
                  </button>
                  <button onClick={() => startEdit(n)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">編輯</button>
                  <button onClick={() => remove(n)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white">刪除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
