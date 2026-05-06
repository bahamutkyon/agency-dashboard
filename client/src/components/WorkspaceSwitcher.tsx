import { useEffect, useState } from "react";
import { api, type Workspace, type MCPServerInfo } from "../lib/api";
import { getActiveWorkspace, setActiveWorkspace } from "../lib/workspace";
import { MEMO_TEMPLATES } from "../lib/memoTemplates";

interface Props {
  onSwitched: () => void;
  onOpenOnboarding?: (sessionId: string, draftWorkspaceId?: string) => void;
  hasActiveTabs?: boolean; // if true, switching workspace will close them
}

export function WorkspaceSwitcher({ onSwitched, onOpenOnboarding, hasActiveTabs }: Props) {
  const [list, setList] = useState<Workspace[]>([]);
  const [active, setActive] = useState<string>(getActiveWorkspace());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", standingContext: "", memory: "", enabledMcps: [] as string[] });
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);

  useEffect(() => {
    api.mcpServers().then(setMcpServers).catch(() => {});
  }, []);

  const reload = () => api.workspaces().then(setList).catch(() => {});
  useEffect(() => { reload(); }, []);

  const switchTo = (id: string) => {
    if (id === active) { setOpen(false); return; }
    if (hasActiveTabs && !confirm("切換工作區會關掉目前所有對話 tab(對話內容仍保留在歷史紀錄)。要切換嗎?")) {
      return;
    }
    setActive(id);
    setActiveWorkspace(id);
    setOpen(false);
    onSwitched();
  };

  const startNew = () => {
    setEditingId("new");
    setDraft({ name: "", description: "", standingContext: "", memory: "", enabledMcps: [] });
  };

  const startEdit = (w: Workspace) => {
    setEditingId(w.id);
    setDraft({
      name: w.name, description: w.description,
      standingContext: w.standingContext, memory: w.memory || "",
      enabledMcps: w.enabledMcps || [],
    });
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    if (editingId === "new") {
      const w = await api.createWorkspace(draft);
      setEditingId(null);
      reload();
      switchTo(w.id);
    } else if (editingId) {
      await api.updateWorkspace(editingId, draft);
      setEditingId(null);
      reload();
    }
  };

  const remove = async (w: Workspace) => {
    if (w.id === "default") {
      alert("預設工作區無法刪除");
      return;
    }
    if (!confirm(`刪除「${w.name}」?所有屬於這個工作區的對話、筆記、模板、排程都會一併消失`)) return;
    await api.deleteWorkspace(w.id);
    if (active === w.id) switchTo("default");
    else reload();
  };

  const activeW = list.find((w) => w.id === active);

  return (
    <div className="relative" data-tour="workspace-switcher">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 md:px-3 py-1 rounded text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 max-w-[40vw] md:max-w-none"
        title={`切換工作區 — 目前:${activeW?.name || "預設工作區"}`}
      >
        <span className="text-zinc-500 hidden sm:inline">工作區:</span>
        <span className="sm:hidden">🗂</span>
        <span className="font-medium truncate">{activeW?.name || "預設"}</span>
        <span className="text-zinc-500 flex-shrink-0">▼</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-96 bg-panel border border-zinc-700 rounded-lg shadow-lg z-30 max-h-[80vh] overflow-y-auto">
          {editingId ? (
            <div className="p-4 space-y-3">
              <div className="text-sm font-medium">
                {editingId === "new" ? "新增工作區" : "編輯工作區"}
              </div>
              <input
                className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
                placeholder="名稱(例如:外勞仲介 / 個人IP AI 自媒體)"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoFocus
              />
              <input
                className="w-full bg-zinc-900 px-3 py-2 rounded text-sm"
                placeholder="簡短描述(可選)"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <div>
                <label className="text-xs text-zinc-400 flex items-center justify-between">
                  <span>📝 專案備忘錄 — 自動注入給所有 agent 對話</span>
                </label>

                <div className="flex gap-2 mt-1 mb-2">
                  <select
                    className="flex-1 bg-zinc-900 px-2 py-1.5 rounded text-xs"
                    onChange={(e) => {
                      const t = MEMO_TEMPLATES.find((x) => x.id === e.target.value);
                      if (t) setDraft({ ...draft, standingContext: t.body });
                      e.target.value = ""; // reset so user can pick again
                    }}
                    defaultValue=""
                  >
                    <option value="">📋 從範本快速填入…</option>
                    {MEMO_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      // launch onboarding chat — pass the workspace id if we are
                      // editing an existing one; if new, save first then onboard
                      let wsId: string;
                      if (editingId === "new") {
                        if (!draft.name.trim()) {
                          alert("請先填工作區名稱");
                          return;
                        }
                        const w = await api.createWorkspace(draft);
                        wsId = w.id;
                        setEditingId(null);
                        reload();
                        switchTo(w.id);
                      } else {
                        wsId = editingId as string;
                        // save current draft first
                        await api.updateWorkspace(wsId, draft);
                        reload();
                      }
                      const { id: sessionId } = await api.startOnboarding();
                      setOpen(false);
                      onOpenOnboarding?.(sessionId, wsId);
                    }}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs whitespace-nowrap"
                    title="讓 AI 訪問你 5 分鐘,自動產出備忘錄"
                  >
                    🤖 AI 訪問我
                  </button>
                </div>

                <textarea
                  className="w-full bg-zinc-900 px-3 py-2 rounded text-sm font-mono"
                  rows={10}
                  placeholder={`三種填法:
1. 上方下拉「從範本」→ 改細節
2. 點「🤖 AI 訪問我」→ 對話 5 分鐘,結果一鍵套用回這裡
3. 直接自己寫`}
                  value={draft.standingContext}
                  onChange={(e) => setDraft({ ...draft, standingContext: e.target.value })}
                />
              </div>

              {editingId !== "new" && (
                <div>
                  <label className="text-xs text-zinc-400 flex items-center justify-between">
                    <span>🧠 累積記憶 — agent 自動寫入,你也可編輯/清空</span>
                    <span className="text-[10px] text-zinc-600">{draft.memory.length} / 10000 字</span>
                  </label>
                  <textarea
                    className="w-full mt-1 bg-zinc-900 px-3 py-2 rounded text-xs font-mono text-zinc-300"
                    rows={6}
                    placeholder="(目前無記憶 — 跟 agent 對話時,它會主動把重要事實寫進這裡,讓未來對話自動帶入)"
                    value={draft.memory}
                    onChange={(e) => setDraft({ ...draft, memory: e.target.value })}
                  />
                </div>
              )}

              {mcpServers.length > 0 && (
                <div>
                  <label className="text-xs text-zinc-400">🔌 此工作區啟用的 MCP server</label>
                  <div className="mt-1 space-y-1">
                    {mcpServers.map((srv) => (
                      <label key={srv.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-zinc-900 px-2 py-1 rounded">
                        <input
                          type="checkbox"
                          checked={draft.enabledMcps.includes(srv.name)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...draft.enabledMcps, srv.name]
                              : draft.enabledMcps.filter((n) => n !== srv.name);
                            setDraft({ ...draft, enabledMcps: next });
                          }}
                        />
                        <span className="font-mono text-zinc-300">{srv.name}</span>
                        <span className="text-[10px] text-zinc-600">
                          {srv.type}{srv.hasAuth ? " · 需 auth" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={save}
                  className="flex-1 px-3 py-2 rounded bg-accent hover:bg-violet-500 text-white text-sm">
                  {editingId === "new" ? "建立並切換" : "儲存"}
                </button>
                <button onClick={() => setEditingId(null)}
                  className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-800 px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">{list.length} 個工作區</span>
                <div className="flex gap-1">
                  <label
                    className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 cursor-pointer"
                    title="從 JSON 檔匯入工作區"
                  >
                    匯入
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const text = await f.text();
                          const bundle = JSON.parse(text);
                          const r = await api.importWorkspace(bundle);
                          alert(`匯入成功:${r.imported.notes} 筆筆記 / ${r.imported.templates} 個模板 / ${r.imported.schedules} 個排程(已暫停,需手動啟用)`);
                          reload();
                          switchTo(r.workspaceId);
                        } catch (err: any) {
                          alert("匯入失敗:" + err.message);
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <button onClick={startNew}
                    className="text-xs px-2 py-1 bg-accent hover:bg-violet-500 rounded text-white">
                    + 新增
                  </button>
                </div>
              </div>
              {list.map((w) => (
                <div
                  key={w.id}
                  className={`group p-3 border-b border-zinc-800 last:border-0 hover:bg-zinc-900/50 ${
                    w.id === active ? "bg-zinc-900/30" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div onClick={() => switchTo(w.id)} className="flex-1 cursor-pointer min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{w.name}</span>
                        {w.id === active && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-600 text-white rounded">使用中</span>
                        )}
                      </div>
                      {w.description && <div className="text-xs text-zinc-500 mt-0.5">{w.description}</div>}
                      {w.standingContext && (
                        <div className="text-xs text-zinc-500 mt-1 line-clamp-2 italic">
                          📝 {w.standingContext.slice(0, 100)}{w.standingContext.length > 100 ? "…" : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 opacity-50 group-hover:opacity-100 transition">
                      <button onClick={() => startEdit(w)}
                        className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded">編輯</button>
                      <a href={api.exportWorkspaceUrl(w.id)} download
                        className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-center"
                        title="匯出設定為 JSON(可分享或備份)">匯出</a>
                      {w.id !== "default" && (
                        <button onClick={() => remove(w)}
                          className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-rose-700 rounded">刪除</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
