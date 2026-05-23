import { useEffect, useState, useCallback } from "react";
import { api, type AgentMeta, type CategoryMeta } from "../lib/api";

const MAX_CHARS = 4000;

// ─── Category memory section ──────────────────────────────────────────────────

function CategoryMemoryItem({ category }: { category: CategoryMeta }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/api/learning/category-memory/${encodeURIComponent(category.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const c = d.content || "";
        setContent(c);
        setSaved(c);
      })
      .catch(() => setError("載入失敗"))
      .finally(() => setLoading(false));
  }, [open, category.id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/learning/category-memory/${encodeURIComponent(category.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(content);
    } catch (e: any) {
      setError(e?.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== saved;
  const charCount = content.length;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-panel hover:bg-zinc-900 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{category.label}</span>
          <span className="text-xs text-zinc-500">({category.count} 個 agent)</span>
        </div>
        <div className="flex items-center gap-2">
          {saved.length > 0 && (
            <span className="text-xs text-emerald-400/70">{saved.length} 字</span>
          )}
          <span className="text-zinc-500 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 bg-zinc-950 space-y-3">
          {loading ? (
            <div className="text-xs text-zinc-500">載入中…</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                maxLength={MAX_CHARS + 200}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono resize-y focus:outline-none focus:border-violet-500 placeholder-zinc-600"
                placeholder="（尚無類層能力記憶）"
              />
              <div className="flex items-center justify-between">
                <span className={`text-xs ${charCount > MAX_CHARS ? "text-rose-400" : "text-zinc-500"}`}>
                  {charCount} / {MAX_CHARS} 字{charCount > MAX_CHARS ? "（超過建議上限）" : ""}
                </span>
                <div className="flex gap-2 items-center">
                  {error && <span className="text-xs text-rose-400">{error}</span>}
                  {isDirty && (
                    <button
                      onClick={() => setContent(saved)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
                    >
                      還原
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !isDirty}
                    className="text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium"
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Craft memory section ─────────────────────────────────────────────────────

function CraftMemoryItem({ agent }: { agent: AgentMeta }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/api/learning/craft/${encodeURIComponent(agent.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const c = d.content || "";
        setContent(c);
        setSaved(c);
      })
      .catch(() => setError("載入失敗"))
      .finally(() => setLoading(false));
  }, [open, agent.id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/learning/craft/${encodeURIComponent(agent.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(content);
    } catch (e: any) {
      setError(e?.message || "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const isDirty = content !== saved;
  const charCount = content.length;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-panel hover:bg-zinc-900 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{agent.name}</span>
          <span className="text-xs text-zinc-600">{agent.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {saved.length > 0 && (
            <span className="text-xs text-amber-400/70">{saved.length} 字</span>
          )}
          <span className="text-zinc-500 text-sm">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 bg-zinc-950 space-y-3">
          {loading ? (
            <div className="text-xs text-zinc-500">載入中…</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                maxLength={MAX_CHARS + 200}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono resize-y focus:outline-none focus:border-amber-500 placeholder-zinc-600"
                placeholder="（尚無手藝記憶）"
              />
              <div className="flex items-center justify-between">
                <span className={`text-xs ${charCount > MAX_CHARS ? "text-rose-400" : "text-zinc-500"}`}>
                  {charCount} / {MAX_CHARS} 字{charCount > MAX_CHARS ? "（超過建議上限）" : ""}
                </span>
                <div className="flex gap-2 items-center">
                  {error && <span className="text-xs text-rose-400">{error}</span>}
                  {isDirty && (
                    <button
                      onClick={() => setContent(saved)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400"
                    >
                      還原
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !isDirty}
                    className="text-xs px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white font-medium"
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type Tab = "category" | "craft";

export function MemoryEditor() {
  const [tab, setTab] = useState<Tab>("category");
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Agents with non-empty craft memory (loaded lazily to avoid N requests on load)
  const [craftAgents, setCraftAgents] = useState<AgentMeta[] | null>(null);
  const [craftLoading, setCraftLoading] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    api.agents()
      .then((d) => {
        setAgents(d.agents || []);
        setCategories(d.categories || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // When switching to craft tab, fetch all agents that have craft memory
  const loadCraftAgents = useCallback(async () => {
    if (craftAgents !== null || craftLoading) return;
    setCraftLoading(true);
    try {
      // Fetch craft memory for all agents in parallel, filter those with content
      const results = await Promise.all(
        agents.map((a) =>
          fetch(`/api/learning/craft/${encodeURIComponent(a.id)}`)
            .then((r) => r.json())
            .then((d) => ({ agent: a, hasContent: (d.content || "").trim().length > 0 }))
            .catch(() => ({ agent: a, hasContent: false }))
        )
      );
      setCraftAgents(results.filter((r) => r.hasContent).map((r) => r.agent));
    } finally {
      setCraftLoading(false);
    }
  }, [agents, craftAgents, craftLoading]);

  useEffect(() => {
    if (tab === "craft" && loaded && craftAgents === null) {
      loadCraftAgents();
    }
  }, [tab, loaded, craftAgents, loadCraftAgents]);

  const filteredCategories = categories.filter((c) =>
    !filterQuery || c.label.toLowerCase().includes(filterQuery.toLowerCase()) || c.id.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const filteredCraftAgents = (craftAgents || []).filter((a) =>
    !filterQuery || a.name.toLowerCase().includes(filterQuery.toLowerCase()) || a.id.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-5">
          <h2 className="text-xl font-semibold">✏️ 記憶編輯器</h2>
          <p className="text-xs text-zinc-500 mt-1">
            直接編輯類層能力記憶與 agent 手藝記憶。儲存後立即生效，下次對話時 agent 會讀到更新後的內容。
          </p>
        </div>

        {/* Warning */}
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3 mb-5 text-xs text-amber-300/80">
          <span className="font-medium">注意：</span>
          此介面直接覆蓋記憶內容（非追加），請謹慎操作。建議上限 {MAX_CHARS} 字，超過時 agent 注入效果可能下降。
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-5 bg-zinc-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => { setTab("category"); setFilterQuery(""); }}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === "category" ? "bg-violet-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            🌐 類層能力記憶
          </button>
          <button
            onClick={() => { setTab("craft"); setFilterQuery(""); }}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === "craft" ? "bg-amber-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            🛠️ Agent 手藝記憶
          </button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={tab === "category" ? "搜尋部門…" : "搜尋 agent…"}
          className="w-full mb-4 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500"
        />

        {!loaded && (
          <div className="text-zinc-500 text-sm text-center py-8">載入中…</div>
        )}

        {/* Category tab */}
        {loaded && tab === "category" && (
          <div className="space-y-2">
            {filteredCategories.length === 0 && (
              <div className="text-zinc-500 text-sm text-center py-8">沒有符合的部門</div>
            )}
            {filteredCategories.map((c) => (
              <CategoryMemoryItem key={c.id} category={c} />
            ))}
          </div>
        )}

        {/* Craft tab */}
        {loaded && tab === "craft" && (
          <div className="space-y-2">
            {craftLoading && (
              <div className="text-zinc-500 text-sm text-center py-8">正在掃描手藝記憶…</div>
            )}
            {!craftLoading && craftAgents !== null && filteredCraftAgents.length === 0 && (
              <div className="text-zinc-500 text-sm text-center py-8">
                {filterQuery ? "沒有符合的 agent" : "目前沒有任何 agent 有手藝記憶。審核學習提案後會在這裡出現。"}
              </div>
            )}
            {!craftLoading && filteredCraftAgents.map((a) => (
              <CraftMemoryItem key={a.id} agent={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
