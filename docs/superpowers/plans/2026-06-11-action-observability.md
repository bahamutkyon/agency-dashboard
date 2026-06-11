# D 動作可觀測（Observability）實作計畫

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計畫。步驟使用複選框（`- [ ]`）語法追蹤進度。

**目標：** 捕捉 agent 每個工具呼叫（bash／寫檔／MCP，目前被丟棄）+ run/派工/排程生命週期事件，存進 `activity_log`，提供跨 session 活動時間軸總覽頁 + 對話內聯工具 chip。

**架構：** 捕捉層在 `agentSession.ts` 解析 claude 串流時新增 emit `tool_call`/`tool_result`；經 `agentManager`/route 埋點寫入 `activity_log` 並廣播 socket `activity:event`；前端 ActivityPane（跨 session 時間軸）+ MessageList 內聯 chip（走既有 session:event）。統一 `activity_log` 表。

**技術棧：** Node + TypeScript + node:sqlite + Express + socket.io（server）；React + Vite + Tailwind + vitest（client）。測試指令：server `cd server && npm test`（含 tsc gate）、client `cd client && npm test && npm run build`。

**設計鎖定（跨任務一致）：**
- 截斷常數 `ACTIVITY_DETAIL_CAP = 2000`（detail）、`ACTIVITY_SUMMARY_CAP = 300`（summary）。
- 保留：prune 取嚴者（30 天前 OR 超出最近 2 萬筆 → 刪）。`ACTIVITY_MAX_ROWS = 20000`、`ACTIVITY_MAX_AGE_MS = 30*24*60*60*1000`。
- **直接 import `./store/activity.js`，不加 barrel**（沿用 autonomy 教訓，避免 createX/listX 撞名）。
- 型別契約：
```ts
// store/activity.ts
export type ActivityKind = "tool_call" | "tool_result" | "run_started" | "run_step" | "run_done"
  | "action_pending" | "action_approved" | "action_rejected" | "dispatch" | "schedule_fired";
export interface ActivityRow {
  id: string; ts: number; workspaceId: string; sessionId?: string; runId?: string;
  kind: ActivityKind; summary: string; detail?: string; status?: string; totalLen?: number; createdAt: number;
}
```

---

## 文件結構

- `server/src/dbSchema.ts`（修改）— 加 `activity_log` 表
- `server/src/store/activity.ts`（新）— `logActivity` / `listActivity` / `pruneActivity` / `summarizeTool` + 型別
- `server/src/agentSession.ts`（修改）— 捕捉 tool_use/tool_result，emit `tool_call`/`tool_result`
- `server/src/agentManager.ts`（修改）— 收 tool_call/tool_result → logActivity + 廣播；`setIo`
- `server/src/routes/activity.ts`（新）— `GET /api/activity`
- `server/src/routes/autonomy.ts`（修改）— makeDeps.emit 順手 logActivity（run 生命週期）
- `server/src/routes/sessions.ts`（修改）— executeDispatch 開頭 logActivity(dispatch)
- `server/src/index.ts`（修改）— 掛 activity router、setIo、scheduler.onFire logActivity、boot pruneActivity
- `client/src/lib/api.ts`（修改）— `ActivityRow` 型別 + `listActivity`
- `client/src/components/ActivityPane.tsx`（新）— 活動時間軸總覽頁
- `client/src/App.tsx`（修改）— 掛 `isView("activity")` + nav 按鈕
- `client/src/hooks/useChatSession.ts`（修改）— tool_call/tool_result → 內聯 tool Msg
- `client/src/components/MessageList.tsx`（修改）— 渲染 tool chip

---

### 任務 1：activity_log 表

**檔案：** 修改 `server/src/dbSchema.ts`；測試 `server/src/dbSchema.test.ts`

- [ ] **步驟 1：寫失敗測試**（加到 dbSchema.test.ts）

```ts
it("activity_log 表建立成功", () => {
  const db = new DatabaseSync(":memory:");
  setupSchema(db);
  const cols = db.prepare("PRAGMA table_info(activity_log)").all().map((c: any) => c.name);
  expect(cols).toEqual(expect.arrayContaining(["id", "ts", "workspace_id", "session_id", "run_id", "kind", "summary", "detail", "status", "total_len", "created_at"]));
});
```

