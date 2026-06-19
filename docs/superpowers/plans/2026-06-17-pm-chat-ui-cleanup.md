# PM 聊天 UI 整理 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓 PM 聊天的「自主模式」面板閒置時收成一行（避免與聊天輸入框並存的困惑），並在自走進行中於聊天輸入框上方顯示清楚提示。

**架構：** 純前端、兩個元件。AutonomyPanel 閒置分支改成可摺疊（預設收起，點擊展開目標框）；ChatWindow 在 Composer 上方依「自走 run 進行中」條件渲染一行提示橫條。不動後端、API、session busy 機制。

**技術棧：** React + TypeScript（Vite）、vitest + @testing-library/react。

---

## 檔案結構

- 修改 `client/src/components/AutonomyPanel.tsx` — 閒置/終止分支改為摺疊列 + 展開內容；新增 expanded 本地狀態 + run 轉 active 時重置。
- 修改 `client/src/components/AutonomyPanel.test.tsx` — 兩個「閒置」測試改為先點展開再斷言。
- 修改 `client/src/components/ChatWindow.tsx` — Composer 上方加自走中提示橫條。

---

### 任務 1：AutonomyPanel 閒置面板收摺

**文件：**
- 修改：`client/src/components/AutonomyPanel.tsx`（import 第 1 行、元件頂部 state、閒置分支第 30-52 行）
- 測試：`client/src/components/AutonomyPanel.test.tsx`（第 20-56 行兩個測試）

- [ ] **步驟 1：更新測試（先失敗）**

把 `AutonomyPanel.test.tsx` 第一個測試（`run=null 顯示目標輸入與開始鈕`，第 20-36 行）改為先展開：
```tsx
  it("run=null：預設收摺，展開後顯示目標輸入與開始鈕", () => {
    const onStart = vi.fn();
    render(
      <AutonomyPanel
        run={null}
        busy={false}
        onStart={onStart}
        onApprovePlan={() => {}}
        onStop={() => {}}
        onResume={() => {}}
        onInput={() => {}}
        onInject={() => Promise.resolve(false)}
      />
    );
    // 預設收摺：目標框不可見
    expect(screen.queryByPlaceholderText(/例如/)).toBeNull();
    // 點摺疊列展開
    fireEvent.click(screen.getByText(/自走模式/));
    expect(screen.getByPlaceholderText(/例如/)).toBeTruthy();
    expect(screen.getByText(/開始自主執行/)).toBeTruthy();
  });
```

把第二個測試（`輸入目標後點開始呼叫 onStart`，第 38-56 行）改為先展開再操作：
```tsx
  it("展開後輸入目標點開始呼叫 onStart", () => {
    const onStart = vi.fn();
    render(
      <AutonomyPanel
        run={null}
        busy={false}
        onStart={onStart}
        onApprovePlan={() => {}}
        onStop={() => {}}
        onResume={() => {}}
        onInput={() => {}}
        onInject={() => Promise.resolve(false)}
      />
    );
    fireEvent.click(screen.getByText(/自走模式/));
    const textarea = screen.getByPlaceholderText(/例如/);
    fireEvent.change(textarea, { target: { value: "我的目標" } });
    fireEvent.click(screen.getByText(/開始自主執行/));
    expect(onStart).toHaveBeenCalledWith("我的目標");
  });
```
（其餘 4 個測試是 active-run 狀態，不受影響，保持不動。）

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd client && npx vitest run src/components/AutonomyPanel.test.tsx`
預期：FAIL（目前閒置面板直接顯示 textarea，`queryByPlaceholderText` 不為 null；且無「自走模式」可點的摺疊列）。

- [ ] **步驟 3：實現摺疊**

3a. 第 1 行 import 加 `useEffect`：
```tsx
import { useState, useEffect } from "react";
```

3b. 在元件內、現有 `const [injectText, setInjectText] = useState("");`（第 28 行）之後加 expanded 狀態與重置 effect：
```tsx
  const [expanded, setExpanded] = useState(false);
  // run 一旦進入進行中狀態，收起閒置展開狀態，確保跑完回到乾淨的一行
  useEffect(() => {
    if (run && !TERMINAL.includes(run.status)) setExpanded(false);
  }, [run?.status]);
