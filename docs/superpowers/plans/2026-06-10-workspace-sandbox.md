# 工作區工作目錄（沙箱）實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現。步驟用複選框（`- [ ]`）追蹤。

**目標：** 每個 workspace 有一個工作目錄；agent session 以它為 cwd（取代 server 目錄）。預設沙箱 `data/workspaces/<id>`、可改指現有資料夾、保留 bypassPermissions + 防呆（禁設成 dashboard 自身）。

**架構：** workspaces 加 `working_dir` 欄；新 `workspaceDir.ts` 解析/建立/驗證目錄；`AgentSession` 建構子加 `cwd`，`agentManager` start/resume 傳 `ensureWorkspaceDir(ws)`；route PATCH 驗證；前端設定欄。

**技術棧：** Node + TypeScript、node:sqlite、Express、vitest（:memory: 隔離）、React + vitest/RTL。

**規格：** `docs/superpowers/specs/2026-06-10-workspace-sandbox-design.md`

---

## 檔案結構
- **新增**：`server/src/workspaceDir.ts`、`server/src/workspaceDir.test.ts`
- **修改**：`server/src/dbSchema.ts`、`server/src/store/types.ts`、`server/src/store/workspaces.ts`、`server/src/routes/workspaces.ts`、`server/src/app.test.ts`、`server/src/agentSession.ts`、`server/src/agentManager.ts`、前端工作區設定元件 + `client/src/lib/api.ts`（視需要）

---

### 任務 1：DB 欄位 + Workspace 型別 + 持久化

**檔案：** 修改 `server/src/dbSchema.ts`、`server/src/store/types.ts`、`server/src/store/workspaces.ts`；測試 `server/src/dbSchema.test.ts`、`server/src/store.category.test.ts`（或既有 workspace 測試檔，沿用）。

- [ ] **步驟 1：寫失敗測試**（dbSchema.test.ts 追加）
```typescript
it("workspaces 有 working_dir 欄", () => {
  const db = freshDb();
  const cols = db.prepare("SELECT name FROM pragma_table_info('workspaces')").all().map((c: any) => c.name);
  expect(cols).toContain("working_dir");
});
```
並在 store 既有 workspace 測試檔（找一個有 createWorkspace/updateWorkspace 的，如 `store.category.test.ts`；若無則加在 dbSchema.test.ts 旁的新 `store.workspaces.test.ts`）追加：
```typescript
import { createWorkspace, updateWorkspace, getWorkspace } from "./store/workspaces.js";
it("updateWorkspace 寫入/讀回 workingDir", () => {
  const ws = createWorkspace({ name: "wd test" });
  updateWorkspace(ws.id, { workingDir: "D:/some/path" } as any);
  expect(getWorkspace(ws.id)?.workingDir).toBe("D:/some/path");
});
```

- [ ] **步驟 2：跑確認 FAIL**：`cd server && npx vitest run src/dbSchema.test.ts`，預期 working_dir 欄不存在。

- [ ] **步驟 3：實作**
- `dbSchema.ts` BASE_SCHEMA 的 `workspaces` CREATE TABLE 內加一欄（放 chrome_cdp_port 後、created_at 前）：`working_dir TEXT,`
- `dbSchema.ts` `applyMigrations` 加：
```typescript
if (tableExists(db, "workspaces") && !hasColumn(db, "workspaces", "working_dir")) {
  db.exec("ALTER TABLE workspaces ADD COLUMN working_dir TEXT");
}
```
- `store/types.ts` `Workspace` interface 加：`workingDir?: string;`
- `store/workspaces.ts` `rowToWorkspace` 加：`workingDir: r.working_dir ?? undefined,`
- `store/workspaces.ts` `updateWorkspace` 的 `Pick<...>` 加 `"workingDir"`；UPDATE 語句加 `working_dir = ?`、對應值 `next.workingDir ?? null`：
```typescript
export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "standingContext" | "memory" | "enabledMcps" | "chromeCdpPort" | "workingDir">>): Workspace | undefined {
  const cur = getWorkspace(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE workspaces SET name = ?, description = ?, standing_context = ?, memory = ?, enabled_mcps = ?, chrome_cdp_port = ?, working_dir = ?
    WHERE id = ?
  `).run(
    next.name, next.description, next.standingContext, next.memory || "",
    JSON.stringify(next.enabledMcps || []),
    next.chromeCdpPort ?? null,
    next.workingDir ?? null,
    id,
  );
  return getWorkspace(id);
}
```

- [ ] **步驟 4：跑確認 PASS** + `cd server && npm test` 全綠。
- [ ] **步驟 5：Commit**
```bash
git add server/src/dbSchema.ts server/src/dbSchema.test.ts server/src/store/types.ts server/src/store/workspaces.ts server/src/store.category.test.ts
git commit -m "feat(sandbox): workspaces.working_dir 欄 + Workspace.workingDir 持久化"
```

---

### 任務 2：workspaceDir.ts（解析/建立/防呆）

**檔案：** 創建 `server/src/workspaceDir.ts`、`server/src/workspaceDir.test.ts`。

- [ ] **步驟 1：寫失敗測試**
```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { resolveWorkspaceDir, ensureWorkspaceDir, validateWorkingDir } from "./workspaceDir.js";

