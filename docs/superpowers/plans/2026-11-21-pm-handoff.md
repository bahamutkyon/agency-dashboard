# 專案經理一句話交接 實作計畫

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 使用者說「交接」→ 專案經理寫完整交接單 → 自動開新對話帶入並切過去；對話過長時提示交接。

**架構：** PM 回覆中的 `=== HANDOFF ===` 區塊由 `agentManager` 偵測（同 GOAL_UPDATE gate），透過註冊式 handler 交給 `handoffService.performHandoff`（避免 agentManager ↔ routes 循環 import）。交接單存在來源場次 `sessions.handoff_doc`，`buildHandoff` 優先採用。前端收 `session:handoff` 切換分頁；過長提示是純前端判斷。

**技術棧：** Node 24 + TypeScript + node:sqlite + Express + socket.io；React + Vite + vitest + Testing Library。

**規格：** `docs/superpowers/specs/2026-11-21-pm-handoff-design.md`
**分支：** `feat/pm-handoff`（已建立）

**驗證指令：**
- server：`cd server && npx tsc --noEmit && npx vitest run`
- client：`cd client && npx tsc -b && npx vitest run`

**規格調整（寫計畫時發現）：** 過長提示的「字數」改在前端用已載入的 `messages` 計算，不改 session 列表 API；側欄只用則數判斷。

---

## 檔案結構

| 檔案 | 動作 | 職責 |
|---|---|---|
| `server/src/handoffParser.ts` | 新增 | 從文字解析 HANDOFF 區塊、截斷 |
| `server/src/store/sessionState.ts` | 修改 | `handoff_doc`／`handed_off_to` 讀寫 |
| `server/src/dbSchema.ts` | 修改 | 加兩欄遷移 |
| `server/src/sessionHandoff.ts` | 修改 | `buildHandoff` 優先 doc；prompt 區塊 doc 版 |
| `server/src/sessionDigest.ts` | 修改 | export `AUTOMATED`（handoff gate 共用） |
| `server/src/handoffService.ts` | 新增 | `performHandoff`：存單、開新對話、標舊對話、防重、emit |
| `server/src/agentManager.ts` | 修改 | `registerHandoffHandler` + 偵測 gate |
| `server/src/routes/sessions.ts` | 修改 | 抽 `startOrchestratorWithHandoff`、註冊 handler、GET 回 handedOffTo、PUT 編輯、PM 手冊加交接段 |
| `client/src/lib/handoffNudge.ts` | 新增 | `shouldNudge`、`handoffSwitchTarget` |
| `client/src/lib/api.ts` | 修改 | 型別 + `updateSessionHandoff` |
| `client/src/components/HandoffCard.tsx` | 修改 | doc 顯示、編輯、已交接連結 |
| `client/src/components/HandoffBar.tsx` | 新增 | 「🔁 交接」鈕＋過長提示條＋失敗提示 |
| `client/src/components/ChatWindow.tsx` | 修改 | 掛 HandoffBar |
| `client/src/App.tsx` | 修改 | `session:handoff` 監聽切換 |
| `client/src/components/AgentSidebar.tsx` | 修改 | 150 則提示改用 `shouldNudge` |

## 模型分派（給使用者看過再派）

| 任務 | 模型 | 理由 |
|---|---|---|
| 1 解析器、2 DB 欄位 | Haiku | 機械、隔離 |
| 3 buildHandoff、4 handoffService | Sonnet | 中等邏輯、要讀既有模組 |
| 5 接線（agentManager／routes） | Sonnet | 動 session 核心，但改動範圍小且有測試 |
| 6 前端 lib + api、7 前端元件 | Sonnet | 中等整合 |
| 8 最終審查 | Opus | 高風險面：核心 message handler、防重、prompt 注入 |
| 9 實機 e2e | controller（我） | 需要打 live server |

---

### 任務 1：HANDOFF 解析器

**檔案：**
- 創建：`server/src/handoffParser.ts`
- 測試：`server/src/handoffParser.test.ts`

- [ ] **步驟 1：寫失敗測試**

```ts
// server/src/handoffParser.test.ts
import { describe, it, expect } from "vitest";
import { parseHandoff, HANDOFF_MAX } from "./handoffParser.js";

const wrap = (body: string) => `前言\n=== HANDOFF ===\n${body}\n=== END HANDOFF ===\n結尾`;

describe("parseHandoff", () => {
  it("取出區塊內文並 trim", () => {
    expect(parseHandoff(wrap("  🎯 目標：定價\n✅ 已決定：不走 FBA  "))).toBe("🎯 目標：定價\n✅ 已決定：不走 FBA");
  });
  it("沒有區塊 → null", () => {
    expect(parseHandoff("普通回覆")).toBeNull();
  });
  it("空區塊 → null", () => {
    expect(parseHandoff(wrap("   \n  "))).toBeNull();
  });
  it("多個區塊取最後一個", () => {
    expect(parseHandoff(wrap("舊版") + "\n" + wrap("新版"))).toBe("新版");
  });
  it("超過上限以字元截斷並標註", () => {
    const out = parseHandoff(wrap("字".repeat(HANDOFF_MAX + 50)))!;
    expect([...out].length).toBe(HANDOFF_MAX + "…（已截斷）".length);
    expect(out.endsWith("…（已截斷）")).toBe(true);
  });
  it("emoji 不會被切成半個字元", () => {
    const out = parseHandoff(wrap("😀".repeat(HANDOFF_MAX + 1)))!;
    expect(out.startsWith("😀".repeat(HANDOFF_MAX))).toBe(true);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

`cd server && npx vitest run src/handoffParser.test.ts` → FAIL（找不到模組）

- [ ] **步驟 3：實作**

```ts
// server/src/handoffParser.ts
/** 專案經理交接單：=== HANDOFF === … === END HANDOFF ===。多個取最後一個；以字元（code point）截斷。 */
export const HANDOFF_MAX = 2000;
const TRUNC_MARK = "…（已截斷）";
const RE = /=== HANDOFF ===\s*\n([\s\S]*?)\n=== END HANDOFF ===/g;

