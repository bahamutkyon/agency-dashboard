import { memo, useMemo, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import type { AgentMeta, CategoryMeta } from "../lib/api";

interface Props {
  agents: AgentMeta[];
  categories: CategoryMeta[];
  liveAgentIds: Set<string>;
  /** agentId → past session count in current workspace; renders 「💬 N」badge */
  sessionCounts?: Record<string, number>;
  onPick: (agent: AgentMeta, provider?: "claude" | "codex" | "gemini") => void;
  onAskOrchestrator: () => void;
  onOpenCockpit: () => void;
  onOpenSchedules: () => void;
  onOpenHistory: () => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
  onOpenBatch: () => void;
  onOpenNotes: () => void;
  onOpenLearning: () => void;
  onOpenCapabilityLearning: () => void;
  onOpenAutonomousStudy: () => void;
  onOpenMemoryEditor: () => void;
  onOpenLegacyReview: () => void;
  onOpenWorkflows: () => void;
  onOpenActivity: () => void;
  onOpenDelegations: () => void;
  onOpenGoals: () => void;
  onOpenOutcomes: () => void;
  providersAvail?: { claude: boolean; codex: boolean; gemini: boolean };
}

// ── Row props passed through react-window v2 rowProps ────────────────────────
interface AgentRowData {
  filtered: AgentMeta[];
  liveAgentIds: Set<string>;
  sessionCounts?: Record<string, number>;
  onPick: (agent: AgentMeta, provider?: "claude" | "codex" | "gemini") => void;
  providersAvail?: { claude: boolean; codex: boolean; gemini: boolean };
}

/** Fixed pixel height of each agent row.
 *  name line ≈ 20px + description (2 lines, line-clamp-2) ≈ 32px
 *  + py-2 top+bottom padding ≈ 16px + border 1px = ~69px → 76px for breathing room */
const ROW_HEIGHT = 76;

// react-window v2 row component: receives { ariaAttributes, index, style, ...rowProps }
type AgentRowProps = RowComponentProps<AgentRowData>;

function AgentRow({ ariaAttributes, index, style, filtered, liveAgentIds, sessionCounts, onPick, providersAvail }: AgentRowProps) {
  const a = filtered[index];
  if (!a) return null;
  const live = liveAgentIds.has(a.id);
  return (
    <div style={style} {...ariaAttributes}>
      <div className="border-b border-zinc-900 hover:bg-zinc-900 group relative h-full">
        <button
          onClick={() => onPick(a)}
          className="w-full h-full text-left px-3 py-2 pr-12"
          title="點擊用智慧路由(預設 Claude,自動判斷時切 Codex)"
        >
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                live ? "bg-emerald-400" : "bg-zinc-700"
              }`}
            />
            <span className="text-sm font-medium flex-1 truncate">{a.name}</span>
            {sessionCounts && sessionCounts[a.id] > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono flex-shrink-0"
                title={`已有 ${sessionCounts[a.id]} 場會議`}
              >
                💬 {sessionCounts[a.id]}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
            {a.description}
          </div>
        </button>
        {(providersAvail?.codex || providersAvail?.gemini) && (
          <div className="absolute top-2 right-2 hidden group-hover:flex flex-col gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onPick(a, "claude"); }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-violet-900/80 hover:bg-violet-800 text-violet-100 font-mono"
              title="強制用 Claude"
            >🧠</button>
            {providersAvail?.codex && (
              <button
                onClick={(e) => { e.stopPropagation(); onPick(a, "codex"); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 font-mono"
                title="強制用 Codex"
              >🤖</button>
            )}
            {providersAvail?.gemini && (
              <button
                onClick={(e) => { e.stopPropagation(); onPick(a, "gemini"); }}
                className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/80 hover:bg-sky-800 text-sky-100 font-mono"
                title="強制用 Gemini"
              >✨</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible group helpers ─────────────────────────────────────────────────
const STORAGE_KEY = "sidebar_groups";
type GroupId = "經營" | "對話" | "學習/研究" | "系統";

function loadGroupState(): Record<GroupId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { "經營": true, "對話": false, "學習/研究": false, "系統": false, ...JSON.parse(raw) };
  } catch {}
  return { "經營": true, "對話": false, "學習/研究": false, "系統": false };
}

function saveGroupState(state: Record<GroupId, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

const BTN = "px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5";

function AgentSidebarInner({
  agents, categories, liveAgentIds, sessionCounts,
  onPick, onAskOrchestrator, onOpenCockpit, onOpenSchedules,
  onOpenHistory, onOpenTemplates, onOpenSettings,
  onOpenBatch, onOpenNotes, onOpenLearning, onOpenCapabilityLearning, onOpenAutonomousStudy, onOpenMemoryEditor, onOpenLegacyReview, onOpenWorkflows, onOpenActivity, onOpenDelegations, onOpenGoals, onOpenOutcomes,
  providersAvail,
}: Props) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [groups, setGroups] = useState<Record<GroupId, boolean>>(loadGroupState);
  const [showFilters, setShowFilters] = useState(false);

  function toggleGroup(g: GroupId) {
    setGroups((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      saveGroupState(next);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (cat && a.category !== cat) return false;
      if (!q) return true;
      return (
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    });
  }, [agents, cat, query]);

  // Stable rowProps object so List doesn't re-render rows unnecessarily
  const rowProps = useMemo<AgentRowData>(
    () => ({ filtered, liveAgentIds, sessionCounts, onPick, providersAvail }),
    [filtered, liveAgentIds, sessionCounts, onPick, providersAvail]
  );

  return (
    <aside className="w-[85vw] max-w-96 md:w-96 h-full bg-panel border-r border-zinc-800 flex flex-col pt-[env(safe-area-inset-top)]">
      <div className="m-3 space-y-2">
        <button
          data-tour="orchestrator-btn"
          onClick={onAskOrchestrator}
          className="w-full px-3 py-2 rounded bg-gradient-to-r from-accent to-violet-500 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          title="不知道要找誰?讓專案經理幫你規劃團隊"
        >
          <span>👨‍💼</span>
          <span>找專案經理討論</span>
        </button>

        <div className="space-y-2">
          {/* 經營 group */}
          <button
            onClick={() => toggleGroup("經營")}
            className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center justify-between font-medium"
            data-testid="group-header-經營"
          >
            <span>經營</span>
            <span>{groups["經營"] ? "▾" : "▸"}</span>
          </button>
          {groups["經營"] && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <button onClick={onOpenGoals} className={BTN} title="目標帳本"><span>🎯</span><span>目標</span></button>
              <button onClick={onOpenOutcomes} className={BTN} title="成效回訪"><span>📈</span><span>成效</span></button>
              <button onClick={onOpenDelegations} className={BTN} title="在途交辦進度"><span>🚀</span><span>在途</span></button>
              <button onClick={onOpenCockpit} className={BTN} title="今日總管簡報"><span>🧭</span><span>駕駛艙</span></button>
            </div>
          )}

          {/* 對話 group */}
          <button
            onClick={() => toggleGroup("對話")}
            className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center justify-between font-medium"
            data-testid="group-header-對話"
          >
            <span>對話</span>
            <span>{groups["對話"] ? "▾" : "▸"}</span>
          </button>
          {groups["對話"] && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <button onClick={onOpenHistory} className={BTN} title="所有過往對話"><span>📚</span><span>歷史</span></button>
              <button data-tour="batch-btn" onClick={onOpenBatch} className={BTN} title="多位 agent 同時做同一題"><span>🎯</span><span>批次同題</span></button>
              <button onClick={onOpenActivity} className={BTN} title="活動時間軸總覽"><span>📡</span><span>活動</span></button>
            </div>
          )}

          {/* 學習/研究 group */}
          <button
            onClick={() => toggleGroup("學習/研究")}
            className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center justify-between font-medium"
            data-testid="group-header-學習/研究"
          >
            <span>學習/研究</span>
            <span>{groups["學習/研究"] ? "▾" : "▸"}</span>
          </button>
          {groups["學習/研究"] && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <button onClick={onOpenNotes} className={BTN} title="共享筆記/知識庫"><span>📒</span><span>筆記</span></button>
              <button onClick={onOpenLearning} className={BTN} title="學習審核佇列"><span>🧠</span><span>學習</span></button>
              <button onClick={onOpenCapabilityLearning} className={BTN} title="能力學習進程"><span>🎓</span><span>能力學習</span></button>
              <button onClick={onOpenAutonomousStudy} className={BTN} title="常用 agent 定期自主上網研究領域最新做法"><span>📡</span><span>自主進修</span></button>
              <button onClick={onOpenMemoryEditor} className={BTN} title="直接編輯類層 / 手藝記憶"><span>✏️</span><span>記憶編輯</span></button>
              <button onClick={onOpenLegacyReview} className="px-2 py-2 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5 border border-amber-800/40" title="重審 v2 遷移前累積的全域記憶（legacy-global）"><span>⚠️</span><span>Legacy 重審</span></button>
            </div>
          )}

          {/* 系統 group */}
          <button
            onClick={() => toggleGroup("系統")}
            className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs flex items-center justify-between font-medium"
            data-testid="group-header-系統"
          >
            <span>系統</span>
            <span>{groups["系統"] ? "▾" : "▸"}</span>
          </button>
          {groups["系統"] && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <button onClick={onOpenSettings} className={BTN} title="主題、字體、通知設定"><span>⚙️</span><span>設定</span></button>
              <button data-tour="workflow-btn" onClick={onOpenWorkflows} className={BTN} title="多位 agent 順序接力跑完一個流程"><span>🔗</span><span>自動接力</span></button>
              <button onClick={onOpenSchedules} className={BTN} title="設定週期任務"><span>⏰</span><span>排程</span></button>
              <button onClick={onOpenTemplates} className={BTN} title="常用 prompt 模板"><span>📋</span><span>模板</span></button>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 border-b border-zinc-800" data-tour="agent-search">
        <input
          className="w-full bg-zinc-900 px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="搜尋 agent…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="px-2 py-2 border-b border-zinc-800">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs flex items-center justify-between"
        >
          <span>
            🔖 {cat ? `篩選：${categories.find((c) => c.id === cat)?.label ?? cat}` : "篩選部門"}
          </span>
          <span className="flex items-center gap-2">
            {cat && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setCat(null); }}
                className="text-zinc-500 hover:text-zinc-200"
                title="清除篩選"
              >✕</span>
            )}
            <span>{showFilters ? "▾" : "▸"}</span>
          </span>
        </button>
        {showFilters && (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              onClick={() => setCat(null)}
              className={`text-xs px-2 py-1 rounded ${cat === null ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
            >
              全部 ({agents.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`text-xs px-2 py-1 rounded ${cat === c.id ? "bg-accent text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              >
                {c.label} ({c.count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Virtualised agent list — react-window v2 List fills remaining flex space */}
      <div className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <div className="text-zinc-500 text-sm p-4 text-center">沒有符合的 agent</div>
        ) : (
          <List
            rowComponent={AgentRow}
            rowProps={rowProps}
            rowCount={filtered.length}
            rowHeight={ROW_HEIGHT}
            overscanCount={5}
            style={{ flexGrow: 1, maxHeight: "100%", overflowY: "auto" }}
            className="h-full"
          />
        )}
      </div>
    </aside>
  );
}

export const AgentSidebar = memo(AgentSidebarInner);
