import { useEffect, useState } from "react";
import { api, type Note } from "../lib/api";

export function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", pinned: false });

  const reload = () => api.notes().then(setNotes).catch(() => {});
  useEffect(() => { reload(); }, []);

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
