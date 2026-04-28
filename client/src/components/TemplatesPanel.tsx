import { useEffect, useState } from "react";
import { api, type AgentMeta, type PromptTemplate } from "../lib/api";

interface Props {
  agents: AgentMeta[];
}

export function TemplatesPanel({ agents }: Props) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [draft, setDraft] = useState({ name: "", body: "", agentId: "" });

  const reload = () => api.templates().then(setTemplates).catch(() => {});
  useEffect(() => { reload(); }, []);

  const submit = async () => {
    if (!draft.name.trim() || !draft.body.trim()) return;
    if (editing) {
      await api.updateTemplate(editing.id, {
        name: draft.name, body: draft.body, agentId: draft.agentId || undefined,
      });
    } else {
      await api.createTemplate({
        name: draft.name, body: draft.body, agentId: draft.agentId || undefined,
      });
    }
    setEditing(null);
    setDraft({ name: "", body: "", agentId: "" });
    reload();
  };

  const startEdit = (t: PromptTemplate) => {
    setEditing(t);
    setDraft({ name: t.name, body: t.body, agentId: t.agentId || "" });
  };

  const remove = async (t: PromptTemplate) => {
    if (!confirm(`刪除模板「${t.name}」?`)) return;
    await api.deleteTemplate(t.id);
    reload();
  };

  const cancel = () => { setEditing(null); setDraft({ name: "", body: "", agentId: "" }); };

  const agentName = (id?: string) => id ? (agents.find((a) => a.id === id)?.name || id) : "—";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">📋 Prompt 模板庫</h2>
          <p className="text-xs text-zinc-500 mt-1">
            把常用的指令存起來,在任何對話框裡用 <kbd className="px-1 bg-zinc-800 rounded">/</kbd> 快速插入
          </p>
        </div>

        <div className="bg-panel border border-zinc-800 rounded-lg p-4 mb-6 space-y-3">
          <div className="font-medium text-sm">{editing ? `編輯「${editing.name}」` : "新增模板"}</div>
          <input
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
            placeholder="模板名稱(例如:小紅書貼文初稿)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <select
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
            value={draft.agentId}
            onChange={(e) => setDraft({ ...draft, agentId: e.target.value })}
          >
            <option value="">不綁定特定 agent(可在任何對話用)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>[{a.category}] {a.name}</option>
            ))}
          </select>
          <textarea
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
            rows={6}
            placeholder={"模板內容\n例如:幫我用我的品牌語氣寫一篇關於 {主題} 的貼文,400 字內,結尾要 hashtag"}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              className="px-4 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm"
            >
              {editing ? "儲存修改" : "建立模板"}
            </button>
            {editing && (
              <button onClick={cancel} className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">取消</button>
            )}
          </div>
        </div>

        {templates.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">📋</div>
            <div className="text-sm">還沒有模板。在上面新增一個試試</div>
          </div>
        )}

        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="bg-panel border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.agentId && (
                      <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">
                        綁定:{agentName(t.agentId)}
                      </span>
                    )}
                  </div>
                  <pre className="text-xs text-zinc-400 mt-2 font-mono whitespace-pre-wrap break-words">
                    {t.body.length > 240 ? t.body.slice(0, 240) + "…" : t.body}
                  </pre>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => startEdit(t)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded">編輯</button>
                  <button onClick={() => remove(t)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white">刪除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