export function capHandoff(text: string): string {
  const chars = [...text.trim()];
  return chars.length > HANDOFF_MAX ? chars.slice(0, HANDOFF_MAX).join("") + TRUNC_MARK : chars.join("");
}

export function parseHandoff(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(RE)) last = m[1];
  if (last == null) return null;
  const body = last.trim();
  return body ? capHandoff(body) : null;
}
```

- [ ] **步驟 4：跑測試確認通過**（同上指令 → PASS）

- [ ] **步驟 5：Commit**

```bash
git add server/src/handoffParser.ts server/src/handoffParser.test.ts
git commit -m "feat(handoff): 交接單標記解析器"
```

---

### 任務 2：DB 欄位與存取

**檔案：**
- 修改：`server/src/dbSchema.ts`（約 485–488 行的 sessions 欄位遷移迴圈）
- 修改：`server/src/store/sessionState.ts`
- 測試：`server/src/store/sessionState.test.ts`（追加）

- [ ] **步驟 1：寫失敗測試**（追加到 `sessionState.test.ts` 檔尾，import 補 `setHandoffDoc, setHandedOffTo`）

```ts
describe("交接單欄位", () => {
  it("setHandoffDoc / setHandedOffTo 可讀回", () => {
    const id = mk();
    expect(getSessionState(id)!.handoffDoc).toBeNull();
    expect(getSessionState(id)!.handedOffTo).toBeNull();
    setHandoffDoc(id, "🎯 目標：x");
    setHandedOffTo(id, "new_1");
    expect(getSessionState(id)!.handoffDoc).toBe("🎯 目標：x");
    expect(getSessionState(id)!.handedOffTo).toBe("new_1");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**：`npx vitest run src/store/sessionState.test.ts` → FAIL

- [ ] **步驟 3：實作**

`dbSchema.ts` 遷移陣列加兩欄：
```ts
    for (const [col, type] of [["state", "TEXT"], ["state_source", "TEXT"], ["state_at", "INTEGER"],
      ["stopped_at", "TEXT"], ["digest_at", "INTEGER"], ["handoff_from", "TEXT"],
      ["handoff_doc", "TEXT"], ["handed_off_to", "TEXT"]] as const) {
```
同時檢查 `BASE_SCHEMA` 的 sessions `CREATE TABLE`（約第 40 行 `handoff_from TEXT,`）後面加 `handoff_doc TEXT, handed_off_to TEXT,`，讓新安裝一致。

`sessionState.ts`：
```ts
export interface SessionStateRow {
  state: SessionStateValue | null;
  stateSource: "manual" | "auto" | null;
  stateAt: number | null;
  stoppedAt: string | null;
  digestAt: number | null;
  handoffFrom: string | null;
  /** 這場被交接出去時，專案經理寫的完整交接單 */
  handoffDoc: string | null;
  /** 這場交接到的新對話 id */
  handedOffTo: string | null;
}

export function getSessionState(id: string): SessionStateRow | undefined {
  const r = db.prepare("SELECT state, state_source, state_at, stopped_at, digest_at, handoff_from, handoff_doc, handed_off_to FROM sessions WHERE id = ?").get(id) as any;
  if (!r) return undefined;
  return {
    state: r.state ?? null, stateSource: r.state_source ?? null, stateAt: r.state_at ?? null,
    stoppedAt: r.stopped_at ?? null, digestAt: r.digest_at ?? null, handoffFrom: r.handoff_from ?? null,
    handoffDoc: r.handoff_doc ?? null, handedOffTo: r.handed_off_to ?? null,
  };
}

export function setHandoffDoc(id: string, doc: string): void {
  db.prepare("UPDATE sessions SET handoff_doc = ? WHERE id = ?").run(doc, id);
}

export function setHandedOffTo(id: string, toId: string | null): void {
  db.prepare("UPDATE sessions SET handed_off_to = ? WHERE id = ?").run(toId, id);
}
```
注意：這兩個 setter **不可**碰 `updated_at`（11-17 教訓：改 updatedAt 會打亂「最近一場」排序）。

- [ ] **步驟 4：跑 `sessionState.test.ts` 與 `dbSchema.sessionState.test.ts` → PASS**

- [ ] **步驟 5：Commit**

```bash
git add server/src/dbSchema.ts server/src/store/sessionState.ts server/src/store/sessionState.test.ts
git commit -m "feat(handoff): sessions 加交接單與交接去向欄位"
```

---

### 任務 3：buildHandoff 優先採用交接單

**檔案：**
- 修改：`server/src/sessionHandoff.ts`
- 測試：`server/src/sessionHandoff.test.ts`（追加）

- [ ] **步驟 1：寫失敗測試**（import 補 `setHandoffDoc`）

```ts
describe("buildHandoff：完整交接單", () => {
  it("有交接單 → 優先於摘要，source=doc、內容完整", () => {
    const id = mk("長對話", [["user", "q"], ["assistant", "a"]]);
    setAutoDigest(id, "停在等拍照", "waiting_user", 10_000);
    const doc = "🎯 目標：定價\n✅ 已決定：不走 FBA\n" + "細節".repeat(400);
    setHandoffDoc(id, doc);
    expect(buildHandoff(id)).toMatchObject({ source: "doc", summary: doc, fromTitle: "長對話" });
  });
  it("有交接單但沒有任何專案經理回覆也能帶", () => {
    const id = mk("只有使用者", [["user", "q"]]);
    setHandoffDoc(id, "🎯 目標：x");
    expect(buildHandoff(id)?.source).toBe("doc");
  });
  it("doc 版注入段落：明說是交接單、已決定的不要重問", () => {
    const block = handoffPromptBlock({ fromId: "x", fromTitle: "長對話", summary: "🎯 目標：定價", source: "doc" });
    expect(block).toContain("交接單");
    expect(block).toContain("🎯 目標：定價");
    expect(block).toContain("不要重問");
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

- [ ] **步驟 3：實作**

```ts
// sessionHandoff.ts 修改處
export interface Handoff {
  fromId: string;
  fromTitle: string;
  summary: string;
  /** doc＝專案經理寫的完整交接單；digest＝閒置摘要；excerpt＝最後一則回覆節錄 */
  source: "doc" | "digest" | "excerpt";
}

export function buildHandoff(fromId: string): Handoff | null {
  const s = getSession(fromId);
  if (!s) return null;
  const st = getSessionState(fromId);
  if (st?.handoffDoc) return { fromId, fromTitle: s.title, summary: st.handoffDoc, source: "doc" };
  const msgs = s.messages || [];
  // …以下維持原本 digest / excerpt 邏輯不變
}

export function handoffPromptBlock(h: Handoff): string {
  if (h.source === "doc") {
    return `\n\n# 🔁 上一場交接單\n使用者從上一場專案經理對話「${h.fromTitle}」交接過來，以下是上一場的你寫給這一場的交接單：\n\n${h.summary}\n\n（「已決定」的事照辦、不要重問；「進行中」的事接著追；開場先用一兩句確認你接手了什麼，然後直接從「下一步」做起。）`;
  }
  return /* 原本內容不變 */;
}
```

- [ ] **步驟 4：跑 `sessionHandoff.test.ts` → 全部 PASS（含舊測試）**

- [ ] **步驟 5：Commit**

```bash
git add server/src/sessionHandoff.ts server/src/sessionHandoff.test.ts
git commit -m "feat(handoff): 新對話優先帶入完整交接單"
```

---

### 任務 4：handoffService.performHandoff

**檔案：**
- 創建：`server/src/handoffService.ts`
- 修改：`server/src/sessionDigest.ts`（`const AUTOMATED` → `export const AUTOMATED`）
- 測試：`server/src/handoffService.test.ts`

依賴注入：`start`（開新 PM 對話，回傳 id）、`stop`（停程序）、`emit`。測試用假函式，不打真 claude。

- [ ] **步驟 1：寫失敗測試**

```ts
// server/src/handoffService.test.ts
import { describe, it, expect, vi } from "vitest";
import { performHandoff, type HandoffDeps } from "./handoffService.js";
import { upsertSession, appendMessage, getSession } from "./store.js";
import { getSessionState } from "./store/sessionState.js";

let n = 0;
function mk(opts: { ws?: string; title?: string; projectId?: string } = {}): string {
  const id = `hs_${Date.now()}_${n++}`;
  upsertSession({ id, workspaceId: opts.ws ?? "w_hs", agentId: "agents-orchestrator", title: opts.title ?? "長對話", projectId: opts.projectId, createdAt: 1, updatedAt: 1, messages: [] } as any);
  appendMessage(id, { role: "user", content: "交接", ts: 100 });
  return id;
}
function deps(): HandoffDeps & { start: any; stop: any; emit: any } {
  return {
    start: vi.fn((_ws: string, _o: any) => { const id = mk({ title: "👨‍💼 專案經理" }); return id; }),
    stop: vi.fn(),
    emit: vi.fn(),
  };
}

describe("performHandoff", () => {
  it("存交接單、開新對話（同工作區/project、帶 handoffFrom）、舊對話標 done＋去向、emit", () => {
    const from = mk({ ws: "w_hs", projectId: "p1" });
    const d = deps();
    const r = performHandoff(from, "🎯 目標：x", d);
    expect(r.ok).toBe(true);
    expect(d.start).toHaveBeenCalledWith("w_hs", { projectId: "p1", handoffFrom: from });
    const st = getSessionState(from)!;
    expect(st.handoffDoc).toBe("🎯 目標：x");
    expect(st.handedOffTo).toBe(r.toId);
    expect(st.state).toBe("done");
    expect(st.stoppedAt).toBe("已交接到新對話");
    expect(d.emit).toHaveBeenCalledWith("session:handoff", { fromId: from, toId: r.toId, toTitle: "👨‍💼 專案經理" });
  });

  it("已交接過且新對話還在 → 只更新交接單、沿用同一場，不重開", () => {
    const from = mk();
    const d = deps();
    const first = performHandoff(from, "v1", d);
    const second = performHandoff(from, "v2", d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(second.toId).toBe(first.toId);
    expect(getSessionState(from)!.handoffDoc).toBe("v2");
    // 新對話還沒有使用者訊息 → 停掉程序，下一句話用新版交接單喚醒
    expect(d.stop).toHaveBeenCalledWith(first.toId);
  });

  it("沿用時新對話已開聊 → 不停程序", () => {
    const from = mk();
    const d = deps();
    const first = performHandoff(from, "v1", d);
    appendMessage(first.toId!, { role: "user", content: "開始", ts: 200 });
    performHandoff(from, "v2", d);
    expect(d.stop).not.toHaveBeenCalled();
  });

  it("開新對話失敗 → 交接單已存、舊對話不標 done、emit handoff_failed", () => {
    const from = mk();
    const d = deps();
    d.start = vi.fn(() => { throw new Error("spawn 失敗"); });
    const r = performHandoff(from, "v1", d);
    expect(r.ok).toBe(false);
    expect(getSessionState(from)!.handoffDoc).toBe("v1");
    expect(getSessionState(from)!.state).not.toBe("done");
    expect(d.emit).toHaveBeenCalledWith("session:handoff_failed", { fromId: from, error: "spawn 失敗" });
  });

  it("來源不存在 → ok:false，不呼叫 start", () => {
    const d = deps();
    expect(performHandoff("__none__", "x", d).ok).toBe(false);
    expect(d.start).not.toHaveBeenCalled();
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

- [ ] **步驟 3：實作**

```ts
// server/src/handoffService.ts
/**
 * 專案經理一句話交接：存交接單 → 開新 PM 對話（同工作區/project，帶入交接單）→ 舊對話標已交接。
 * 依賴注入（start/stop/emit），避免與 routes/agentManager 循環 import，也方便測試。
 */
import { getSession, DEFAULT_WORKSPACE_ID } from "./store.js";
import { getSessionState, setHandoffDoc, setHandedOffTo, setAutoDigest } from "./store/sessionState.js";

export interface HandoffDeps {
  start: (wsId: string, opts: { projectId?: string; handoffFrom: string }) => string;
  stop: (sessionId: string) => void;
  emit: (event: string, payload: unknown) => void;
}

export interface HandoffResult { ok: boolean; toId?: string; reused?: boolean; error?: string }

export function performHandoff(fromId: string, doc: string, deps: HandoffDeps): HandoffResult {
  const from = getSession(fromId);
  if (!from) return { ok: false, error: "來源對話不存在" };
  setHandoffDoc(fromId, doc);

  const prevTo = getSessionState(fromId)?.handedOffTo;
  const prev = prevTo ? getSession(prevTo) : undefined;
  if (prev) {
    const started = (prev.messages || []).some((m) => m.role === "user");
    if (!started) deps.stop(prev.id);
    deps.emit("session:handoff", { fromId, toId: prev.id, toTitle: prev.title });
    return { ok: true, toId: prev.id, reused: true };
  }

  let toId: string;
  try {
    toId = deps.start(from.workspaceId || DEFAULT_WORKSPACE_ID, { projectId: from.projectId || undefined, handoffFrom: fromId });
  } catch (e: any) {
    const error = String(e?.message || e);
    deps.emit("session:handoff_failed", { fromId, error });
    return { ok: false, error };
  }
  setHandedOffTo(fromId, toId);
  setAutoDigest(fromId, "已交接到新對話", "done");
  deps.emit("session:handoff", { fromId, toId, toTitle: getSession(toId)?.title ?? "" });
  return { ok: true, toId };
}
```
註：`setAutoDigest` 對使用者手動標記的狀態會保留（既有規則），stoppedAt 仍會更新，可接受。若 `SessionRecord` 沒有 `projectId` 欄位，先 `grep -n projectId server/src/store/sessions.ts` 確認 rowToSession 的欄位名再調整。

- [ ] **步驟 4：跑 `handoffService.test.ts` → PASS**

- [ ] **步驟 5：Commit**

```bash
git add server/src/handoffService.ts server/src/handoffService.test.ts server/src/sessionDigest.ts
git commit -m "feat(handoff): performHandoff 開新對話、標舊對話、防重"
```

---

### 任務 5：接線（agentManager 偵測、routes、PM 手冊、端點）

**檔案：**
- 修改：`server/src/agentManager.ts`（約 590 行旁加註冊函式；約 821 行 GOAL_UPDATE 區塊前加偵測）
- 修改：`server/src/routes/sessions.ts`（`POST /orchestrator` 約 399–415 行、handoff GET/DELETE 約 79–95 行、`buildDispatchGuide` 約 538 行「📦 成果報告」之後）
- 測試：`server/src/app.test.ts`（追加）、`server/src/agentManager.handoff.test.ts`（新增）

- [ ] **步驟 1：寫失敗測試**

`server/src/agentManager.handoff.test.ts` —— 測 gate 抽成的純函式：
```ts
import { describe, it, expect } from "vitest";
import { shouldDetectHandoff } from "./agentManager.js";

describe("shouldDetectHandoff", () => {
  it("只認專案經理＋有工作區＋非自動化場次", () => {
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "👨‍💼 專案經理" })).toBe(true);
    expect(shouldDetectHandoff({ agentId: "content-creator", workspaceId: "w", title: "x" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: undefined, title: "x" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "[排程] 週報" })).toBe(false);
    expect(shouldDetectHandoff({ agentId: "agents-orchestrator", workspaceId: "w", title: "🤝 受派諮詢：x" })).toBe(false);
  });
});
```
（若 import `agentManager.js` 在測試環境有副作用問題，改把 `shouldDetectHandoff` 放 `handoffService.ts` 並從那裡 import。）

`app.test.ts` 追加（沿用既有 `mkPm`、`createdSessionIds`）：
```ts
  it("GET /api/sessions/:id/handoff：來源場次回 handedOffTo", async () => {
    const prev = mkPm("長對話");
    const cur = mkPm("新");
    const { setHandedOffTo, setHandoffFrom, setHandoffDoc } = await import("./store/sessionState.js");
    setHandedOffTo(prev, cur); setHandoffFrom(cur, prev); setHandoffDoc(prev, "🎯 目標：x");
    const j: any = await (await fetch(`${base}/api/sessions/${prev}/handoff`)).json();
    expect(j.handedOffTo).toMatchObject({ id: cur });
    const j2: any = await (await fetch(`${base}/api/sessions/${cur}/handoff`)).json();
    expect(j2.handoff).toMatchObject({ source: "doc", summary: "🎯 目標：x" });
  });

  it("PUT /api/sessions/:id/handoff：還沒開聊 → 改寫來源的交接單", async () => {
    const prev = mkPm("長對話");
    const { getSession: gs, upsertSession: us } = await import("./store.js");
    const cur = `pm_put_${Date.now()}`;
    us({ id: cur, workspaceId: DEFAULT_WORKSPACE_ID, agentId: "agents-orchestrator", title: "新", createdAt: 1, updatedAt: 1, messages: [] } as any);
    createdSessionIds.push(cur);
    const { setHandoffFrom, setHandoffDoc, getSessionState } = await import("./store/sessionState.js");
    setHandoffFrom(cur, prev); setHandoffDoc(prev, "舊");
    const r = await fetch(`${base}/api/sessions/${cur}/handoff`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: "新版" }) });
    expect(r.status).toBe(200);
    expect(getSessionState(prev)!.handoffDoc).toBe("新版");
    void gs;
  });

  it("PUT handoff：已開聊 → 409；沒有交接來源 → 400；空內容 → 400", async () => {
    const prev = mkPm("長對話");
    const cur = mkPm("新"); // mkPm 會塞使用者訊息＝已開聊
    const { setHandoffFrom } = await import("./store/sessionState.js");
    setHandoffFrom(cur, prev);
    const put = (id: string, doc: string) => fetch(`${base}/api/sessions/${id}/handoff`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc }) });
    expect((await put(cur, "x")).status).toBe(409);
    expect((await put(prev, "x")).status).toBe(400);
    expect((await put(cur, "  ")).status).toBe(400);
  });

  it("PM 手冊含交接標記說明", async () => {
    const { buildOrchestratorSeed } = await import("./routes/sessions.js");
    const s = buildOrchestratorSeed(DEFAULT_WORKSPACE_ID);
    expect(s.standing + s.systemExtra).toContain("=== HANDOFF ===");
  });
```
實作前先看 `mkPm` 定義（`grep -n "function mkPm" server/src/app.test.ts`），確認它會塞使用者訊息；若沒有，409 測試要自己 `appendMessage` 一則 user。

- [ ] **步驟 2：跑測試確認失敗**

- [ ] **步驟 3：實作**

(a) `agentManager.ts`：
```ts
import { parseHandoff } from "./handoffParser.js";
import { AUTOMATED } from "./sessionDigest.js";

/** 交接偵測 gate：同 GOAL_UPDATE——只認專案經理、有工作區；排程/受派等自動化場次不觸發。 */
export function shouldDetectHandoff(s: { agentId: string; workspaceId?: string; title: string }): boolean {
  return s.agentId === "agents-orchestrator" && !!s.workspaceId && !AUTOMATED.test(s.title);
}
```
class 內：
```ts
  private handoffHandler?: (fromId: string, doc: string, io: any) => void;
  /** routes/sessions.ts 註冊（避免循環 import），見 handoffService.performHandoff */
  registerHandoffHandler(fn: (fromId: string, doc: string, io: any) => void): void { this.handoffHandler = fn; }
```
`message` 事件處理、GOAL_UPDATE 區塊之前：
```ts
        // 交接：PM 輸出 HANDOFF 標記 → 存交接單、開新對話並通知前端切換（handoffService）。
        try {
          const title = getSession(s.id)?.title ?? "";
          if (shouldDetectHandoff({ agentId: s.agentId, workspaceId: wsForDispatch, title })) {
            const doc = parseHandoff(String(evt.payload.content));
            if (doc) this.handoffHandler?.(s.id, doc, this.io);
          }
        } catch (e: any) { console.warn("[agentManager] handoff", e?.message); }
```
（確認 `getSession` 已在 agentManager import；沒有就從 `./store.js` 補。）

(b) `routes/sessions.ts`：把 `POST /orchestrator` 內部抽出共用函式，route 改呼叫它：
```ts
/** 開一場有完整 seeding 的互動專案經理對話；handoffFrom 同工作區才帶入。POST /orchestrator 與交接共用。 */
export function startOrchestratorWithHandoff(wsId: string, opts: { title?: string; projectId?: string; handoffFrom?: string } = {}): string {
  const { systemExtra, standing } = buildOrchestratorSeed(wsId);
  const fromSess = opts.handoffFrom ? getSession(opts.handoffFrom) : undefined;
  const handoff = fromSess && (fromSess.workspaceId || DEFAULT_WORKSPACE_ID) === wsId ? buildHandoff(opts.handoffFrom!) : null;
  const session = agentManager.start("agents-orchestrator", opts.title || ORCHESTRATOR_TITLE, standing + systemExtra + (handoff ? handoffPromptBlock(handoff) : ""), wsId, false, "claude", opts.projectId || undefined);
  if (handoff) setHandoffFrom(session.id, handoff.fromId);
  return session.id;
}

sessionsRouter.post("/orchestrator", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  const projectId = (req.body?.projectId || req.query.projectId) as string | undefined;
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 60) : "";
  const handoffFrom = typeof req.body?.handoffFrom === "string" ? req.body.handoffFrom : "";
  res.json({ id: startOrchestratorWithHandoff(wsId, { title, projectId, handoffFrom }) });
});

agentManager.registerHandoffHandler?.((fromId, doc, io) => {
  performHandoff(fromId, doc, {
    start: (wsId, o) => startOrchestratorWithHandoff(wsId, o),
    stop: (id) => agentManager.stop(id),
    emit: (ev, p) => io?.emit(ev, p),
  });
});
```

GET handoff 改為同時回去向：
```ts
sessionsRouter.get("/sessions/:id/handoff", (req, res) => {
  const st = getSessionState(req.params.id);
  if (!st) return res.status(404).json({ error: "not found" });
  const to = st.handedOffTo ? getSession(st.handedOffTo) : undefined;
  res.json({
    handoff: st.handoffFrom ? buildHandoff(st.handoffFrom) : null,
    handedOffTo: to ? { id: to.id, title: to.title } : null,
  });
});
```

新增 PUT（放在 DELETE 旁）：
```ts
// 編輯帶入的交接單：只在新對話還沒有使用者訊息時允許；寫回來源場次，停掉程序讓下一句話用新版喚醒。
sessionsRouter.put("/sessions/:id/handoff", (req, res) => {
  const cur = getSession(req.params.id);
  if (!cur) return res.status(404).json({ error: "not found" });
  const from = getSessionState(req.params.id)?.handoffFrom;
  if (!from) return res.status(400).json({ error: "這場沒有交接來源" });
  const raw = typeof req.body?.doc === "string" ? req.body.doc : "";
  if (!raw.trim()) return res.status(400).json({ error: "交接單不能是空的" });
  if ((cur.messages || []).some((m) => m.role === "user")) return res.status(409).json({ error: "已經開始對話，請直接跟專案經理說要補充什麼" });
  setHandoffDoc(from, capHandoff(raw));
  agentManager.stop(req.params.id);
  res.json({ ok: true });
});
```

PM 手冊（`buildDispatchGuide` 回傳字串內，「📦 成果報告」那行之後）加：
```
## 🔁 交接
使用者說要交接、換新對話、整理交接、對話太長要換一場時：讀完整場，輸出一份交接單（只輸出這一份，不要問要不要交接）：
=== HANDOFF ===
🎯 目標：這場要達成什麼
✅ 已決定：談定、不要再重問的事（含數字與理由）
🔄 進行中：交辦了一半的工作、等誰回報
⏭️ 下一步：接手後第一件要做的事
❓ 等你拍板：需要使用者決定的事
📎 重要資料：數字、連結、檔案路徑
=== END HANDOFF ===
沒有內容的欄位寫「無」。2000 字內。系統會自動開新對話並帶入，你只要在交接單前用一句話說「交接單整理好了」。
```
（註：手冊是 template string，內文的反引號要跳脫；上面沒有反引號。）

routes/sessions.ts 補 import：`performHandoff`（`../handoffService.js`）、`capHandoff`（`../handoffParser.js`）、`setHandoffDoc`（`../store/sessionState.js`）。

- [ ] **步驟 4：跑 server 全套**：`cd server && npx tsc --noEmit && npx vitest run` → 全綠

- [ ] **步驟 5：突變檢查**：暫時把 `shouldDetectHandoff` 的 `!AUTOMATED.test(...)` 拿掉 → gate 測試要轉紅；還原。

- [ ] **步驟 6：Commit**

```bash
git add server/src/agentManager.ts server/src/agentManager.handoff.test.ts server/src/routes/sessions.ts server/src/app.test.ts
git commit -m "feat(handoff): 偵測交接單自動開新對話、編輯端點、PM 交接手冊"
```

---

### 任務 6：前端 lib 與 api

**檔案：**
- 創建：`client/src/lib/handoffNudge.ts`、`client/src/lib/handoffNudge.test.ts`
- 修改：`client/src/lib/api.ts`（約 120 行 `SessionHandoff`、約 250 行 handoff 方法）

- [ ] **步驟 1：寫失敗測試**

```ts
// client/src/lib/handoffNudge.test.ts
import { describe, it, expect } from "vitest";
import { shouldNudge, handoffSwitchTarget, NUDGE_MESSAGES, NUDGE_CHARS } from "./handoffNudge";

describe("shouldNudge", () => {
  it("則數或字數達門檻才提醒", () => {
    expect(shouldNudge({ messageCount: NUDGE_MESSAGES - 1, totalChars: NUDGE_CHARS - 1 })).toBe(false);
    expect(shouldNudge({ messageCount: NUDGE_MESSAGES })).toBe(true);
    expect(shouldNudge({ messageCount: 3, totalChars: NUDGE_CHARS })).toBe(true);
  });
  it("按過不用或已交接 → 不提醒", () => {
    expect(shouldNudge({ messageCount: 999, dismissed: true })).toBe(false);
    expect(shouldNudge({ messageCount: 999, handedOff: true })).toBe(false);
  });
  it("門檻是 80 則／3 萬字", () => {
    expect(NUDGE_MESSAGES).toBe(80);
    expect(NUDGE_CHARS).toBe(30000);
  });
});

describe("handoffSwitchTarget", () => {
  it("正在看來源對話才切換", () => {
    expect(handoffSwitchTarget("a", { fromId: "a", toId: "b" })).toBe("b");
    expect(handoffSwitchTarget("c", { fromId: "a", toId: "b" })).toBeNull();
    expect(handoffSwitchTarget(undefined, { fromId: "a", toId: "b" })).toBeNull();
  });
});
```

- [ ] **步驟 2：跑 `cd client && npx vitest run src/lib/handoffNudge.test.ts` → FAIL**

- [ ] **步驟 3：實作**

```ts
// client/src/lib/handoffNudge.ts
/** 對話過長提醒交接（純前端，不花 token）。門檻依實測：最長 10% 的專案經理對話 ≥102 則。 */
export const NUDGE_MESSAGES = 80;
export const NUDGE_CHARS = 30000;

export function shouldNudge(p: { messageCount: number; totalChars?: number; dismissed?: boolean; handedOff?: boolean }): boolean {
  if (p.dismissed || p.handedOff) return false;
  return p.messageCount >= NUDGE_MESSAGES || (p.totalChars ?? 0) >= NUDGE_CHARS;
}

/** 收到 session:handoff 時：使用者正在看來源對話才自動切到新對話。 */
export function handoffSwitchTarget(viewingSessionId: string | undefined, evt: { fromId: string; toId: string }): string | null {
  return viewingSessionId && viewingSessionId === evt.fromId ? evt.toId : null;
}

const DISMISS_KEY = (id: string) => `handoffNudgeDismissed:${id}`;
export const nudgeDismissed = (id: string) => { try { return localStorage.getItem(DISMISS_KEY(id)) === "1"; } catch { return false; } };
export const dismissNudge = (id: string) => { try { localStorage.setItem(DISMISS_KEY(id), "1"); } catch { /* ignore */ } };

/** 「🔁 交接」鈕送出的固定訊息 */
export const HANDOFF_REQUEST_TEXT = "請整理交接，換到新對話繼續";
```

`api.ts`：
```ts
export interface SessionHandoff {
  fromId: string;
  fromTitle: string;
  summary: string;
  source: "doc" | "digest" | "excerpt";
}
// …
  sessionHandoff: (id: string) => fetch(`/api/sessions/${id}/handoff`).then(j<{ handoff: SessionHandoff | null; handedOffTo: { id: string; title: string } | null }>),
  updateSessionHandoff: (id: string, doc: string) => fetch(`/api/sessions/${id}/handoff`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc }),
  }).then(j<{ ok: boolean }>),
```
（`j` 對非 2xx 的處理照既有寫法；若 `j` 不會 throw，`updateSessionHandoff` 要自己檢查 `r.ok`。）

- [ ] **步驟 4：跑測試 → PASS；`npx tsc -b` 綠**

- [ ] **步驟 5：Commit**

```bash
git add client/src/lib/handoffNudge.ts client/src/lib/handoffNudge.test.ts client/src/lib/api.ts
git commit -m "feat(handoff): 前端過長提醒判斷與交接 API"
```

---

### 任務 7：前端元件

**檔案：**
- 修改：`client/src/components/HandoffCard.tsx`、`HandoffCard.test.tsx`
- 創建：`client/src/components/HandoffBar.tsx`、`HandoffBar.test.tsx`
- 修改：`client/src/components/ChatWindow.tsx`（約 537 行）
- 修改：`client/src/App.tsx`（約 251–259 行 `session:titled` 監聽旁）
- 修改：`client/src/components/AgentSidebar.tsx`（約 186 行）

- [ ] **步驟 1：寫失敗測試**

`HandoffCard.test.tsx` 追加（mock 補 `updateSessionHandoff`）：
```ts
  it("doc 來源：完整顯示、可編輯並送出", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "長對話", summary: "🎯 目標：定價\n✅ 已決定：不走 FBA", source: "doc" }, handedOffTo: null });
    updateSessionHandoff.mockResolvedValue({ ok: true });
    render(<HandoffCard sessionId="s1" canEdit />);
    await waitFor(() => screen.getByText(/已決定：不走 FBA/));
    fireEvent.click(screen.getByRole("button", { name: /編輯/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "🎯 目標：改過" } });
    fireEvent.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(updateSessionHandoff).toHaveBeenCalledWith("s1", "🎯 目標：改過"));
  });
  it("canEdit=false 不顯示編輯", async () => {
    sessionHandoff.mockResolvedValue({ handoff: { fromId: "p1", fromTitle: "t", summary: "x", source: "doc" }, handedOffTo: null });
    render(<HandoffCard sessionId="s1" />);
    await waitFor(() => screen.getByText("x"));
    expect(screen.queryByRole("button", { name: /編輯/ })).toBeNull();
  });
  it("來源場次：顯示已交接連結", async () => {
    sessionHandoff.mockResolvedValue({ handoff: null, handedOffTo: { id: "n1", title: "新對話" } });
    const onOpen = vi.fn();
    render(<HandoffCard sessionId="s1" onOpenSession={onOpen} />);
    await waitFor(() => screen.getByText(/已交接/));
    fireEvent.click(screen.getByRole("button", { name: /新對話/ }));
    expect(onOpen).toHaveBeenCalledWith("n1", "agents-orchestrator", "新對話");
  });
```

`HandoffBar.test.tsx`：
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HandoffBar } from "./HandoffBar";
import { HANDOFF_REQUEST_TEXT } from "../lib/handoffNudge";

const long = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));

describe("HandoffBar", () => {
  beforeEach(() => localStorage.clear());
  it("交接鈕送出固定訊息", () => {
    const onSend = vi.fn();
    render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={onSend} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    expect(onSend).toHaveBeenCalledWith(HANDOFF_REQUEST_TEXT);
  });
  it("忙碌中交接鈕停用", () => {
    render(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    expect((screen.getByRole("button", { name: /交接/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("過長顯示提醒；按「不用」後消失且記住", () => {
    const { rerender } = render(<HandoffBar sessionId="s1" messages={long as any} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.getByText(/這場已經很長（80 則）/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /不用/ }));
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
    rerender(<HandoffBar sessionId="s1" messages={long as any} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.queryByText(/這場已經很長/)).toBeNull();
  });
  it("按鈕觸發後回合結束仍沒交接 → 顯示失敗提示", () => {
    const { rerender } = render(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    fireEvent.click(screen.getByRole("button", { name: /交接/ }));
    rerender(<HandoffBar sessionId="s1" messages={[]} status="busy" onSend={vi.fn()} handedOff={false} />);
    rerender(<HandoffBar sessionId="s1" messages={[]} status="idle" onSend={vi.fn()} handedOff={false} />);
    expect(screen.getByText(/交接單沒有產生/)).toBeTruthy();
  });
  it("已交接 → 不顯示提醒與按鈕", () => {
    render(<HandoffBar sessionId="s1" messages={long as any} status="idle" onSend={vi.fn()} handedOff />);
    expect(screen.queryByRole("button", { name: /交接/ })).toBeNull();
  });
});
```
（`status` 型別照 ChatWindow 現有 status 型別；先 `grep -n "status" client/src/components/ChatWindow.tsx | head` 確認取值。）

- [ ] **步驟 2：跑 `npx vitest run src/components/HandoffCard.test.tsx src/components/HandoffBar.test.tsx` → FAIL**

- [ ] **步驟 3：實作**

`HandoffBar.tsx`：
```tsx
import { useEffect, useRef, useState } from "react";
import { shouldNudge, nudgeDismissed, dismissNudge, HANDOFF_REQUEST_TEXT } from "../lib/handoffNudge";

interface Props {
  sessionId: string;
  messages: { role: string; content: string }[];
  status: string;
  onSend: (text: string) => void;
  handedOff: boolean;
}

/** 專案經理對話頂部：🔁 交接鈕、過長提醒、按鈕交接失敗提示。 */
export function HandoffBar({ sessionId, messages, status, onSend, handedOff }: Props) {
  const [dismissed, setDismissed] = useState(() => nudgeDismissed(sessionId));
  const [failed, setFailed] = useState(false);
  const pending = useRef<"sent" | "busy" | null>(null);

  useEffect(() => { setDismissed(nudgeDismissed(sessionId)); setFailed(false); pending.current = null; }, [sessionId]);
  useEffect(() => {
    if (pending.current === "sent" && status === "busy") pending.current = "busy";
    else if (pending.current === "busy" && status === "idle") { pending.current = null; if (!handedOff) setFailed(true); }
  }, [status, handedOff]);

  if (handedOff) return null;
  const totalChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const nudge = shouldNudge({ messageCount: messages.length, totalChars, dismissed });
  const request = () => { setFailed(false); pending.current = "sent"; onSend(HANDOFF_REQUEST_TEXT); };

  return (
    <div className="px-4 py-1.5 border-b border-zinc-800 text-xs flex items-center gap-2 flex-wrap">
      {nudge && <span className="text-amber-300">這場已經很長（{messages.length} 則），交接到新對話？</span>}
      {failed && <span className="text-rose-300">交接單沒有產生，再按一次</span>}
      <span className="flex-1" />
      <button onClick={request} disabled={status === "busy"} className="text-sky-300 hover:text-sky-200 disabled:opacity-40" title="請專案經理整理交接單，自動開新對話接手">🔁 交接</button>
      {nudge && <button onClick={() => { dismissNudge(sessionId); setDismissed(true); }} className="text-zinc-500 hover:text-zinc-300">不用</button>}
    </div>
  );
}
```

`HandoffCard.tsx`：props 加 `canEdit?: boolean`；state 加 `handedOffTo`、`editing`、`draft`；
- 載入時 `setH(r.handoff); setTo(r.handedOffTo)`。
- `to` 存在時（來源場次）顯示一列：`✅ 已交接 → <button>{to.title}</button>`，點擊 `onOpenSession(to.id, "agents-orchestrator", to.title)`。
- `h.source === "doc"`：內容用 `whitespace-pre-wrap` 顯示，標題改「🔁 已帶入上一場「…」的交接單」；`canEdit` 時顯示「編輯」→ textarea（預填 `h.summary`）＋「儲存」「取消」；儲存呼叫 `api.updateSessionHandoff(sessionId, draft)`，成功後 `setH({ ...h, summary: draft })` 並關閉編輯，失敗 `alert(…)`（沿用現有 drop 的錯誤處理風格）。
- `h` 與 `to` 皆無 → `return null`。
- 對外加 prop `reloadKey?: number`，放進 useEffect 依賴，供收到 `session:handoff` 後重抓。

`ChatWindow.tsx` 約 537 行改為：
```tsx
      {agentId === "agents-orchestrator" && (
        <>
          <HandoffCard sessionId={sessionId} onOpenSession={onOpenSession} reloadKey={handoffReload}
            canEdit={!messages.some((m) => m.role === "user")} />
          <HandoffBar sessionId={sessionId} messages={messages} status={status} handedOff={handedOff}
            onSend={(text) => getSocket().emit("session:send", { sessionId, text })} />
        </>
      )}
```
ChatWindow 內加：
```tsx
  const [handedOff, setHandedOff] = useState(false);
  const [handoffReload, setHandoffReload] = useState(0);
  useEffect(() => {
    setHandedOff(false);
    if (agentId !== "agents-orchestrator") return;
    api.sessionHandoff(sessionId).then((r) => setHandedOff(!!r.handedOffTo)).catch(() => {});
    const sock = getSocket();
    const h = (e: { fromId: string }) => { if (e.fromId === sessionId) { setHandedOff(true); setHandoffReload((k) => k + 1); } };
    sock.on("session:handoff", h);
    return () => { sock.off("session:handoff", h); };
  }, [sessionId, agentId]);
```
注意：送出用的 emit 要跟 `send()`（約 192–196 行）走同一條路徑；若 `send()` 會先在本地 append 使用者訊息（樂觀更新），改成呼叫一個共用的 `sendText(text)`，把 192–196 行的邏輯抽成它，`send()` 與 HandoffBar 都呼叫，避免按鈕送出後畫面沒出現自己的訊息。

`App.tsx`（`session:titled` 監聽旁）：
```tsx
  // 交接完成（server 推 session:handoff）→ 正在看來源對話就切到新對話
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sock = getSocket();
    const h = (e: { fromId: string; toId: string; toTitle: string }) => {
      const v = viewRef.current;
      const target = handoffSwitchTarget(v.kind === "chat" ? v.sessionId : undefined, e);
      if (target) openHistorySessionRef.current?.(target, "agents-orchestrator", e.toTitle);
    };
    sock.on("session:handoff", h);
    return () => { sock.off("session:handoff", h); };
  }, []);
```
（確認 `view` 的型別與 `kind: "chat"` 欄位名稱；`openHistorySessionRef` 已存在於約 297 行。）

`AgentSidebar.tsx` 約 186 行：
```tsx
                {shouldNudge({ messageCount: resumePm.messageCount ?? 0 }) ? " · 這場已經很長，建議交接" : ""}
```
並補 `import { shouldNudge } from "../lib/handoffNudge";`。若 `AgentSidebar.test.tsx` 有斷言「建議開新話題」字樣，一併更新。

- [ ] **步驟 4：跑 client 全套**：`cd client && npx tsc -b && npx vitest run` → 全綠

- [ ] **步驟 5：突變檢查**：HandoffBar 的失敗偵測把 `setFailed(true)` 拿掉 → 失敗提示測試要轉紅；還原。

- [ ] **步驟 6：Commit**

```bash
git add client/src/components/HandoffCard.tsx client/src/components/HandoffCard.test.tsx client/src/components/HandoffBar.tsx client/src/components/HandoffBar.test.tsx client/src/components/ChatWindow.tsx client/src/App.tsx client/src/components/AgentSidebar.tsx client/src/components/AgentSidebar.test.tsx
git commit -m "feat(handoff): 交接鈕、過長提醒、交接單顯示與編輯、自動切換新對話"
```

---

### 任務 8：Opus 最終審查

- [ ] 派 Opus 審 `git diff main...feat/pm-handoff`，重點：
  - message handler 新增段落是否可能拋錯影響存檔／串流；gate 是否可被子 agent 繞過
  - 防重：PM 同回合吐兩次、使用者連按、新對話被刪除後再交接
  - `startOrchestratorWithHandoff` 抽出後 `POST /orchestrator` 行為完全不變（title/projectId/handoffFrom 跨工作區拒絕）
  - 交接單注入 prompt 的長度與內容安全（PM 自己寫的，但可能抄到外部內容）
  - `setAutoDigest` 在交接後被閒置摘要覆蓋的時序
- [ ] 修正審查發現的真問題（各自補測試），重跑兩邊全套

---

### 任務 9：實機 e2e（controller）

- [ ] dev server 已常駐（tsx watch 自動 reload）。`curl -s localhost:5191/api/health` → 200
- [ ] 用 Playwright 開 `localhost:5190`，**不要拿使用者的真實對話測**（會被標成已交接）：在測試對話裡聊幾句後確認；過長提醒另用元件測試已覆蓋。確認：出現過長提醒；按「🔁 交接」→ PM 吐交接單 → 自動切到新對話 → 頂部顯示完整交接單 → 新對話第一句話不重問已決定事項
- [ ] 舊對話頂部顯示「已交接 → …」
- [ ] 截圖存證，記錄結果；問使用者後再 ff 合併回 main
