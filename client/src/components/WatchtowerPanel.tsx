/**
 * 常駐看守面板（缺口A）
 *
 * 列出本 workspace 的看守任務，支援：
 *  - 新增 / 編輯任務（name / cron / quietHours / dailyQuota / enabled）
 *  - 每個任務展開 logs 時間軸（decision 有色標 + reason + run_id 連結）
 *  - 手動「立即執行一次」（run-now）
 *
 * 設計對標 DelegationsPanel（卡片 / 色系 / 按鈕風格）。
 * API 走既有 api.watchtower*（workspace 透過 query string 傳遞）。
 */
import { useState, useCallback, useEffect } from "react";
import { api, type WatchtowerTask, type WatchtowerLog } from "../lib/api";
import { getActiveWorkspace } from "../lib/workspace";

// ─── Decision 色標 ────────────────────────────────────────────────────────────

const DECISION_CHIP: Record<string, string> = {
  act: "bg-emerald-700/40 text-emerald-300",
  skip: "bg-zinc-700/40 text-zinc-400",
  quiet: "bg-sky-700/40 text-sky-300",
  quota: "bg-amber-700/40 text-amber-300",
  overlap: "bg-violet-700/40 text-violet-300",
  disabled: "bg-zinc-700/40 text-zinc-400",
  error: "bg-rose-700/40 text-rose-300",
};

const DECISION_LABEL: Record<string, string> = {
  act: "執行",
  skip: "跳過",
  quiet: "靜音",
  quota: "配額滿",
  overlap: "重疊",
  disabled: "已停用",
  error: "錯誤",
};

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// ─── 空白表單預設值 ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  cron: "0 9 * * *",
  quietHours: "",
  dailyQuota: 3,
  enabled: true,
};

type FormState = typeof EMPTY_FORM;

// ─── 子元件：任務列 ───────────────────────────────────────────────────────────

