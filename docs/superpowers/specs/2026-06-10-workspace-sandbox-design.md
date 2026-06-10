# 工作區工作目錄（沙箱）設計規格

- 日期：2026-06-10
- 狀態：設計已確認，待寫實作計畫
- 範圍：agency-dashboard（server + client + DB）
- 背景：邁向「OpenClaw 式」自主 agent 的第一步（地基）。後續步驟另立規格：B 目標驅動自主迴圈、C 動作預覽核可、D 動作可觀測、E 事件觸發。

## 1. 目標與背景

### 問題
agent 對話 session 由 `agentSession.ts` 以 `--permission-mode bypassPermissions` 啟動 claude，**擁有完整工具（bash／檔案／web／工作區 MCP）且不需核可**。但 spawn 時 `cwd = process.cwd()` = **dashboard server 自己的目錄**。因此：
- ⚠️ **安全隱患**：有 bash + bypassPermissions 的 agent 可能（被 prompt injection 或自作主張）改到 dashboard 自身的程式碼/資料（與近期測試誤刪 sessions 同類風險）。
- 🚫 **賦能缺口**：agent 沒有「一塊自己的工作目錄」可建立/維護專案檔案——無法真正像 OpenClaw 那樣在一個專案沙箱裡持續工作。

### 目標
每個 workspace 擁有一個**工作目錄**；該工作區的 agent session 以此目錄為 cwd。預設自動建立沙箱，亦可指向使用者現有資料夾（操作真實專案）。**保留 bypassPermissions（自主性）**，以「cwd 移出 server 目錄 + 防呆驗證」達成**軟隔離**。

### 成功標準
- 新建工作區自動有一個工作目錄（預設 `data/workspaces/<id>/`），agent session 的 cwd 指向它。
- 工作區設定可把工作目錄改成任一現有絕對路徑（指向真實專案）。
- 防呆：工作目錄不可設成 dashboard 自身（repo root／server／client／data 本身）。
- agent 在 session 中以 bash/檔案工具建立的檔案，落在工作區目錄、不污染 server。

### 非目標（YAGNI）
- **不做 OS 層硬隔離**（容器/chroot）。軟隔離即可；bash 仍可 `cd` 跳出，這是已知取捨（硬隔離留待未來步驟）。
- **不收斂工具權限**：保留 bypassPermissions 與既有工具集（含 bash）。
- **不做** per-session 目錄：同一工作區所有 session 共用同一工作目錄。
- **不動** 既有 MCP/Chrome 接線、學習、派工等。

## 2. 整體架構與資料流

```
workspace 設定 working_dir（或留空=預設沙箱）
        │  (updateWorkspace：防呆驗證路徑)
        ▼
resolveWorkspaceDir(ws) → 自訂值 或 data/workspaces/<id>/
        │
        ▼
ensureWorkspaceDir(ws) → mkdir -p，回絕對路徑
        │  (agentManager.start / resumeSession 啟動 session 前呼叫)
        ▼
new AgentSession(..., cwd) → spawnClaudeChild 用該 cwd（取代 process.cwd()）
        ▼
agent 的 bash／檔案工具都在工作區目錄樹內運作
```

## 3. 元件設計

### 3.1 資料模型（dbSchema.ts）
`workspaces` 表加一欄：
```sql
working_dir TEXT
```
- NULL／空 = 使用預設沙箱（resolveWorkspaceDir 計算）。
- 非空 = 使用者指定的絕對路徑。
- 既有 DB 以 `applyMigrations` idempotent ALTER 補欄：
```typescript
if (tableExists(db, "workspaces") && !hasColumn(db, "workspaces", "working_dir")) {
  db.exec("ALTER TABLE workspaces ADD COLUMN working_dir TEXT");
}
```
`Workspace` interface（store/types.ts）加 `workingDir?: string;`，`rowToWorkspace` 讀 `working_dir`。

### 3.2 目錄解析模組（新 `server/src/workspaceDir.ts`）
```typescript
import path from "node:path";
import fs from "node:fs";
import type { Workspace } from "./store/types.js";

// data 目錄下的工作區沙箱根
const SANDBOX_ROOT = path.join(process.cwd(), "data", "workspaces");

/** 回傳工作區的工作目錄絕對路徑（自訂優先，否則預設沙箱）。 */
export function resolveWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const custom = (ws.workingDir || "").trim();
  if (custom) return path.resolve(custom);
  return path.join(SANDBOX_ROOT, ws.id);
}

/** resolve + 確保目錄存在，回絕對路徑。 */
export function ensureWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const dir = resolveWorkspaceDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 防呆：檢查擬設定的工作目錄是否落在 dashboard 自身（禁止）。
 *  允許 data/workspaces/* 子目錄。回 null=OK，否則回錯誤訊息。 */
export function validateWorkingDir(candidate: string): string | null {
  const abs = path.resolve(candidate);
  const repoRoot = path.resolve(process.cwd(), ".."); // server 的上層 = repo 根
  const server = process.cwd();
  const dataDir = path.join(server, "data");
  const sandboxRoot = SANDBOX_ROOT;
  const within = (parent: string, child: string) => {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  // 允許沙箱根底下
  if (within(sandboxRoot, abs)) return null;
  // 禁止落在 repo / server / client / data（沙箱以外）
  for (const banned of [repoRoot, server, path.join(repoRoot, "client"), dataDir]) {
    if (within(banned, abs)) return `工作目錄不可設在 dashboard 自身目錄內（${banned}）`;
  }
  return null;
}
```
> 註：`process.cwd()` 在 server 執行時 = `.../agency-dashboard/server`，故 repoRoot = 上層。實作時以此為準；若日後啟動 cwd 改變需同步調整偵測基準。