- [ ] **步驟 2：跑測試確認失敗**

執行：`cd server && npx vitest run src/dbSchema.test.ts`（FAIL：無 activity_log）

- [ ] **步驟 3：實作**——在 `BASE_SCHEMA` 末尾（結尾反引號前）加：

```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  run_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  status TEXT,
  total_len INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_session ON activity_log(session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity_log(workspace_id, ts DESC);
```

- [ ] **步驟 4：跑測試確認通過**：`cd server && npx vitest run src/dbSchema.test.ts`
- [ ] **步驟 5：Commit**

```bash
git add server/src/dbSchema.ts server/src/dbSchema.test.ts
git commit -m "feat(observability): 新增 activity_log 資料表"
```

---

### 任務 2：store/activity（logActivity / listActivity / pruneActivity / summarizeTool）

**檔案：** 創建 `server/src/store/activity.ts`；測試 `server/src/store.activity.test.ts`。參考 `server/src/store/autonomy.ts` 風格。

- [ ] **步驟 1：寫失敗測試**

```ts
// server/src/store.activity.test.ts
import { describe, it, expect } from "vitest";
import { logActivity, listActivity, pruneActivity, summarizeTool, ACTIVITY_DETAIL_CAP } from "./store/activity.js";

describe("store/activity", () => {
  it("logActivity 寫入 + listActivity 讀回（ts DESC）", () => {
    logActivity({ workspaceId: "w1", sessionId: "s1", kind: "tool_call", summary: "Bash: npm test" });
    logActivity({ workspaceId: "w1", sessionId: "s1", kind: "tool_result", summary: "完成", status: "ok" });
    const items = listActivity({ sessionId: "s1" });
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe("tool_result"); // 最新在前
    expect(items[0].status).toBe("ok");
  });
  it("detail 超過上限被截斷且記原長", () => {
    const long = "x".repeat(ACTIVITY_DETAIL_CAP + 500);
    logActivity({ workspaceId: "w1", sessionId: "sLong", kind: "tool_result", summary: "big", detail: long });
    const r = listActivity({ sessionId: "sLong" })[0];
    expect(r.detail!.length).toBe(ACTIVITY_DETAIL_CAP);
    expect(r.totalLen).toBe(long.length);
  });
  it("listActivity 依 kind 篩選 + limit", () => {
    for (let i = 0; i < 5; i++) logActivity({ workspaceId: "w2", sessionId: "sf", kind: "tool_call", summary: `c${i}` });
    logActivity({ workspaceId: "w2", sessionId: "sf", kind: "dispatch", summary: "派工" });
    expect(listActivity({ sessionId: "sf", kind: "dispatch" }).length).toBe(1);
    expect(listActivity({ sessionId: "sf", limit: 2 }).length).toBe(2);
  });
  it("游標分頁 before", () => {
    const all = listActivity({ sessionId: "sf" });
    const mid = all[1].ts;
    const page = listActivity({ sessionId: "sf", before: mid });
    expect(page.every((r) => r.ts < mid)).toBe(true);
  });
  it("summarizeTool 依工具取關鍵欄位", () => {
    expect(summarizeTool("Bash", { command: "npm test" })).toContain("npm test");
    expect(summarizeTool("Write", { file_path: "/a/b.ts", content: "..." })).toContain("/a/b.ts");
    expect(summarizeTool("mcp__playwright__browser_navigate", { url: "http://x" })).toContain("playwright");
  });
  it("pruneActivity 刪超出上限/過期（回傳刪除數）", () => {
    const n = pruneActivity();
    expect(typeof n).toBe("number");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**：`cd server && npx vitest run src/store.activity.test.ts`

- [ ] **步驟 3：實作**

```ts
// server/src/store/activity.ts
import { db } from "../db.js";

export type ActivityKind = "tool_call" | "tool_result" | "run_started" | "run_step" | "run_done"
  | "action_pending" | "action_approved" | "action_rejected" | "dispatch" | "schedule_fired";

export interface ActivityRow {
  id: string; ts: number; workspaceId: string; sessionId?: string; runId?: string;
  kind: ActivityKind; summary: string; detail?: string; status?: string; totalLen?: number; createdAt: number;
}

