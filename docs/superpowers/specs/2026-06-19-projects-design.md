# 子系統① 專案概念 + 專案記憶 Spec

> 狀態：設計（已批准，2026-06-19）。這是「上下文管理三塊」的第①塊（地基）；②長對話自動濃縮、③PM 跨 session 查詢各自獨立 spec，依序在此之後。
> 下一步：本 spec 經審查後 → writing-plans。

## 1. 背景與動機

長期使用下，單一 PM session 不能無限聊（token 線性增長、變慢、注意力稀釋、終撞上下文上限）。需要把「記憶」與「對話」分層：工作區（永久常數）→ **專案（一條工作線的持久記憶）** → session（用久即換）。目前只有 workspace 層分組，**沒有專案概念**，所以換 session/換專案就遺失脈絡（例：新 PM 找不到舊 session 的 audioscape）。

本塊建立「專案」實體 + 「專案記憶」帳本，並自動注入該專案的 session，作為②③與未來 SP5「營運帳本」的共同地基。

## 2. 範圍

- **做**：projects 資料表、sessions 加 project_id、專案記憶帳本（手動可編輯）、專案記憶自動注入、專案 CRUD API、session 指派、精簡 UI（標頭專案下拉 + 專案記憶面板）。
- **不做（留後續）**：自動濃縮（=②）、PM 主動查詢工具（=③）、歷史/側欄依專案分組的完整 UI、跨專案引用、看板/拖拉。
- **跨專案共享**：沿用既有「工作區筆記 / standing context」（所有專案 session 都讀得到），本塊不另建跨專案機制。

## 3. 設計

### 3.1 資料模型
- 新增 `projects` 表：
  ```sql
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    memory TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_ws ON projects(workspace_id, updated_at DESC);
  ```
- `sessions` 加欄 `project_id TEXT`（可空，外鍵語意上指向 projects.id；不設硬 FK 以與既有 schema 風格一致）。
- migration 照既有模式（`dbSchema.ts`：BASE_SCHEMA 加表/欄 + `applyMigrations` 用 `hasColumn`/`tableExists` idempotent ALTER：`ALTER TABLE sessions ADD COLUMN project_id TEXT`）。

### 3.2 store 層（新檔 `server/src/store/projects.ts`）
- `createProject({workspaceId, name})`、`listProjects(workspaceId)`、`getProject(id)`、`renameProject(id, name)`、`deleteProject(id)`（刪除時把其下 sessions 的 project_id 設 null，不刪 session）。
- `getProjectMemory(id)` / `setProjectMemory(id, content)`：記憶帳本讀寫，仿 `store/workspaces.ts:appendWorkspaceMemory` 的**滾動截斷**（上限 8KB，超過從頭截斷保留最新）。
- `store/sessions.ts` 加 `setSessionProject(sessionId, projectId | null)`；`SessionRecord`/查詢帶出 `project_id`。

### 3.3 專案記憶自動注入
- 在 `agentManager`（現注入 workspace standingContext / workspace memory / agent_memory / craft 的同一處，約 `agentManager.ts:173-233`）新增：若該 session 的 `project_id` 非空，讀 `getProjectMemory(project_id)`，非空則以區塊注入 system prompt：
  ```
  # 本專案的記憶 / 狀態
  <專案記憶內容>
  ```
- session 的 project_id 來源：session 記錄（3.2 已帶出）。`agentManager.start` 取得 session → 讀 project_id → 注入。

### 3.4 API（新檔 `server/src/routes/projects.ts`，掛 /api/projects）
- `GET /api/projects?workspace=` → 列出工作區的專案。
- `POST /api/projects` `{name}` → 建立。
- `PATCH /api/projects/:id` `{name?, memory?}` → 改名 / 更新記憶。
- `DELETE /api/projects/:id` → 刪除（其下 session project_id 設 null）。
- `PATCH /api/sessions/:id` 既有路由擴充接受 `{projectId}` → 指派/移動/取消（null）。

### 3.5 UI（精簡，改 `client/src/components/ChatWindow.tsx` 標頭 + 新增小元件）
- 聊天標頭加「📁 專案 ▾」下拉：列出工作區專案 + 「＋ 新專案」+ 「未分類」；選擇即呼叫 PATCH /sessions/:id 指派、刷新。
- 「專案記憶」入口（標頭按鈕或下拉內）：開一個面板/modal 顯示該專案記憶帳本，可編輯 → PATCH /api/projects/:id `{memory}`。沿用既有 modal/panel 樣式（如 AgentMemoryModal）。
- `client/src/lib/api.ts` 加對應呼叫；視需要一個 `useProjects(workspaceId)` hook。

### 3.6 向後相容
- 既有 session `project_id=null` → 不注入專案記憶、UI 顯示「未分類」、行為完全不變。
- 既有 PATCH /sessions/:id 既有欄位行為不變，只新增可選 projectId。

## 4. 錯誤 / 邊界
- 刪除專案：其下 session 不刪、project_id 設 null（避免孤兒/誤刪對話）。
- 專案記憶 8KB 上限滾動截斷（仿 workspace memory），避免 system prompt 膨脹。
- 指派到不存在的 project_id：API 回 404 / 忽略；UI 只從清單選，不手打。

## 5. 測試 / 驗證
- `server/src/store/projects.test.ts`：CRUD、刪除時 session 解除綁定、記憶滾動截斷。
- 注入測試：有 project_id 的 session 啟動時，system prompt 含專案記憶區塊；無 project_id 不含（沿用既有 agentManager 測試模式，或在 store/注入函式層測）。
- 端點測試：app.test.ts 加 projects CRUD + 指派。
- `server npm test`（tsc+vitest）全綠、`client tsc -b` 零錯。
- 真瀏覽器 e2e：建專案→把 PM session 指派進去→編輯專案記憶→開該專案的新 session→PM 回覆能引用專案記憶內容（驗證注入）。
