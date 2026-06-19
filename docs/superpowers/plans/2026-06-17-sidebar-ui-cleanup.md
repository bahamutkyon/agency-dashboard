# 側欄 UI 整理 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 整理 `AgentSidebar` 視覺：CTA 分主次、11 功能鈕分常用/進階、19 分類 chip 收摺。

**架構：** 純前端、單一元件。新增兩個本地摺疊狀態（showAdvanced / showFilters），重排現有按鈕與 chip 的呈現。不動 agent 清單、搜尋、虛擬化、props 介面。

**技術棧：** React + TypeScript（Vite）。

> **測試說明（誠實標註）：** `AgentSidebar` 無既有測試檔，且其 agent 清單用 react-window 虛擬化（jsdom 下渲染易脆、需 mock 17 個 props）。本計劃為純展示重構、無新邏輯（僅摺疊狀態），故以 `tsc -b` 型別檢查 + 真瀏覽器 e2e 驗證，不新增單元測試。

---

## 檔案結構

- 修改 `client/src/components/AgentSidebar.tsx`（唯一檔）：
  - 元件頂部加兩個 `useState`。
  - CTA 區（批次同題/自動接力）降為素色。
  - 功能鈕區拆成「常用 6（一直顯示）+ 進階 5（摺疊）」。
  - 分類 chip 區改為「摺疊列（預設收起）+ 展開後顯示 chip」。

---

### 任務 1：新增摺疊狀態

**文件：** 修改 `client/src/components/AgentSidebar.tsx:113-114`

- [ ] **步驟 1：在既有 query/cat 狀態之後加兩個摺疊狀態**

把第 113-114 行：
```tsx
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
```
改為：
```tsx
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
```

- [ ] **步驟 2：型別檢查（暫時未用會 warn，下一任務即用）**

運行：`cd client && npx tsc -b`
預期：可能因未使用變數報錯——**接受暫時失敗，於任務 2/3 用到後消除**。若 lint 設定嚴格擋住，可先跳過此步驟的驗證、與任務 2 合併 commit。

（不單獨 commit，與任務 2 一起。）

---

### 任務 2：CTA 分主次（#5）+ 功能鈕分層（#3）

**文件：** 修改 `client/src/components/AgentSidebar.tsx:147-254`

- [ ] **步驟 1：CTA 次級化**

把「批次同題」按鈕（第 147-155 行）的 `className` 由漸層改為素色：
```tsx
        <button
          data-tour="batch-btn"
          onClick={onOpenBatch}
          className="w-full px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium flex items-center justify-center gap-2"
          title="多位 agent 同時做同一題"
        >
          <span>🎯</span>
          <span>批次同題</span>
        </button>
```
把「自動接力」按鈕（第 156-164 行）的 `className` 同樣改素色：
```tsx
        <button
          data-tour="workflow-btn"
          onClick={onOpenWorkflows}
          className="w-full px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium flex items-center justify-center gap-2"
          title="多位 agent 順序接力跑完一個流程"
        >
          <span>🔗</span>
          <span>自動接力</span>
        </button>
```
（「找專案經理討論」第 138-146 行**不動**，維持漸層主入口。）

- [ ] **步驟 2：功能鈕拆常用/進階**