```

3c. 把閒置/終止分支（第 30-52 行）整段改為摺疊列 + 展開內容：
```tsx
  if (!run || TERMINAL.includes(run.status)) {
    return (
      <div className="rounded border border-zinc-700 text-xs">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between p-2 text-zinc-300 hover:text-zinc-100"
        >
          <span>🎯 自走模式</span>
          <span className="text-zinc-500">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && (
          <div className="border-t border-zinc-700 p-2">
            <div className="mb-1 text-zinc-400">
              給一個目標，agent 會自己拆步驟、逐步執行（諮詢／工作區內動作自動進行；對外發送、花錢、破壞性動作會先問你）。
            </div>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="例如：盤點本週三大平台熱門選題並整理成提案草稿"
              className="mb-1 w-full rounded bg-zinc-900 p-2 text-zinc-100"
              rows={2}
            />
            <button
              disabled={busy || !goal.trim()}
              onClick={() => onStart(goal.trim())}
              className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-40"
            >
              開始自主執行
            </button>
          </div>
        )}
      </div>
    );
  }
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd client && npx vitest run src/components/AutonomyPanel.test.tsx`
預期：PASS（6 個測試全綠）。

- [ ] **步驟 5：型別檢查**

運行：`cd client && npx tsc -b`
預期：零錯誤。

- [ ] **步驟 6：Commit**

```bash
git add client/src/components/AutonomyPanel.tsx client/src/components/AutonomyPanel.test.tsx
git commit -m "feat(ui): collapse idle autonomy panel to a one-line toggle"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 2：自走進行中於 Composer 上方顯示提示

**文件：**
- 修改：`client/src/components/ChatWindow.tsx`（`<Composer ... />` 之前，約第 389 行）

- [ ] **步驟 1：實現提示橫條**

在 ChatWindow 的 `<Composer` 元素之前（緊接在 `<MessageList ... />` 區塊之後、第 389 行 `<Composer` 之前）插入：
```tsx
      {autonomyRun && !["done", "stopped", "budget_exhausted", "error"].includes(autonomyRun.status) && (
        <div className="px-4 py-2 border-t border-emerald-700/30 bg-emerald-950/20 text-xs text-emerald-300">
          🎯 自走中…請用上方插話框跟它說話，或按「喊停」
        </div>
      )}
```
（`autonomyRun` 已在第 131 行 `useAutonomy` 解構取得，直接可用。橫條樣式比照既有 `autoInjectedNotes`/`summary` 薄橫條，用 emerald 與自走面板呼應；不改 Composer 本身。）

- [ ] **步驟 2：型別檢查**

運行：`cd client && npx tsc -b`
預期：零錯誤。

- [ ] **步驟 3：全套 client 測試確認沒回歸**

運行：`cd client && npx vitest run`
預期：全綠（本任務不動測試，既有測試應不受影響）。

- [ ] **步驟 4：Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(ui): show self-walk-in-progress notice above composer"
```
（結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）

---

### 任務 3：真瀏覽器 e2e 驗證

**文件：** 無；手動 Playwright 驗證（worktree dev server）。

- [ ] **步驟 1**：worktree dev 起來後開 PM → 確認頂部只有一行「🎯 自走模式 ▸」、下方僅一個聊天輸入框（無第二個輸入框並存）。
- [ ] **步驟 2**：點摺疊列 → 展開出目標框 → 輸入目標 → 「開始自主執行」→ run 啟動。
- [ ] **步驟 3**：自走進行中 → Composer 上方出現「🎯 自走中…」提示橫條、輸入框置灰。
- [ ] **步驟 4**：run 結束 → 面板回到收起的一行、提示橫條消失。

---

## 自檢結果

**規格覆蓋度：** §3.1 收摺 → 任務 1；§3.2 提示橫條 → 任務 2；§5 驗證 → 任務 1 步驟 4-5 + 任務 2 步驟 2-3 + 任務 3 e2e。全覆蓋。

**佔位符掃描：** 無 TODO/待定；所有程式碼步驟含完整程式碼。

**類型一致性：** `expanded`/`setExpanded`、`TERMINAL`（AutonomyPanel 既有常數）、`autonomyRun`（ChatWindow 既有變數）、終止狀態字串陣列與既有定義一致。測試用 `queryByPlaceholderText`（不存在回 null）vs `getByPlaceholderText`（存在），語義正確。
