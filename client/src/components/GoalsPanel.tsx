import { useState, useCallback, useEffect } from "react";
import { getActiveWorkspace } from "../lib/workspace";
import { api, type WorkspaceGoal } from "../lib/api";
import { useVisiblePolling } from "../hooks/useVisiblePolling";

type GoalStatus = "active" | "done" | "archived";

interface EditState {
  title: string;
  metric: string;
  currentValue: string;
  targetValue: string;
  deadline: string;
  note: string;
  status: GoalStatus;
}

const EMPTY_EDIT: EditState = {
  title: "",
  metric: "",
  currentValue: "",
  targetValue: "",
  deadline: "",
  note: "",
  status: "active",
};

export function GoalsPanel() {
  const [goals, setGoals] = useState<WorkspaceGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<GoalStatus | "all">("active");

  // 新增表單
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<EditState>(EMPTY_EDIT);
  const [creating, setCreating] = useState(false);

  // 編輯中的 goal id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    const ws = getActiveWorkspace();
    const statusOpt = filterStatus === "all" ? undefined : filterStatus;
    api
      .goals({ workspace: ws ?? undefined, status: statusOpt })
      .then((data) => {
        setGoals(data);
        setLoading(false);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "載入失敗");
        setLoading(false);
      });
  }, [filterStatus]);

  useVisiblePolling(reload, 10000);

  // re-fetch when filter changes
  useEffect(() => {
    setLoading(true);
    reload();
  }, [filterStatus, reload]);

  const handleCreate = useCallback(async () => {
    const ws = getActiveWorkspace();
    if (!ws || !createForm.title.trim()) return;
    setCreating(true);
    try {
      await api.createGoal(ws, {
        title: createForm.title.trim(),
        metric: createForm.metric.trim() || undefined,
        currentValue: createForm.currentValue.trim() || undefined,
        targetValue: createForm.targetValue.trim() || undefined,
        deadline: createForm.deadline.trim() || undefined,
        note: createForm.note.trim() || undefined,
      });
      setCreateForm(EMPTY_EDIT);
      setShowCreate(false);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setCreating(false);
    }
  }, [createForm, reload]);

  const startEdit = useCallback((g: WorkspaceGoal) => {
    setEditingId(g.id);
    setEditForm({
      title: g.title,
      metric: g.metric,
      currentValue: g.currentValue,
      targetValue: g.targetValue,
      deadline: g.deadline,
      note: g.note,
      status: g.status,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.updateGoal(editingId, {
        title: editForm.title.trim() || undefined,
        metric: editForm.metric,
        currentValue: editForm.currentValue,
        targetValue: editForm.targetValue,
        deadline: editForm.deadline,
        status: editForm.status,
        note: editForm.note,
      });
      setEditingId(null);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }, [editingId, editForm, reload]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteGoal(id);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setDeletingId(null);
    }
  }, [reload]);

  const STATUS_CHIP: Record<GoalStatus, string> = {
    active: "bg-emerald-700/40 text-emerald-300",
    done: "bg-sky-700/40 text-sky-300",
    archived: "bg-zinc-700/40 text-zinc-400",
  };

  const STATUS_LABEL: Record<GoalStatus, string> = {
    active: "進行中",
    done: "達成",
    archived: "封存",
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">🎯 目標帳本</h2>
        <div className="flex items-center gap-2">
          {/* filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as GoalStatus | "all")}
            className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
          >
            <option value="active">進行中</option>
            <option value="done">已達成</option>
            <option value="archived">已封存</option>
            <option value="all">全部</option>
          </select>
          <button
            onClick={() => { setShowCreate((v) => !v); setCreateForm(EMPTY_EDIT); }}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded"
          >
            {showCreate ? "取消" : "+ 新增"}
          </button>
          <button onClick={reload} className="text-xs text-zinc-500 hover:text-zinc-300">重整</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {error && (
          <div className="text-rose-400 text-xs p-2 bg-rose-900/20 rounded">{error}</div>
        )}

        {/* 新增表單 */}
        {showCreate && (
          <div className="border border-zinc-700 rounded p-3 space-y-2 bg-zinc-900">
            <div className="text-xs font-medium text-zinc-300 mb-1">新增目標</div>
            <input
              placeholder="目標一句話（必填）"
              value={createForm.title}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="指標名（如：本月成交台數）"
                value={createForm.metric}
                onChange={(e) => setCreateForm((f) => ({ ...f, metric: e.target.value }))}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
              />
              <input
                placeholder="期限（如：2026-07-31）"
                value={createForm.deadline}
                onChange={(e) => setCreateForm((f) => ({ ...f, deadline: e.target.value }))}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
              />
              <input
                placeholder="現值（如：1 台）"
                value={createForm.currentValue}
                onChange={(e) => setCreateForm((f) => ({ ...f, currentValue: e.target.value }))}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
              />
              <input
                placeholder="目標值（如：3 台）"
                value={createForm.targetValue}
                onChange={(e) => setCreateForm((f) => ({ ...f, targetValue: e.target.value }))}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
              />
            </div>
            <input
              placeholder="備註（選填）"
              value={createForm.note}
              onChange={(e) => setCreateForm((f) => ({ ...f, note: e.target.value }))}
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); setCreateForm(EMPTY_EDIT); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
              >
                取消
              </button>
              <button
                disabled={creating || !createForm.title.trim()}
                onClick={handleCreate}
                className="text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-200 px-3 py-1 rounded disabled:opacity-40"
              >
                {creating ? "建立中…" : "建立"}
              </button>
            </div>
          </div>
        )}

        {loading && <div className="text-zinc-500 text-sm">載入中…</div>}
        {!loading && goals.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-8">
            {filterStatus === "active" ? "沒有進行中的目標，按「+ 新增」設定第一個目標" : "沒有符合條件的目標"}
          </div>
        )}

        {goals.map((g) => (
          <div key={g.id} className="border border-zinc-800 rounded p-3 text-xs space-y-2">
            {editingId === g.id ? (
              /* 編輯模式 */
              <div className="space-y-2">
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                  placeholder="目標標題"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={editForm.metric}
                    onChange={(e) => setEditForm((f) => ({ ...f, metric: e.target.value }))}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                    placeholder="指標名"
                  />
                  <input
                    value={editForm.deadline}
                    onChange={(e) => setEditForm((f) => ({ ...f, deadline: e.target.value }))}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                    placeholder="期限"
                  />
                  <input
                    value={editForm.currentValue}
                    onChange={(e) => setEditForm((f) => ({ ...f, currentValue: e.target.value }))}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                    placeholder="現值"
                  />
                  <input
                    value={editForm.targetValue}
                    onChange={(e) => setEditForm((f) => ({ ...f, targetValue: e.target.value }))}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                    placeholder="目標值"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as GoalStatus }))}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300"
                  >
                    <option value="active">進行中</option>
                    <option value="done">達成</option>
                    <option value="archived">封存</option>
                  </select>
                  <input
                    value={editForm.note}
                    onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))}
                    className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                    placeholder="備註"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
                  >
                    取消
                  </button>
                  <button
                    disabled={saving}
                    onClick={handleSave}
                    className="text-xs bg-sky-800 hover:bg-sky-700 text-sky-200 px-3 py-1 rounded disabled:opacity-40"
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                </div>
              </div>
            ) : (
              /* 顯示模式 */
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-zinc-200">{g.title}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded ${STATUS_CHIP[g.status]}`}>
                      {STATUS_LABEL[g.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(g)}
                      className="text-zinc-500 hover:text-zinc-300 px-1"
                      title="編輯"
                    >
                      ✏️
                    </button>
                    <button
                      disabled={deletingId === g.id}
                      onClick={() => handleDelete(g.id)}
                      className="text-zinc-500 hover:text-rose-400 px-1 disabled:opacity-40"
                      title="刪除"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                {(g.metric || g.currentValue || g.targetValue) && (
                  <div className="text-zinc-400 flex items-center gap-2 flex-wrap">
                    {g.metric && <span className="text-zinc-500">{g.metric}</span>}
                    {(g.currentValue || g.targetValue) && (
                      <span>
                        <span className="text-zinc-200 font-medium">{g.currentValue || "—"}</span>
                        <span className="text-zinc-600 mx-1">/</span>
                        <span className="text-zinc-400">{g.targetValue || "—"}</span>
                      </span>
                    )}
                    {g.deadline && (
                      <span className="text-zinc-500">📅 {g.deadline}</span>
                    )}
                  </div>
                )}
                {g.note && (
                  <div className="text-zinc-500 italic">{g.note}</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