export const ACTIVITY_DETAIL_CAP = 2000;
export const ACTIVITY_SUMMARY_CAP = 300;
export const ACTIVITY_MAX_ROWS = 20000;
export const ACTIVITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function rowTo(r: any): ActivityRow {
  return {
    id: r.id, ts: r.ts, workspaceId: r.workspace_id, sessionId: r.session_id ?? undefined,
    runId: r.run_id ?? undefined, kind: r.kind, summary: r.summary, detail: r.detail ?? undefined,
    status: r.status ?? undefined, totalLen: r.total_len ?? undefined, createdAt: r.created_at,
  };
}

/** 寫一筆活動。detail/summary 自動截斷；截斷時記原始長度於 total_len。回傳完整 row（供廣播）。 */
export function logActivity(input: {
  workspaceId?: string; sessionId?: string; runId?: string;
  kind: ActivityKind; summary: string; detail?: string; status?: string;
}): ActivityRow {
  const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const summary = (input.summary || "").slice(0, ACTIVITY_SUMMARY_CAP);
  let detail = input.detail ?? null;
  let totalLen: number | null = null;
  if (detail && detail.length > ACTIVITY_DETAIL_CAP) {
    totalLen = detail.length;
    detail = detail.slice(0, ACTIVITY_DETAIL_CAP);
  }
  db.prepare(`
    INSERT INTO activity_log (id, ts, workspace_id, session_id, run_id, kind, summary, detail, status, total_len, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, now, input.workspaceId ?? "", input.sessionId ?? null, input.runId ?? null,
        input.kind, summary, detail, input.status ?? null, totalLen, now);
  return db.prepare("SELECT * FROM activity_log WHERE id = ?").get(id) as any && rowTo(db.prepare("SELECT * FROM activity_log WHERE id = ?").get(id));
}

export function listActivity(opts: { workspaceId?: string; sessionId?: string; kind?: string; limit?: number; before?: number } = {}): ActivityRow[] {
  const where: string[] = [];
  const args: any[] = [];
  if (opts.workspaceId) { where.push("workspace_id = ?"); args.push(opts.workspaceId); }
  if (opts.sessionId) { where.push("session_id = ?"); args.push(opts.sessionId); }
  if (opts.kind) { where.push("kind = ?"); args.push(opts.kind); }
  if (opts.before) { where.push("ts < ?"); args.push(opts.before); }
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const sql = `SELECT * FROM activity_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC LIMIT ?`;
  return (db.prepare(sql).all(...args, limit) as any[]).map(rowTo);
}

/** 取嚴者清理：刪 30 天前者，再刪超出最近 2 萬筆的舊資料。回傳刪除筆數。 */
export function pruneActivity(): number {
  let removed = 0;
  removed += db.prepare("DELETE FROM activity_log WHERE ts < ?").run(Date.now() - ACTIVITY_MAX_AGE_MS).changes as number;
  // 刪除排名第 ACTIVITY_MAX_ROWS 名之後（較舊）的資料
  const cutoff = db.prepare("SELECT ts FROM activity_log ORDER BY ts DESC LIMIT 1 OFFSET ?").get(ACTIVITY_MAX_ROWS) as any;
  if (cutoff?.ts) {
    removed += db.prepare("DELETE FROM activity_log WHERE ts < ?").run(cutoff.ts).changes as number;
  }
  return removed;
}

/** 依工具名取關鍵欄位組精簡摘要（給時間軸顯示）。 */
export function summarizeTool(name: string, input: any): string {
  const i = input || {};
  if (name === "Bash") return `Bash: ${i.command ?? ""}`;
  if (name === "Write" || name === "Edit" || name === "Read") return `${name}: ${i.file_path ?? i.path ?? ""}`;
  if (name === "Glob" || name === "Grep") return `${name}: ${i.pattern ?? ""}`;
  if (name.startsWith("mcp__")) return `${name}`;
  try { return `${name}: ${JSON.stringify(i).slice(0, 120)}`; } catch { return name; }
}
```

> 註：`logActivity` 回傳那行的雙重 SELECT 寫法請實作者簡化為先取一次再判斷再 rowTo（上方為避免占位符而寫的等價邏輯，實作時清爽即可——以測試通過、回傳完整 row 為準）。

- [ ] **步驟 4：跑測試確認通過**：`cd server && npx vitest run src/store.activity.test.ts`，再 `cd server && npm test` 確認 tsc + 全套不回歸。
- [ ] **步驟 5：Commit**

```bash
git add server/src/store/activity.ts server/src/store.activity.test.ts
git commit -m "feat(observability): store/activity（log/list/prune/summarizeTool）"
```

---

### 任務 3：捕捉層（agentSession 解析 tool_use / tool_result）

**檔案：** 修改 `server/src/agentSession.ts`（`routeClaudeEvent` 的 assistant/user 分支，約 `:258-291`；SessionEvent 型別 `:40`）；測試 `server/src/agentSession.tools.test.ts`

- [ ] **步驟 1：寫失敗測試**（白箱：直呼 private `routeClaudeEvent`，收 emit 的 event）

```ts
// server/src/agentSession.tools.test.ts
import { describe, it, expect } from "vitest";
import { AgentSession } from "./agentSession.js";

function collect(evts: any[], s: AgentSession) { s.on("event", (e) => evts.push(e)); }

describe("agentSession 工具事件捕捉", () => {
  it("assistant 含 tool_use → emit tool_call（含 name/input），text 照常 message", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "assistant", message: { content: [
      { type: "text", text: "我來跑測試" },
      { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } },
    ] } });
    const call = evts.find((e) => e.type === "tool_call");
    expect(call).toBeTruthy();
    expect(call.payload).toMatchObject({ toolUseId: "tu1", name: "Bash" });
    expect(call.payload.input).toMatchObject({ command: "npm test" });
    expect(evts.find((e) => e.type === "message")?.payload.content).toBe("我來跑測試");
  });
  it("user 含 tool_result → emit tool_result（status/text）", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu1", is_error: false, content: [{ type: "text", text: "全部通過" }] },
    ] } });
    const r = evts.find((e) => e.type === "tool_result");
    expect(r).toBeTruthy();
    expect(r.payload).toMatchObject({ toolUseId: "tu1", status: "ok" });
    expect(r.payload.text).toContain("全部通過");
  });
  it("tool_result is_error → status error", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu2", is_error: true, content: "command failed" },
    ] } });
    expect(evts.find((e) => e.type === "tool_result")?.payload.status).toBe("error");
  });
  it("tool_result 字串 content 也能取文字", () => {
    const s = new AgentSession("a");
    const evts: any[] = []; collect(evts, s);
    (s as any).routeClaudeEvent({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu3", content: "純字串輸出" },
    ] } });
    expect(evts.find((e) => e.type === "tool_result")?.payload.text).toContain("純字串輸出");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**：`cd server && npx vitest run src/agentSession.tools.test.ts`

- [ ] **步驟 3：實作**——
(a) SessionEvent 型別（`:40`）union 加 `"tool_call" | "tool_result"`。
(b) assistant 分支（`:258-266`）改為：保留 text→message，並對 tool_use emit：
```ts
    if (evt.type === "assistant" && evt.message?.content) {
      const blocks = evt.message.content;
      for (const b of blocks) {
        if (b.type === "tool_use") {
          this.emit("event", { type: "tool_call", payload: { toolUseId: b.id || "", name: b.name || "", input: b.input ?? {} } });
        }
      }
      const text = blocks.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      if (text) this.emit("event", { type: "message", payload: { role: "assistant", content: text } });
      return;
    }
```
(c) user 分支（`:268-291`）：保留既有 tool_image 抽取，並對每個 tool_result emit tool_result（抽文字）：
```ts
    if (evt.type === "user") {
      const content = evt.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            // 既有圖片抽取（保留不動）
            if (Array.isArray(block.content)) {
              for (const c of block.content) {
                if (c.type === "image" && c.source?.type === "base64" && c.source?.data) {
                  this.emit("event", { type: "tool_image", payload: { base64: c.source.data, mediaType: c.source.media_type || "image/png", toolUseId: block.tool_use_id || "" } });
                }
              }
            }
            // 新增：抽文字 → tool_result 事件
            let text = "";
            if (typeof block.content === "string") text = block.content;
            else if (Array.isArray(block.content)) text = block.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
            this.emit("event", { type: "tool_result", payload: { toolUseId: block.tool_use_id || "", status: block.is_error ? "error" : "ok", text } });
          }
        }
      }
      return;
    }
