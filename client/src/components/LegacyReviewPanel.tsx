/**
 * Legacy 重審面板：列出所有 scope='legacy-global' 的 craft / category 條目。
 *
 * 每個條目三個動作：
 *   1. 保留為全域（升級為 scope='global'，跨工作區共享）
 *   2. 鎖到某工作區（轉成 scope='workspace', workspaceId=X）
 *   3. 刪除（不再注入）
 *
 * 這些條目是 v2 schema migration 從舊的「全 agent 共用一塊 content」搬過來的，
 * 預設仍當全域注入但加 ⚠️ 警告。重審後即從 legacy 槽位移除。
 */
import { useEffect, useState } from "react";
import { api, type LegacyMemoryEntry, type Workspace, type AgentMeta, type CategoryMeta } from "../lib/api";

type Tab = "craft" | "category";

function ScopeChip({ scope }: { scope: string }) {
  const colors: Record<string, string> = {
    "legacy-global": "bg-amber-950/60 text-amber-300 border-amber-700/50",
    "global": "bg-violet-950/60 text-violet-300 border-violet-700/50",
    "workspace": "bg-cyan-950/60 text-cyan-300 border-cyan-700/50",
  };
  const labels: Record<string, string> = {
    "legacy-global": "⚠️ 待重審",
    "global": "🌐 全域",
    "workspace": "📦 工作區",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[scope] || "bg-zinc-800 text-zinc-400"}`}>
      {labels[scope] || scope}
    </span>
  );
}

function LegacyEntry({
  entry,
  itemKey,
  itemLabel,
  workspaces,
  onPromote,
  onDelete,
}: {
  entry: LegacyMemoryEntry;
  itemKey: string;
  itemLabel: string;
  workspaces: Workspace[];
  onPromote: (toScope: "global" | "workspace", toWorkspaceId?: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedWs, setSelectedWs] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const run = async (action: () => Promise<any>) => {
    setBusy(true);
    try {
      await action();
      setHidden(true);
    } catch (e: any) {
      alert(`操作失敗：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const promoteToGlobal = () => run(() => onPromote("global"));
  const promoteToWorkspace = () => {
    if (!selectedWs) {
      alert("請先選擇要鎖到哪個工作區");
      return;
    }
    return run(() => onPromote("workspace", selectedWs));
  };
  const doDelete = () => run(onDelete);

  return (
    <div className="border border-amber-900/40 bg-amber-950/10 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ScopeChip scope="legacy-global" />
          <span className="text-sm font-medium truncate">{itemLabel}</span>
          <span className="text-xs text-zinc-500 truncate">{itemKey}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-zinc-500">{entry.content.length} 字</span>
          <span className="text-zinc-500 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 bg-zinc-950 space-y-3">
          {/* 內容預覽 */}
          <div className="text-xs whitespace-pre-wrap break-words bg-zinc-900 border border-zinc-800 rounded p-3 max-h-60 overflow-y-auto font-mono text-zinc-300">
            {entry.content}
          </div>

          {/* 動作區 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800">
            <button
              disabled={busy}
              onClick={promoteToGlobal}
              className="text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 rounded text-white font-medium"
            >
              🌐 保留為全域
            </button>

            <div className="flex items-center gap-1">
              <select
                disabled={busy}
                value={selectedWs}
                onChange={(e) => setSelectedWs(e.target.value)}
                className="text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="">選工作區…</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <button
                disabled={busy || !selectedWs}
                onClick={promoteToWorkspace}
                className="text-xs px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 rounded text-white font-medium"
              >
                📦 鎖到此工作區
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-xs text-rose-400">確定刪除？</span>
                  <button
                    disabled={busy}
                    onClick={doDelete}
                    className="text-xs px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-50 rounded text-white font-medium"
                  >
                    確定
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs px-2 py-1.5 text-zinc-500 hover:text-zinc-300"
                  >
                    取消
                  </button>
                </>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-rose-800 disabled:opacity-50 rounded text-zinc-400 hover:text-white"
                >
                  🗑️ 刪除
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LegacyReviewPanel() {
  const [tab, setTab] = useState<Tab>("craft");
  const [craftEntries, setCraftEntries] = useState<LegacyMemoryEntry[] | null>(null);
  const [catEntries, setCatEntries] = useState<LegacyMemoryEntry[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [filterQuery, setFilterQuery] = useState("");

  const reload = () => {
    api.legacyCraft().then(setCraftEntries).catch(() => setCraftEntries([]));
    api.legacyCategory().then(setCatEntries).catch(() => setCatEntries([]));
  };

  useEffect(() => {
    reload();
    api.agents().then((d) => {
      setAgents(d.agents || []);
      setCategories(d.categories || []);
    }).catch(() => {});
    api.workspaces().then(setWorkspaces).catch(() => setWorkspaces([]));
  }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;
  const categoryLabel = (id: string) => categories.find((c) => c.id === id)?.label || id;

  const filteredCraft = (craftEntries || []).filter((e) => {
    if (!filterQuery) return true;
    const aid = e.agentId || "";
    const name = agentName(aid).toLowerCase();
    const q = filterQuery.toLowerCase();
    return aid.toLowerCase().includes(q) || name.includes(q) || e.content.toLowerCase().includes(q);
  });
  const filteredCat = (catEntries || []).filter((e) => {
    if (!filterQuery) return true;
    const cid = e.category || "";
    const label = categoryLabel(cid).toLowerCase();
    const q = filterQuery.toLowerCase();
    return cid.toLowerCase().includes(q) || label.includes(q) || e.content.toLowerCase().includes(q);
  });

  const craftCount = craftEntries?.length ?? 0;
  const catCount = catEntries?.length ?? 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-xl font-semibold">⚠️ Legacy 記憶重審</h2>
          <p className="text-xs text-zinc-500 mt-1">
            v2 schema 遷移前累積的全域記憶（craft / category）。這些目前仍會跨工作區注入，但**強烈建議**逐條重審，
            把真正通用的方法論留為全域、把具體專案/客戶相關的鎖到對應工作區、把過時的刪除。
          </p>
        </div>

        {/* Tab switcher + counts */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
            <button
              onClick={() => { setTab("craft"); setFilterQuery(""); }}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === "craft" ? "bg-amber-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              🛠️ 個人手藝 ({craftCount})
            </button>
            <button
              onClick={() => { setTab("category"); setFilterQuery(""); }}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === "category" ? "bg-amber-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              🎯 類能力 ({catCount})
            </button>
          </div>
          {(craftCount === 0 && catCount === 0) && craftEntries !== null && catEntries !== null && (
            <span className="text-xs text-emerald-400/70">✅ 已全部重審完畢</span>
          )}
        </div>

        {/* Search */}
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="搜尋 agent / 內容…"
          className="w-full mb-4 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
        />

        {/* List */}
        {tab === "craft" && (
          <div className="space-y-2">
            {craftEntries === null && (
              <div className="text-zinc-500 text-sm text-center py-8">載入中…</div>
            )}
            {craftEntries !== null && filteredCraft.length === 0 && (
              <div className="text-zinc-500 text-sm text-center py-8">
                {filterQuery ? "沒有符合的條目" : "✅ 沒有 craft 等待重審"}
              </div>
            )}
            {filteredCraft.map((e) => (
              <LegacyEntry
                key={e.agentId}
                entry={e}
                itemKey={e.agentId!}
                itemLabel={agentName(e.agentId!)}
                workspaces={workspaces}
                onPromote={async (toScope, toWorkspaceId) => {
                  await api.promoteLegacyCraft(e.agentId!, toScope, toWorkspaceId);
                }}
                onDelete={async () => {
                  await api.deleteLegacyCraft(e.agentId!);
                }}
              />
            ))}
          </div>
        )}

        {tab === "category" && (
          <div className="space-y-2">
            {catEntries === null && (
              <div className="text-zinc-500 text-sm text-center py-8">載入中…</div>
            )}
            {catEntries !== null && filteredCat.length === 0 && (
              <div className="text-zinc-500 text-sm text-center py-8">
                {filterQuery ? "沒有符合的條目" : "✅ 沒有 category 等待重審"}
              </div>
            )}
            {filteredCat.map((e) => (
              <LegacyEntry
                key={e.category}
                entry={e}
                itemKey={e.category!}
                itemLabel={categoryLabel(e.category!)}
                workspaces={workspaces}
                onPromote={async (toScope, toWorkspaceId) => {
                  await api.promoteLegacyCategory(e.category!, toScope, toWorkspaceId);
                }}
                onDelete={async () => {
                  await api.deleteLegacyCategory(e.category!);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