function TaskRow({
  task,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
}: {
  task: WatchtowerTask;
  onEdit: (t: WatchtowerTask) => void;
  onDelete: (t: WatchtowerTask) => void;
  onToggle: (t: WatchtowerTask) => void;
  onRunNow: (t: WatchtowerTask) => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<WatchtowerLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [runResult, setRunResult] = useState<{ decision: string; reason?: string } | null>(null);
  const ws = getActiveWorkspace();

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { logs: l } = await api.watchtowerLogs(task.id, ws, 30);
      setLogs(l);
    } catch {
      // 靜默失敗
    } finally {
      setLogsLoading(false);
    }
  }, [task.id, ws]);

  const handleToggleLogs = () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) loadLogs();
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    setRunResult(null);
    try {
      const res = await api.watchtowerRunNow(task.id, ws, false);
      setRunResult(res);
      // 重新載入 logs
      if (showLogs) loadLogs();
      onRunNow(task);
    } catch (e: unknown) {
      setRunResult({ decision: "error", reason: e instanceof Error ? e.message : "未知錯誤" });
    } finally {
      setRunningNow(false);
    }
  };

  return (
    <div className="bg-panel border border-zinc-800 rounded-lg overflow-hidden">
      {/* 任務頭列 */}
      <div className="p-3 flex items-center gap-3">
        {/* 啟用開關 */}
        <button
          onClick={() => onToggle(task)}
          title={task.enabled ? "點擊停用" : "點擊啟用"}
          aria-label={task.enabled ? "停用" : "啟用"}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
            task.enabled ? "bg-emerald-600" : "bg-zinc-600"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              task.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{task.name}</span>
            <code className="text-[10px] bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400 font-mono">{task.cron}</code>
            {task.quietHours && (
              <span className="text-[10px] bg-sky-900/30 text-sky-400 px-1.5 py-0.5 rounded">
                靜音 {task.quietHours}
              </span>
            )}
            <span className="text-[10px] text-zinc-500">配額 {task.dailyQuota}/天</span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
            {task.lastFiredAt ? (
              <>
                <span>上次觸發 {relativeTime(task.lastFiredAt)}</span>
                {task.lastConclusion && (
                  <span className={`px-1 rounded ${DECISION_CHIP[task.lastConclusion] ?? "bg-zinc-700 text-zinc-300"}`}>
                    {DECISION_LABEL[task.lastConclusion] ?? task.lastConclusion}
                  </span>
                )}
              </>
            ) : (
              <span>尚未觸發</span>
            )}
          </div>
        </div>

        {/* 操作按鈕 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleRunNow}
            disabled={runningNow}
            aria-label="立即執行"
            className="text-xs px-2 py-1 bg-emerald-800/50 hover:bg-emerald-700/50 text-emerald-300 rounded disabled:opacity-40"
            title="立即執行一次"
          >
            {runningNow ? "執行中…" : "▶ 立即"}
          </button>
          <button
            onClick={handleToggleLogs}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
            title="看日誌"
          >
            {showLogs ? "收起" : "日誌"}
          </button>
          <button
            onClick={() => onEdit(task)}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
          >
            編輯
          </button>
          <button
            onClick={() => onDelete(task)}
            className="text-xs px-2 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white"
          >
            刪除
          </button>
        </div>
      </div>

      {/* run-now 結果 */}
      {runResult && (
        <div className={`px-3 py-1.5 text-xs border-t border-zinc-800 ${
          runResult.decision === "act" ? "bg-emerald-900/20 text-emerald-300" :
          runResult.decision === "error" ? "bg-rose-900/20 text-rose-300" :
          "bg-zinc-900/40 text-zinc-400"
        }`}>
          <span className={`inline-block px-1.5 rounded mr-2 ${DECISION_CHIP[runResult.decision] ?? "bg-zinc-700 text-zinc-300"}`}>
            {DECISION_LABEL[runResult.decision] ?? runResult.decision}
          </span>
          {runResult.reason}
        </div>
      )}

      {/* 日誌時間軸 */}
      {showLogs && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
          {logsLoading ? (
            <div className="text-xs text-zinc-500">載入日誌…</div>
          ) : logs.length === 0 ? (
            <div className="text-xs text-zinc-600">尚無日誌</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 text-[11px]">
                <span className="text-zinc-600 flex-shrink-0 w-24">
                  {new Date(log.firedAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
                <span className={`px-1.5 py-0.5 rounded flex-shrink-0 ${DECISION_CHIP[log.decision] ?? "bg-zinc-700 text-zinc-300"}`}>
                  {DECISION_LABEL[log.decision] ?? log.decision}
                </span>
                <span className="text-zinc-400 flex-1 min-w-0 truncate" title={log.reason}>{log.reason}</span>
                {log.runId && (
                  <span className="text-[10px] text-violet-400 flex-shrink-0 font-mono" title={`run: ${log.runId}`}>
                    #{log.runId.slice(0, 8)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export function WatchtowerPanel() {
  const [tasks, setTasks] = useState<WatchtowerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<WatchtowerTask | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ws = getActiveWorkspace();

  const reload = useCallback(() => {
    api.watchtowerTasks(ws)
      .then(({ tasks: t }) => { setTasks(t); setLoading(false); setError(null); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "載入失敗");
        setLoading(false);
      });
  }, [ws]);

  useEffect(() => { reload(); }, [reload]);

  const openCreate = () => {
    setEditingTask(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (t: WatchtowerTask) => {
    setEditingTask(t);
    setForm({
      name: t.name,
      cron: t.cron,
      quietHours: t.quietHours,
      dailyQuota: t.dailyQuota,
      enabled: t.enabled === 1,
    });
    setFormError(null);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingTask(null);
    setFormError(null);
  };

  const submitForm = async () => {
    if (!form.name.trim()) { setFormError("請輸入任務名稱"); return; }
    if (!form.cron.trim()) { setFormError("請輸入 cron 表達式"); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const body = {
        name: form.name.trim(),
        cron: form.cron.trim(),
        quietHours: form.quietHours.trim(),
        dailyQuota: Number(form.dailyQuota),
        enabled: form.enabled,
      };
      if (editingTask) {
        await api.updateWatchtowerTask(editingTask.id, ws, body);
      } else {
        await api.createWatchtowerTask(ws, body);
      }
      cancelForm();
      reload();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (t: WatchtowerTask) => {
    if (!confirm(`刪除看守任務「${t.name}」?`)) return;
    try {
      await api.deleteWatchtowerTask(t.id, ws);
      reload();
    } catch (e: unknown) {
      alert(`刪除失敗：${e instanceof Error ? e.message : "未知錯誤"}`);
    }
  };

  const handleToggle = async (t: WatchtowerTask) => {
    try {
      await api.updateWatchtowerTask(t.id, ws, { enabled: t.enabled !== 1 });
      reload();
    } catch {
      // 靜默失敗
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">🛰️ 常駐看守</h2>
          <p className="text-xs text-zinc-500 mt-1">
            設定週期性自動觸發的看守任務；每次觸發依靜音時段、每日配額、正在執行中等條件決定是否起 run。
          </p>
        </div>

        {/* 新增按鈕 */}
        {!showForm && (
          <button
            onClick={openCreate}
            className="mb-4 px-4 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm"
          >
            ＋ 新增看守任務
          </button>
        )}

        {/* 表單 */}
        {showForm && (
          <div className="mb-6 bg-panel border border-zinc-700 rounded-lg p-4 space-y-3">
            <div className="font-medium text-sm">{editingTask ? `編輯「${editingTask.name}」` : "新增看守任務"}</div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">任務名稱 *</label>
                <input
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
                  placeholder="例如：監控行銷目標"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Cron 表達式 *</label>
                <input
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                  placeholder="0 9 * * *"
                  value={form.cron}
                  onChange={(e) => setForm({ ...form, cron: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">靜音時段（可選，如 22-8）</label>
                <input
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                  placeholder="22-8"
                  value={form.quietHours}
                  onChange={(e) => setForm({ ...form, quietHours: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">每日配額（最多執行幾次）</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
                  value={form.dailyQuota}
                  onChange={(e) => setForm({ ...form, dailyQuota: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              啟用此任務
            </label>

            {formError && (
              <div className="text-xs text-rose-400 bg-rose-900/20 px-3 py-2 rounded">{formError}</div>
            )}

            <div className="flex gap-2">
              <button
                onClick={submitForm}
                disabled={submitting}
                className="px-4 py-2 rounded bg-accent hover:bg-violet-500 disabled:opacity-50 text-white text-sm"
              >
                {submitting ? "儲存中…" : editingTask ? "儲存修改" : "建立任務"}
              </button>
              <button
                onClick={cancelForm}
                className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 狀態 */}
        {loading && <div className="text-zinc-500 text-sm">載入中…</div>}
        {error && <div className="text-rose-400 text-sm bg-rose-900/20 px-3 py-2 rounded mb-4">{error}</div>}

        {/* 任務清單 */}
        {!loading && tasks.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">🛰️</div>
            <div className="text-sm">還沒有看守任務。點「新增」設定第一個週期觸發監控。</div>
          </div>
        )}

        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              onRunNow={() => { /* 觸發後讓 TaskRow 自行重載 log */ }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
