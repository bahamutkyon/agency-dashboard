import { useState, useCallback, useEffect } from "react";
import { getActiveWorkspace } from "../lib/workspace";
import { api, type OutcomeCheck } from "../lib/api";
import { useVisiblePolling } from "../hooks/useVisiblePolling";

function fmtDue(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

export function OutcomesPanel() {
  const [open, setOpen] = useState<OutcomeCheck[]>([]);
  const [done, setDone] = useState<OutcomeCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // 新增表單
  const [showCreate, setShowCreate] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newDays, setNewDays] = useState("7");
  const [creating, setCreating] = useState(false);

  // 填結果
  const [fillingId, setFillingId] = useState<string | null>(null);
  const [fillText, setFillText] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    const ws = getActiveWorkspace();
    Promise.all([
      api.outcomes({ workspace: ws ?? undefined, status: "pending" }),
      api.outcomes({ workspace: ws ?? undefined, status: "notified" }),
      api.outcomes({ workspace: ws ?? undefined, status: "done" }),
    ])
      .then(([pending, notified, doneList]) => {
        setOpen([...notified, ...pending]); // notified（已提醒）排前面
        setDone(doneList.slice(0, 10));
        setLoading(false);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "載入失敗");
        setLoading(false);
      });
  }, []);

  useVisiblePolling(reload, 10000);
  useEffect(() => { reload(); }, [reload]);

  const handleCreate = useCallback(async () => {
    const ws = getActiveWorkspace();
    if (!ws || !newDesc.trim()) return;
    setCreating(true);
    try {
      const days = Number.parseFloat(newDays);
      await api.createOutcome(ws, {
        description: newDesc.trim(),
        dueInDays: Number.isFinite(days) && days > 0 ? days : 7,
      });
      setNewDesc("");
      setNewDays("7");
      setShowCreate(false);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setCreating(false);
    }
  }, [newDesc, newDays, reload]);

  const handleFill = useCallback(async (id: string) => {
    const ws = getActiveWorkspace();
    if (!ws || !fillText.trim()) return;
    setSaving(true);
    try {
      await api.recordOutcomeResult(id, ws, fillText.trim());
      setFillingId(null);
      setFillText("");
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "送出失敗");
    } finally {
      setSaving(false);
    }
  }, [fillText, reload]);

  const handleCancel = useCallback(async (id: string) => {
    const ws = getActiveWorkspace();
    if (!ws) return;
    setBusyId(id);
    try {
      await api.cancelOutcome(id, ws);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "取消失敗");
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">📈 成效回訪</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowCreate((v) => !v); setNewDesc(""); setNewDays("7"); }}
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

        {showCreate && (
          <div className="border border-zinc-700 rounded p-3 space-y-2 bg-zinc-900">
            <div className="text-xs font-medium text-zinc-300 mb-1">新增回訪</div>
            <input
              placeholder="要查什麼（如：露天 Hairball 那檔有沒有詢問/成交）"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">幾天後回訪</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={newDays}
                onChange={(e) => setNewDays(e.target.value)}
                className="w-20 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              />
              <div className="flex-1" />
              <button
                disabled={creating || !newDesc.trim()}
                onClick={handleCreate}
                className="text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-200 px-3 py-1 rounded disabled:opacity-40"
              >
                {creating ? "建立中…" : "建立"}
              </button>
            </div>
          </div>
        )}

        {loading && <div className="text-zinc-500 text-sm">載入中…</div>}
        {!loading && open.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-8">
            沒有待回訪的項目。對外發布/上架後可在此掛回訪追現實結果。
          </div>
        )}

        {open.map((o) => (
          <div key={o.id} className="border border-zinc-800 rounded p-3 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <span className="text-zinc-200">{o.description}</span>
                {o.status === "notified" && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-300">待你填結果</span>
                )}
              </div>
              <span className="text-zinc-500 flex-shrink-0">📅 {fmtDue(o.dueAt)}</span>
            </div>

            {fillingId === o.id ? (
              <div className="space-y-2">
                <textarea
                  placeholder="填現實結果（如：詢問 5 次、成交 1 台）"
                  value={fillText}
                  onChange={(e) => setFillText(e.target.value)}
                  rows={2}
                  className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setFillingId(null); setFillText(""); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
                  >
                    取消
                  </button>
                  <button
                    disabled={saving || !fillText.trim()}
                    onClick={() => handleFill(o.id)}
                    className="text-xs bg-sky-800 hover:bg-sky-700 text-sky-200 px-3 py-1 rounded disabled:opacity-40"
                  >
                    {saving ? "送出中…" : "送出結果"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button
                  disabled={busyId === o.id}
                  onClick={() => handleCancel(o.id)}
                  className="text-xs text-zinc-500 hover:text-rose-400 px-2 py-1 disabled:opacity-40"
                >
                  取消回訪
                </button>
                <button
                  onClick={() => { setFillingId(o.id); setFillText(""); }}
                  className="text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-200 px-3 py-1 rounded"
                >
                  填結果
                </button>
              </div>
            )}
          </div>
        ))}

        {/* 折疊近 10 筆 done */}
        {done.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              {showDone ? "▾" : "▸"} 已回填的成效（{done.length}）
            </button>
            {showDone && (
              <div className="mt-2 space-y-2">
                {done.map((o) => (
                  <div key={o.id} className="border border-zinc-800/60 rounded p-2 text-xs">
                    <div className="text-zinc-400">{o.description}</div>
                    <div className="text-zinc-200 mt-0.5">→ {o.result}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