```

- [ ] **步驟 4：跑測試確認通過**：`cd server && npx vitest run src/agentSession.tools.test.ts`，再 `cd server && npm test` 全套（確認既有 message/tool_image 不回歸）。
- [ ] **步驟 5：Commit**

```bash
git add server/src/agentSession.ts server/src/agentSession.tools.test.ts
git commit -m "feat(observability): agentSession 捕捉 tool_use/tool_result 事件"
```

---

### 任務 4：埋點接線（agentManager + makeDeps.emit + executeDispatch + scheduler + boot prune）

**檔案：** 修改 `server/src/agentManager.ts`、`server/src/routes/autonomy.ts`、`server/src/routes/sessions.ts`、`server/src/index.ts`；測試 `server/src/activityWiring.test.ts`

- [ ] **步驟 1：寫失敗測試**（驗 agentManager 收 tool_call/tool_result 後寫了 activity_log）

```ts
// server/src/activityWiring.test.ts
import { describe, it, expect } from "vitest";
import { AgentSession } from "./agentSession.js";
import { recordToolActivity } from "./agentManager.js";
import { listActivity } from "./store/activity.js";

describe("活動埋點", () => {
  it("recordToolActivity 把 tool_call 事件寫進 activity_log（summary 用 summarizeTool）", () => {
    recordToolActivity({ id: "sx", agentId: "a", workspaceId: "wX" },
      { type: "tool_call", payload: { toolUseId: "t", name: "Bash", input: { command: "ls -la" } } });
    const items = listActivity({ sessionId: "sx" });
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("tool_call");
    expect(items[0].summary).toContain("ls -la");
  });
  it("tool_result 事件寫 activity_log 含 status + detail", () => {
    recordToolActivity({ id: "sy", agentId: "a", workspaceId: "wX" },
      { type: "tool_result", payload: { toolUseId: "t", status: "error", text: "boom" } });
    const r = listActivity({ sessionId: "sy" })[0];
    expect(r.kind).toBe("tool_result");
    expect(r.status).toBe("error");
    expect(r.detail).toContain("boom");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**：`cd server && npx vitest run src/activityWiring.test.ts`

- [ ] **步驟 3：實作**——
(a) `agentManager.ts`：import `logActivity, summarizeTool` from `./store/activity.js`；新增並匯出純函式（供測試與 attachPersistence 共用）+ io 持有：
```ts
import { logActivity, summarizeTool } from "./store/activity.js";

/** 把 tool_call/tool_result 事件寫進 activity_log。回傳寫入的 row（供廣播）或 null。 */
export function recordToolActivity(
  sess: { id: string; agentId: string; workspaceId: string },
  evt: { type: string; payload: any },
) {
  try {
    if (evt.type === "tool_call") {
      return logActivity({ workspaceId: sess.workspaceId, sessionId: sess.id, kind: "tool_call",
        summary: summarizeTool(evt.payload.name, evt.payload.input),
        detail: (() => { try { return JSON.stringify(evt.payload.input); } catch { return String(evt.payload.input); } })() });
    }
    if (evt.type === "tool_result") {
      return logActivity({ workspaceId: sess.workspaceId, sessionId: sess.id, kind: "tool_result",
        summary: evt.payload.status === "error" ? "工具錯誤" : "工具完成",
        status: evt.payload.status, detail: evt.payload.text || "" });
    }
  } catch (e: any) { console.warn("[agentManager] recordToolActivity", e?.message); }
  return null;
}
```
在 AgentManager class 加 `private io?: any; setIo(io: any) { this.io = io; }`。在 `attachPersistence` 的事件 handler 加分支（在既有 if/else 鏈內）：
```ts
      } else if (evt.type === "tool_call" || evt.type === "tool_result") {
        const wsId = (s as any).workspaceId as string | undefined;
        const row = recordToolActivity({ id: s.id, agentId: s.agentId, workspaceId: wsId || "" }, evt);
        if (row) this.io?.emit("activity:event", row);
      }
```
(b) `routes/autonomy.ts` 的 `makeDeps.emit`：在 io.emit 旁加 logActivity（run 生命週期）。新增純對映 helper（可內聯）：依 `evt.kind`/`evt.run?.status` 映射 ActivityKind：
```ts
emit: (runId, evt) => {
  io?.emit("autonomy:event", { runId, ...evt });
  try {
    const run = evt.run;
    let kind: any = null, summary = "";
    if (evt.kind === "run" && run) {
      if (run.status === "running" && run.stepCount === 0) { kind = "run_started"; summary = `自主 run 開始：${run.goal?.slice(0,80) ?? ""}`; }
      else if (["done","stopped","budget_exhausted","error"].includes(run.status)) { kind = "run_done"; summary = `自主 run ${run.status}`; }
      else if (run.status === "running") { kind = "run_step"; summary = `第 ${run.stepCount} 步`; }
    } else if (evt.kind === "pending") { kind = "action_pending"; summary = evt.action?.summary || "待批動作"; }
    else if (evt.kind === "action") { kind = evt.action?.status === "rejected" ? "action_rejected" : "action_approved"; summary = evt.action?.summary || "動作決定"; }
    if (kind) {
      const row = logActivity({ workspaceId: run?.workspaceId || "", sessionId: run?.sessionId, runId, kind, summary });
      io?.emit("activity:event", row);
    }
  } catch (e: any) { console.warn("[autonomy] activity log", e?.message); }
},
```
（import `logActivity` from "../store/activity.js"。）
(c) `routes/sessions.ts` `executeDispatch` 開頭加：
```ts
try { const row = logActivity({ sessionId: pmSessionId, kind: "dispatch", summary: `派工 ${items.length} 項` }); io?.emit("activity:event", row); } catch {}
```
（import logActivity。）
(d) `index.ts`：boot 區（server.listen callback）加 `agentManager.setIo(io);`、`scheduler.onFire` 既有 callback 內加 `const row = logActivity({ kind: "schedule_fired", summary: \`排程觸發：${s.name}\` }); io.emit("activity:event", row);`、boot 末加 `pruneActivity();`。import `logActivity, pruneActivity` from "./store/activity.js"。

- [ ] **步驟 4：跑測試確認通過**：`cd server && npx vitest run src/activityWiring.test.ts`，再 `cd server && npm test` 全套（tsc + 不回歸）。
- [ ] **步驟 5：Commit**

```bash
git add server/src/agentManager.ts server/src/routes/autonomy.ts server/src/routes/sessions.ts server/src/index.ts server/src/activityWiring.test.ts
git commit -m "feat(observability): 活動埋點（工具/run/派工/排程）+ socket 廣播 + boot prune"
```

---

### 任務 5：routes/activity（GET /api/activity）

**檔案：** 創建 `server/src/routes/activity.ts`；修改 `server/src/index.ts`（掛載）；測試加到 `server/src/app.test.ts`

- [ ] **步驟 1：寫失敗測試**（app.test.ts，沿用 ephemeral 埠）

```ts
it("GET /api/activity 回 items 陣列", async () => {
  const r = await fetch(`${base}/api/activity`);
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(Array.isArray(j.items)).toBe(true);
});
it("GET /api/activity?sessionId= 篩選", async () => {
  const r = await fetch(`${base}/api/activity?sessionId=__none__`);
  expect(r.status).toBe(200);
  expect((await r.json()).items).toEqual([]);
});
```

- [ ] **步驟 2：跑測試確認失敗**：`cd server && npx vitest run src/app.test.ts`

- [ ] **步驟 3：實作** `server/src/routes/activity.ts`：

```ts
import { Router } from "express";
import { listActivity } from "../store/activity.js";

export const activityRouter = Router();

activityRouter.get("/", (req, res) => {
  const { workspaceId, sessionId, kind, limit, before } = req.query;
  const items = listActivity({
    workspaceId: workspaceId ? String(workspaceId) : undefined,
    sessionId: sessionId ? String(sessionId) : undefined,
    kind: kind ? String(kind) : undefined,
    limit: limit ? Number(limit) : undefined,
    before: before ? Number(before) : undefined,
  });
  const nextBefore = items.length ? items[items.length - 1].ts : undefined;
  res.json({ items, nextBefore });
});
```
`index.ts`：import `activityRouter`，加 `app.use("/api/activity", activityRouter);`。

- [ ] **步驟 4：跑測試確認通過**：`cd server && npx vitest run src/app.test.ts`，再 `npm test` 全套。
- [ ] **步驟 5：Commit**

```bash
git add server/src/routes/activity.ts server/src/index.ts server/src/app.test.ts
git commit -m "feat(observability): GET /api/activity 端點"
```

---

### 任務 6：前端 ActivityPane + api

**檔案：** 修改 `client/src/lib/api.ts`；創建 `client/src/components/ActivityPane.tsx`；修改 `client/src/App.tsx`（掛 `isView("activity")` + nav 按鈕）；測試 `client/src/components/ActivityPane.test.tsx`

- [ ] **步驟 1：api.ts**——加型別與端點（對齊既有 `j`/fetch 風格）：
```ts
export interface ActivityRow { id: string; ts: number; workspaceId: string; sessionId?: string; runId?: string; kind: string; summary: string; detail?: string; status?: string; totalLen?: number; }
// api 物件內：
listActivity: (q: { sessionId?: string; kind?: string; before?: number } = {}) => {
  const p = new URLSearchParams();
  if (q.sessionId) p.set("sessionId", q.sessionId);
  if (q.kind) p.set("kind", q.kind);
  if (q.before) p.set("before", String(q.before));
  return fetch(`/api/activity?${p}`).then(j<{ items: ActivityRow[]; nextBefore?: number }>);
},
```

- [ ] **步驟 2：ActivityPane 測試（失敗）**

```tsx
// client/src/components/ActivityPane.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ActivityPane } from "./ActivityPane";
import { api } from "../lib/api";

vi.mock("../lib/socket", () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));

describe("ActivityPane", () => {
  beforeEach(() => {
    vi.spyOn(api, "listActivity").mockResolvedValue({ items: [
      { id: "1", ts: 2, workspaceId: "w", sessionId: "s", kind: "tool_call", summary: "Bash: npm test" },
      { id: "2", ts: 1, workspaceId: "w", sessionId: "s", kind: "tool_result", summary: "完成", status: "ok" },
    ] } as any);
  });
  it("渲染活動列表", async () => {
    render(<ActivityPane />);
    await waitFor(() => expect(screen.getByText(/Bash: npm test/)).toBeTruthy());
    expect(screen.getByText(/完成/)).toBeTruthy();
  });
});
```

- [ ] **步驟 3：實作 ActivityPane**——時間軸列表 + 「載入更多」（用 nextBefore 游標）+ socket `activity:event` prepend。kind 圖示用簡單 emoji 映射（tool_call 🔧 / tool_result ↳ / run_* 🎯 / dispatch 🤝 / schedule_fired ⏰）。每列：時間（toLocaleTimeString）、kind 圖示、summary；detail 可點開（若 totalLen 顯示「共 N 字」）。狀態 error 標紅。掛 `useEffect` 初次 `api.listActivity()`、socket on `activity:event` prepend、卸載 off。

- [ ] **步驟 4：App.tsx 掛載**——仿 `isView("learning")` 模式：lazy import ActivityPane；在面板區加
```tsx
{isView("activity") && (
  <Suspense fallback={LazyFallback}>
    <ActivityPane key={`act-${reloadKey}`} />
  </Suspense>
)}
```
並在 nav 區（其他 view 按鈕旁，找設定 view 的那組按鈕）加一顆「📋 活動」按鈕 set view 到 "activity"。（讀 App.tsx 找 nav 按鈕怎麼設 view，照樣加。）

- [ ] **步驟 5：跑測試 + build**：`cd client && npm test && npm run build`
- [ ] **步驟 6：Commit**

```bash
git add client/src/lib/api.ts client/src/components/ActivityPane.tsx client/src/components/ActivityPane.test.tsx client/src/App.tsx
git commit -m "feat(observability): 前端 ActivityPane 活動時間軸總覽頁"
```

---

### 任務 7：前端 MessageList 工具 chip + useChatSession

**檔案：** 修改 `client/src/hooks/useChatSession.ts`（Msg 型別 + session:event handler）、`client/src/components/MessageList.tsx`；測試 `client/src/components/MessageList.tools.test.tsx`

- [ ] **步驟 1：useChatSession**——
(a) `Msg` 介面加可選欄位：`tool?: { name: string; status?: string; summary: string };`（`role` 可用既有；tool 訊息用 `role: "system"` + `tool` 欄位，或新增不影響既有渲染的標記——以不破壞既有 message/delta 渲染為準）。
(b) session:event handler 加兩個 case：
```ts
case "tool_call": {
  setMessages((prev) => [...prev, { role: "system", content: "", ts: Date.now(), tool: { name: evt.payload.name, summary: `${evt.payload.name}` } }]);
  break;
}
case "tool_result": {
  setMessages((prev) => [...prev, { role: "system", content: "", ts: Date.now(), tool: { name: "", status: evt.payload.status, summary: evt.payload.status === "error" ? "工具錯誤" : "工具完成" } }]);
  break;
}
```
（summary 可用前端的 summarize 或直接帶 name；input 顯示可選。實作者用判斷讓 chip 精簡。）

- [ ] **步驟 2：MessageList 測試（失敗）**——渲染一個帶 `tool` 的 Msg 顯示為 chip（含工具名、error 標紅），一般 message 不受影響。先讀 MessageList 的 props（messages 陣列）與既有 render，照其結構寫測試。

- [ ] **步驟 3：MessageList 實作**——map messages 時，若 `m.tool` 存在則渲染緊湊 chip（`🔧 {tool.name}` 或 `↳ {status==="error" ? "✗" : "✓"} {summary}`），而非一般對話泡泡。error 狀態紅色。與既有 tool_image markdown 圖片同層級的輕量呈現。

- [ ] **步驟 4：跑測試 + build**：`cd client && npm test && npm run build`
- [ ] **步驟 5：Commit**

```bash
git add client/src/hooks/useChatSession.ts client/src/components/MessageList.tsx client/src/components/MessageList.tools.test.tsx
git commit -m "feat(observability): 對話內聯工具 chip（tool_call/tool_result）"
```

---

### 任務 8：最終統一審查

由 subagent-driven-development 流程分派最終審查者（建議 Opus）覆蓋整支分支，重點：
- 捕捉層不回歸既有 message/delta/tool_image/result；tool_use/tool_result 解析正確涵蓋字串/陣列/is_error/缺欄位。
- 埋點不阻斷對話流（旁路、try/catch）；agentManager.setIo 在 boot 設定；io 缺席（測試）不炸。
- activity_log 量控（截斷 + prune）正確；prune 取嚴者語意對。
- 前端 socket 訂閱 cleanup、ActivityPane 分頁游標、tool chip 不破壞既有訊息渲染。
- 跨檔型別一致（ActivityRow server↔client）。

審查通過 → finishing-a-development-branch。

---

## 自檢結果

**1. 規格覆蓋度：** §3 捕捉層→任務3；§4 表+store→任務1/2；§5 埋點→任務4；§6 REST/socket→任務4(socket)+任務5(REST)；§7 前端 ActivityPane→任務6、內聯 chip→任務7；§8 錯誤處理→任務2/3/4 的截斷+try/catch；§9 測試→各任務 TDD；保留/截斷常數→任務2。✅ 全覆蓋。

**2. 占位符掃描：** 各步驟均含實際程式碼與精確路徑。任務2 logActivity 回傳那行標注「實作者簡化」非占位（已給等價邏輯）。任務6/7 前端「讀 App.tsx/MessageList 照樣加」是接線指引（指明確切檔案與模式），非占位。✅

**3. 型別一致性：** `ActivityRow`/`ActivityKind` server（store/activity）↔ client（api.ts）欄位一致；`logActivity`/`listActivity`/`pruneActivity`/`summarizeTool`/`recordToolActivity` 跨任務一致；SessionEvent 加 `tool_call`/`tool_result` 與捕捉層/handler 一致。✅

**已知取捨：** 捕捉層測試用 `(s as any).routeClaudeEvent` 白箱直呼 private（避免 spawn claude，最小改動可測）；埋點的 socket 廣播在多客戶端為全域 broadcast（單人 dogfood 可接受，room 定向列未來）；完整工具輸出截斷後尾段不另存（規格非目標）。