把整個功能鈕 `<div className="grid grid-cols-3 gap-2">…</div>`（第 165-254 行，含全部 11 個鈕）替換為：常用 6 鈕 grid + 進階摺疊列 + 進階 5 鈕 grid。完整替換內容：
```tsx
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onOpenSchedules} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="設定週期任務"><span>⏰</span><span>排程</span></button>
          <button onClick={onOpenHistory} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="所有過往對話"><span>📚</span><span>歷史</span></button>
          <button onClick={onOpenNotes} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="共享筆記/知識庫"><span>📒</span><span>筆記</span></button>
          <button onClick={onOpenTemplates} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="常用 prompt 模板"><span>📋</span><span>模板</span></button>
          <button onClick={onOpenActivity} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="活動時間軸總覽"><span>📡</span><span>活動</span></button>
          <button onClick={onOpenSettings} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="主題、字體、通知設定"><span>⚙️</span><span>設定</span></button>
        </div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full px-2 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-xs flex items-center justify-between"
          title="進階：學習與記憶治理"
        >
          <span>⋯ 進階</span>
          <span>{showAdvanced ? "▾" : "▸"}</span>
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-3 gap-2">
            <button onClick={onOpenLearning} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="學習審核佇列"><span>🧠</span><span>學習</span></button>
            <button onClick={onOpenCapabilityLearning} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="能力學習進程"><span>🎓</span><span>能力學習</span></button>
            <button onClick={onOpenAutonomousStudy} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="常用 agent 定期自主上網研究領域最新做法"><span>📡</span><span>自主進修</span></button>
            <button onClick={onOpenMemoryEditor} className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5" title="直接編輯類層 / 手藝記憶"><span>✏️</span><span>記憶編輯</span></button>
            <button onClick={onOpenLegacyReview} className="px-2 py-2 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5 border border-amber-800/40" title="重審 v2 遷移前累積的全域記憶（legacy-global）"><span>⚠️</span><span>Legacy 重審</span></button>
          </div>
        )}
```

- [ ] **步驟 3：型別檢查**

運行：`cd client && npx tsc -b`
預期：零錯誤（showAdvanced 已使用）。

- [ ] **步驟 4：Commit**

```bash
git add client/src/components/AgentSidebar.tsx
git commit -m "feat(ui): primary/secondary CTA hierarchy + collapse advanced sidebar tools"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 3：分類 chip 收摺（#4）

**文件：** 修改 `client/src/components/AgentSidebar.tsx`（分類 chip 區，原第 266-286 行）

- [ ] **步驟 1：替換分類區為摺疊式**

把分類 chip 的 `<div className="px-2 py-2 flex flex-wrap gap-1 border-b border-zinc-800">…全部+chips…</div>`（原第 266-286 行）整段替換為：
```tsx
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
```

- [ ] **步驟 2：型別檢查 + 全套測試**

運行：`cd client && npx tsc -b && npx vitest run`
預期：tsc 零錯；vitest 全綠（不動既有測試）。

- [ ] **步驟 3：Commit**

```bash
git add client/src/components/AgentSidebar.tsx
git commit -m "feat(ui): collapse department filter chips behind a toggle"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 4：真瀏覽器 e2e 驗證

**文件：** 無；Playwright 驗證（主目錄 dashboard 經 Vite HMR 即時反映）。

- [ ] **步驟 1**：重載 dashboard → 側欄預設只見：找專案經理（漸層、突出）、批次同題/自動接力（素色）、常用 6 鈕、「⋯ 進階 ▸」、「🔖 篩選部門 ▸」、搜尋框、agent 清單。明顯比改前乾淨。
- [ ] **步驟 2**：點「⋯ 進階」→ 展開 5 個治理鈕（學習/能力學習/自主進修/記憶編輯/Legacy重審）；再點收合。
- [ ] **步驟 3**：點「🔖 篩選部門」→ 展開分類 chip；點「行銷部」→ 收合並顯示「🔖 篩選：行銷部 ✕」、agent 清單已過濾；按 ✕ → 清除回全部。
- [ ] **步驟 4**：確認三個 CTA 視覺層次分明（主入口漸層、另兩個素色）。

---

## 自檢結果

**規格覆蓋度：** §3.1 功能鈕分層 → 任務 2 步驟 2；§3.2 分類收摺 → 任務 3；§3.3 CTA 層次 → 任務 2 步驟 1；§5 驗證 → 任務 4 + 各任務 tsc。全覆蓋。

**佔位符掃描：** 無 TODO/待定；所有程式碼步驟含完整 className 與 JSX。

**類型一致性：** `showAdvanced`/`setShowAdvanced`、`showFilters`/`setShowFilters` 新增於任務 1、用於任務 2/3；`cat`/`setCat`/`categories`/`agents` 沿用既有；所有 `onOpen*` callback 名稱與 Props 介面（第 12-26 行）一致。

**已知取捨：** 純展示重構不寫單元測試（react-window 渲染脆 + 無既有測試），靠 tsc + e2e；已於頭部標註。