describe("workspaceDir", () => {
  it("無 workingDir → 預設沙箱 data/workspaces/<id>", () => {
    const dir = resolveWorkspaceDir({ id: "ws1" });
    expect(dir).toBe(path.join(process.cwd(), "data", "workspaces", "ws1"));
  });
  it("有 workingDir → 用該絕對路徑", () => {
    const custom = path.join(os.tmpdir(), "wsX");
    expect(resolveWorkspaceDir({ id: "ws1", workingDir: custom })).toBe(path.resolve(custom));
  });
  it("ensureWorkspaceDir 會建立目錄", () => {
    const custom = path.join(os.tmpdir(), "ws_ensure_" + Date.now());
    const dir = ensureWorkspaceDir({ id: "ws1", workingDir: custom });
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("validateWorkingDir：設成 server 目錄內 → 回錯誤", () => {
    expect(validateWorkingDir(path.join(process.cwd(), "src"))).toBeTruthy();
  });
  it("validateWorkingDir：data/workspaces 子目錄 → OK(null)", () => {
    expect(validateWorkingDir(path.join(process.cwd(), "data", "workspaces", "ws1"))).toBeNull();
  });
  it("validateWorkingDir：外部 tmp 路徑 → OK(null)", () => {
    expect(validateWorkingDir(path.join(os.tmpdir(), "proj"))).toBeNull();
  });
});
```

- [ ] **步驟 2：跑確認 FAIL**：`cd server && npx vitest run src/workspaceDir.test.ts`（模組不存在）。

- [ ] **步驟 3：實作 `workspaceDir.ts`**
```typescript
import path from "node:path";
import fs from "node:fs";
import type { Workspace } from "./store/types.js";

const SANDBOX_ROOT = path.join(process.cwd(), "data", "workspaces");

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const custom = (ws.workingDir || "").trim();
  if (custom) return path.resolve(custom);
  return path.join(SANDBOX_ROOT, ws.id);
}

export function ensureWorkspaceDir(ws: Pick<Workspace, "id" | "workingDir">): string {
  const dir = resolveWorkspaceDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 防呆：禁止落在 dashboard 自身目錄（沙箱子目錄例外）。OK 回 null，否則回錯誤訊息。 */
export function validateWorkingDir(candidate: string): string | null {
  const abs = path.resolve(candidate);
  if (within(SANDBOX_ROOT, abs)) return null; // 沙箱子目錄一律允許
  const server = process.cwd();
  const repoRoot = path.resolve(server, "..");
  const banned = [repoRoot, server, path.join(repoRoot, "client"), path.join(server, "data")];
  for (const b of banned) {
    if (within(b, abs)) return `工作目錄不可設在 dashboard 自身目錄內（${b}）`;
  }
  return null;
}
```

- [ ] **步驟 4：跑確認 PASS** + `npm test` 全綠。
- [ ] **步驟 5：Commit**
```bash
git add server/src/workspaceDir.ts server/src/workspaceDir.test.ts
git commit -m "feat(sandbox): workspaceDir 解析/建立/防呆驗證"
```

---

### 任務 3：route PATCH 防呆驗證

**檔案：** 修改 `server/src/routes/workspaces.ts`；測試 `server/src/app.test.ts`。

- [ ] **步驟 1：寫失敗測試**（app.test.ts 追加，沿用 base/server helper）
```typescript
it("PATCH /api/workspaces/:id workingDir 設成 dashboard 自身 → 400", async () => {
  const ws = (await (await fetch(`${base}/api/workspaces`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "wd guard" }),
  })).json()) as { id: string };
  createdWorkspaceIds.push(ws.id);
  const r = await fetch(`${base}/api/workspaces/${ws.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workingDir: process.cwd() }),
  });
  expect(r.status).toBe(400);
});
```

- [ ] **步驟 2：跑確認 FAIL**：`cd server && npx vitest run src/app.test.ts`（目前會回 200）。

- [ ] **步驟 3：實作**（routes/workspaces.ts）
- import：`import { validateWorkingDir } from "../workspaceDir.js";`
- PATCH handler（約 L35）改為先驗證 workingDir：
```typescript
workspacesRouter.patch("/:id", (req, res) => {
  const body = req.body || {};
  if (typeof body.workingDir === "string" && body.workingDir.trim()) {
    const err = validateWorkingDir(body.workingDir);
    if (err) return res.status(400).json({ error: err });
  }
  const updated = updateWorkspace(req.params.id, body);
  if (!updated) return res.status(404).json({ error: "找不到工作區" });
  res.json(updated);
});
```
（若既有 handler 已有 404 處理，保留其形式，只插入 workingDir 驗證段。）

- [ ] **步驟 4：跑確認 PASS** + `npm test` 全綠。
- [ ] **步驟 5：Commit**
```bash
git add server/src/routes/workspaces.ts server/src/app.test.ts
git commit -m "feat(sandbox): PATCH workspace workingDir 防呆驗證（400）"
```

---

### 任務 4：agent session cwd 接線

**檔案：** 修改 `server/src/agentSession.ts`、`server/src/agentManager.ts`。

- [ ] **步驟 1：寫失敗測試**（agentManager 起 session 難純測 spawn；改測「ensureWorkspaceDir 對新工作區回正確 cwd 且 AgentSession 接受 cwd」的單元層級。新增 `server/src/agentSession.cwd.test.ts`）
```typescript
import { describe, it, expect } from "vitest";
import { AgentSession } from "./agentSession.js";

describe("AgentSession cwd", () => {
  it("建構子接受 cwd 參數並保存（不 spawn）", () => {
    const s = new AgentSession("agents-orchestrator", undefined, undefined, undefined, "claude", "D:/work/ws1");
    expect((s as any).cwd).toBe("D:/work/ws1");
  });
});
```

- [ ] **步驟 2：跑確認 FAIL**：`cd server && npx vitest run src/agentSession.cwd.test.ts`（建構子無第 6 參數 / this.cwd 未定義）。

- [ ] **步驟 3：實作**
- `agentSession.ts` 建構子（約 L91）加第 6 個可選參數並保存：
```typescript
  constructor(
    agentId: string,
    sessionId?: string,
    extraSystemPrompt?: string,
    mcpConfigJson?: string,
    provider: Provider = "claude",
    cwd?: string,
  ) {
    super();
    this.id = sessionId || uuid();
    this.agentId = agentId;
    this.extraSystemPrompt = extraSystemPrompt;
    this.mcpConfigJson = mcpConfigJson;
    this.provider = provider;
    this.cwd = cwd;
  }
```
並在 class 欄位區宣告 `private cwd?: string;`（與其他 private 欄位放一起）。
- `agentSession.ts` 把三處 `cwd: ... process.cwd()`（約 L194 claude、L313、L400 其他 provider）統一改為優先用 this.cwd：
  - L194：`cwd: opts?.cwd || this.cwd || process.cwd(),`
  - L313、L400：同樣改 `this.cwd || process.cwd()`（讓 codex/gemini 也吃工作區目錄）。
- `agentManager.ts`：import `ensureWorkspaceDir`：`import { ensureWorkspaceDir } from "./workspaceDir.js";`
  - start（約 L209-219）：在 `const ws = getWorkspace(wsId);` 後加 `const cwd = ws ? ensureWorkspaceDir(ws) : undefined;`，建構改為：
    `const session = new AgentSession(agentId, undefined, combined || undefined, mcpConfig || undefined, provider, cwd);`
  - resumeSession（約 L245-252）：`const ws = getWorkspace(rec.workspaceId);` 後加 `const cwd = ws ? ensureWorkspaceDir(ws) : undefined;`，建構改為：
    `const session = new AgentSession(rec.agentId, rec.id, undefined, mcpConfig || undefined, rec.provider, cwd);`
  - 用 try/catch 包 ensureWorkspaceDir，失敗則 `cwd = undefined` 並 `console.warn`（mkdir 失敗不阻斷 session）。

- [ ] **步驟 4：跑確認 PASS** + `npm test` 全綠（含既有 agentSession 測試）。
- [ ] **步驟 5：Commit**
```bash
git add server/src/agentSession.ts server/src/agentManager.ts server/src/agentSession.cwd.test.ts
git commit -m "feat(sandbox): agent session cwd 指向工作區目錄"
```

---

### 任務 5：前端工作區「工作目錄」設定

**檔案：** 修改前端工作區設定元件（先找：`grep -rl "standingContext\|enabledMcps\|chromeCdpPort" client/src/components`，多半是 `SettingsPanel.tsx` 或 workspace 設定處）、`client/src/lib/api.ts`（updateWorkspace 若已是 `Partial<Workspace>` 則型別已涵蓋）。測試：對應元件的 `.test.tsx`（若該元件已有測試檔則追加；否則加最小 RTL 測試）。

- [ ] **步驟 1：先定位**：`grep -rn "updateWorkspace\|chromeCdpPort\|standingContext" client/src` 找到工作區設定 UI 與 api.updateWorkspace 簽名；確認 api.updateWorkspace 的 patch 型別含 workingDir（`Partial<Workspace>` 通常已含；若是具名欄位則補 workingDir）。

- [ ] **步驟 2：寫失敗測試**（在工作區設定元件測試檔追加；mock api.updateWorkspace）
```typescript
it("可編輯工作目錄並存檔呼叫 updateWorkspace", async () => {
  // render 該設定元件（帶一個 workspace prop），找到「工作目錄」輸入框，
  // fireEvent.change 後按存檔，expect(api.updateWorkspace).toHaveBeenCalledWith(
  //   expect.any(String), expect.objectContaining({ workingDir: "D:/proj" }))
});
```
（依該元件實際 props/結構撰寫；核心斷言：改工作目錄→存檔→帶 workingDir 呼叫 updateWorkspace。）

- [ ] **步驟 3：跑確認 FAIL**。

- [ ] **步驟 4：實作**：在工作區設定 UI 加一個「工作目錄」欄位：
  - 顯示目前值：`workspace.workingDir || "（預設沙箱：data/workspaces/<id>）"`（預設用灰字提示）。
  - 受控 input 綁本地 state；存檔走既有 updateWorkspace patch 機制，帶 `workingDir`（空字串＝清除回預設，送 `workingDir: ""`）。
  - 存檔失敗（後端 400）顯示錯誤訊息（沿用該面板既有錯誤呈現）。
  - 沿用面板既有欄位的 className/排版慣例。

- [ ] **步驟 5：跑確認 PASS** + `cd client && npm test && npm run build` 全綠。
- [ ] **步驟 6：Commit**
```bash
git add client/src/components/<該設定元件>.tsx client/src/lib/api.ts client/src/components/<測試檔>
git commit -m "feat(sandbox): 工作區設定可編輯工作目錄"
```

---

## 收尾驗證
- [ ] `cd server && npm test`（tsc + vitest 全綠，:memory: 隔離）
- [ ] `cd client && npm test && npm run build` 全綠
- [ ] 手動：新建工作區 → 確認 `data/workspaces/<id>/` 自動建立；在該工作區起一個 agent，請它 `pwd`/建一個檔，確認落在工作區目錄而非 server；工作區設定把工作目錄改成一個現有資料夾→ agent 操作該資料夾；嘗試設成 server 目錄→ 被擋 400。

## 自檢結果
- **規格覆蓋**：§3.1→任務1、§3.2→任務2、§3.4→任務3、§3.3→任務4、§3.5→任務5、§5 測試→各任務內含。✅
- **占位符**：無 TODO；每步含實際代碼/指令。前端任務因元件位置需 grep 定位，已在步驟 1 明確指示定位方式 + 核心斷言（非占位）。
- **型別一致**：`Workspace.workingDir`、`updateWorkspace` Pick 加 workingDir、`resolveWorkspaceDir/ensureWorkspaceDir/validateWorkingDir` 簽名、`AgentSession` 第 6 參數 cwd、`ensureWorkspaceDir(ws)` 回傳傳入建構子——跨任務一致。✅
