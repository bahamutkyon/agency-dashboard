import { useState } from "react";
import { api, type Project } from "../lib/api";

interface Props {
  project: Project;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}

/**
 * 專案記憶面板 — 顯示並編輯某個專案的 memory 欄位。
 * 風格仿 AgentMemoryModal。
 */
export function ProjectMemoryModal({ project, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(project.memory || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.updateProject(project.id, { memory: draft });
      setMsg("✓ 已儲存");
      onSaved?.(res.project);
    } catch (e: any) {
      setMsg("✗ 儲存失敗: " + (e.message || "未知錯誤"));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  const isDirty = draft !== (project.memory || "");

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-panel border border-zinc-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* header */}
        <div className="px-4 md:px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
          <div className="text-2xl">📁</div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-zinc-100 truncate">{project.name} · 專案記憶</div>
            <div className="text-[11px] text-zinc-500">
              {project.memory
                ? `${project.memory.length} 字 · 上次更新 ${new Date(project.updatedAt).toLocaleString("zh-TW")}`
                : "尚無記憶內容"}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 px-2">×</button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          <div className="text-[11px] text-zinc-500 mb-2 leading-relaxed">
            這份記憶會附帶到此專案下所有對話的系統提示，讓 agent 了解專案背景、目標與限制。
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="（尚無記憶。寫下專案背景、目標、注意事項…）

範例格式:
## 專案概覽
- 目標：...

## 限制與規範
- ...

## 目前進度
- ..."
          />
          <div className="text-[10px] text-zinc-500 mt-1 text-right">
            建議精簡，過長的記憶可能被截斷。
          </div>
        </div>

        {/* footer */}
        <div className="px-4 md:px-5 py-3 border-t border-zinc-800 bg-panel/40 flex items-center gap-2 flex-wrap">
          <button
            onClick={save}
            disabled={saving || !isDirty}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded"
          >
            {saving ? "儲存中…" : "💾 儲存修改"}
          </button>
          <div className="flex-1" />
          {msg && <span className="text-xs text-zinc-300">{msg}</span>}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