### 3.3 啟動接線（agentSession.ts + agentManager.ts）
- `AgentSession` 建構子新增一個可選參數 `cwd?: string`，存成 `this.cwd`；`spawnClaudeChild` 改為 `cwd: opts?.cwd || this.cwd || process.cwd()`。
- `agentManager.start(...)` 與 `resumeSession(...)`：取得 `ws`（既有）後 `const cwd = ensureWorkspaceDir(ws);`，建構 `new AgentSession(agentId, sessionId, standing, mcpConfig, provider, cwd)`。
  - 注意建構子既有參數順序，`cwd` 放最後一個可選參數。

### 3.4 防呆驗證接線（store/workspaces.ts 或 routes/workspaces.ts）
`updateWorkspace` 的 patch 支援 `workingDir`：
- 在寫入前若 `patch.workingDir` 非空，呼叫 `validateWorkingDir`；不通過則 throw（route 轉 400）。
- `updateWorkspace` 的 `Pick` 型別加入 `workingDir`；UPDATE 語句加 `working_dir = ?`。
- 驗證放在 `routes/workspaces.ts` 的 PATCH handler（回 400 友善訊息）較佳；store 層也可防守式 throw。**決議**：route 層驗證 + 回 400（與既有 workspace 錯誤處理一致）。

### 3.5 前端（工作區設定面板）
- 在既有工作區設定 UI（顯示 name/description/standingContext/enabledMcps 的地方）新增「工作目錄」欄：
  - 顯示目前生效路徑：若 `workingDir` 空，顯示預設沙箱路徑（灰字＋「(預設沙箱)」標註）；否則顯示自訂值。
  - 輸入框可填自訂絕對路徑；存檔走 `updateWorkspace({ workingDir })`。清空＝回預設沙箱。
  - 存檔失敗（防呆 400）顯示後端錯誤訊息。
- api.ts：updateWorkspace 既有，body 加 workingDir 即可（沿用現有 PATCH /workspaces/:id）。

## 4. 錯誤處理與邊界
- `ensureWorkspaceDir` mkdir 失敗（權限/路徑非法）→ 拋錯，agentManager.start 應 try/catch 並回友善錯誤（session 啟動失敗訊息），不可讓 server crash。
- 自訂路徑不存在但合法 → ensureWorkspaceDir 會建立它（mkdir -p）。若使用者指向「應已存在的真實專案」卻打錯字，會建出空目錄——可接受（使用者可在 UI 看到生效路徑）。
- 防呆只擋 dashboard 自身；不擋其他系統敏感目錄（軟隔離範圍，使用者自負）。
- 既有 session（cwd 曾是 server 目錄）：下次 respawn 會改用工作區目錄；不追溯搬移既有產物。

## 5. 測試計畫（server vitest，:memory: 隔離）
- `workspaceDir.test.ts`：
  - resolveWorkspaceDir：無 workingDir → `data/workspaces/<id>`；有自訂 → 該絕對路徑。
  - ensureWorkspaceDir：建立目錄（用 tmp 路徑驗證 fs）。
  - validateWorkingDir：設成 repo root／server／client／data → 回錯誤；設成 data/workspaces/<id> 或外部 tmp 路徑 → 回 null。
- `store.workspaces`（既有測試檔追加）：updateWorkspace 寫入/讀回 workingDir。
- 防呆 route：PATCH /workspaces/:id 帶非法 workingDir → 400（app.test.ts 模式）。
- agentManager 接線：較難純測（spawn claude）；以「ensureWorkspaceDir 被呼叫且回傳值傳入 AgentSession」的單元層級驗證（可注入或檢查建構參數），不打真 claude。

## 6. 檔案異動
**新增**：`server/src/workspaceDir.ts` + `workspaceDir.test.ts`。
**修改**：`server/src/dbSchema.ts`（working_dir 欄 + migration）、`server/src/store/types.ts`（Workspace.workingDir）、`server/src/store/workspaces.ts`（rowToWorkspace + updateWorkspace 支援 working_dir）、`server/src/routes/workspaces.ts`（PATCH 驗證）、`server/src/agentSession.ts`（建構子 cwd）、`server/src/agentManager.ts`（start/resume 接線 ensureWorkspaceDir）、前端工作區設定元件 + `client/src/lib/api.ts`（updateWorkspace body 加 workingDir，多數情況既有型別已涵蓋 Partial<Workspace>）。

## 7. 開放假設
- 假設 server 以 `cwd = .../agency-dashboard/server` 啟動（npm run dev:server）；repoRoot 偵測據此。若部署方式不同需調整 validateWorkingDir 的基準。
- 軟隔離不保證 bash 無法跳出工作區；安全強度以「移出 server 目錄 + 防呆」為限，OS 沙箱為未來步驟。
- 工作區沙箱在 data/workspaces/ 下；data/ 已在 .gitignore（不入版控），沙箱內容不會被 commit。
