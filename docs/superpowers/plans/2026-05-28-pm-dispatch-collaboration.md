# PM 派工協作 實現計畫

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計畫。步驟使用複選框（`- [ ]`）語法來追蹤進度。

**目標：** 讓專案經理（`agents-orchestrator`）能在徵得使用者同意後，真的去「請教同事（consult，同步整合）」或「外包執行（execute，非同步背景跑+回報）」，並可提議排成 workflow。

**架構：** 沿用 codebase 既有「標記攔截」模式——PM 在回覆裡輸出 `=== DISPATCH ===` 區塊（只寫計畫不執行），前端偵測後跳「批准卡」，使用者按下才 POST 端點實際執行。consult 用 `agentManager.start()` 開受管子 session 並行收集回覆、再用 `agentManager.send(pmSessionId, ...)` 餵回 PM 整合（PM 的串流經 `index.ts` 既有 session-room forward 自動到前端）。execute 開背景真 session，完成時把結果餵回 PM。workflow 沿用既有 ` ```workflow ` 偵測 + `applyWorkflowDraft`。

**技術棧：** Node + TypeScript（server，`tsx watch`、vitest）、React + Vite（client，`tsc -b`）、socket.io、既有 `agentManager` / `AgentSession` / `spawnClaude` / `loadAgents` / `buildMCPConfigForWorkspace`。

**規格：** `docs/superpowers/specs/2026-05-28-pm-dispatch-collaboration-design.md`

**通用慣例：**
- server 測試在 `server/` 下跑 `npx vitest run <file>`；全套 `npx vitest run`（現況 110 passed，新增不得使其轉紅）。
- client 型別檢查在 `client/` 下 `npx tsc -b`（須零錯誤）。
- 端點驗證用 `curl`（repo 無 supertest 端點測試 harness，沿用既有以 curl 手動驗的慣例）。
- 繁體中文 commit message。每個任務結尾 commit。

---

## 切片① consult 同步全鏈路

### 任務 1：`dispatchParser.ts` — 解析 DISPATCH 標記（純函式）

**檔案：**
- 建立：`server/src/dispatchParser.ts`
- 測試：`server/src/dispatchParser.test.ts`

- [ ] **步驟 1：寫失敗的測試**

`server/src/dispatchParser.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { parseDispatchMarker, validateDispatchPlan } from "./dispatchParser.js";

describe("parseDispatchMarker", () => {
  it("無 DISPATCH 區塊 → null", () => {
    expect(parseDispatchMarker("一般回覆，沒有標記")).toBeNull();
  });

  it("單項、缺 mode → 預設 consult", () => {
    const txt = `好的\n\n=== DISPATCH ===\n- agentId: legal-contract-reviewer\n  task: 這份合約有哪些風險條款？\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toEqual({ agentId: "legal-contract-reviewer", mode: "consult", task: "這份合約有哪些風險條款？" });
  });

  it("多項、混合 mode", () => {
    const txt = `=== DISPATCH ===\n- agentId: legal-contract-reviewer\n  mode: consult\n  task: 風險條款？\n- agentId: ecommerce-ops\n  mode: execute\n  task: 上架露天\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items.map((i) => i.mode)).toEqual(["consult", "execute"]);
    expect(p.items[1].agentId).toBe("ecommerce-ops");
  });

  it("項目缺 task → 該項被丟棄", () => {
    const txt = `=== DISPATCH ===\n- agentId: a\n  mode: consult\n- agentId: b\n  task: 有問題\n=== END DISPATCH ===`;
    const p = parseDispatchMarker(txt)!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0].agentId).toBe("b");
  });

  it("非法 mode → 退回 consult", () => {
    const txt = `=== DISPATCH ===\n- agentId: a\n  mode: 亂寫\n  task: x\n=== END DISPATCH ===`;
    expect(parseDispatchMarker(txt)!.items[0].mode).toBe("consult");
  });
});

describe("validateDispatchPlan", () => {
  it("依已知 agentId 分流 valid / dropped", () => {
    const plan = { items: [
      { agentId: "known-1", mode: "consult" as const, task: "x" },
      { agentId: "ghost", mode: "consult" as const, task: "y" },
    ]};
    const { valid, dropped } = validateDispatchPlan(plan, new Set(["known-1"]));
    expect(valid.map((i) => i.agentId)).toEqual(["known-1"]);
    expect(dropped.map((i) => i.agentId)).toEqual(["ghost"]);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

在 `server/` 下執行：`npx vitest run src/dispatchParser.test.ts`
預期：FAIL，`Cannot find module './dispatchParser.js'`。

- [ ] **步驟 3：寫最小實作**

`server/src/dispatchParser.ts`：
```ts
/**
 * 解析 PM 輸出的 DISPATCH 標記 —— 沿用 codebase「標記攔截」慣例（同 FORK/MEMO/
 * workflow）。PM 只「寫計畫」不執行；前端偵測此區塊後跳批准卡，使用者按下才執行。
 */
export interface DispatchItem {
  agentId: string;
  mode: "consult" | "execute";
  task: string;
}
export interface DispatchPlan {
  items: DispatchItem[];
}

const BLOCK_RE = /=== DISPATCH ===\s*\n([\s\S]*?)\n=== END DISPATCH ===/;

export function parseDispatchMarker(text: string): DispatchPlan | null {
  const m = text.match(BLOCK_RE);
  if (!m) return null;
  const items: DispatchItem[] = [];
  let cur: { agentId: string; mode: "consult" | "execute"; task?: string } | null = null;
  const flush = () => {
    if (cur && cur.agentId && cur.task) items.push({ agentId: cur.agentId, mode: cur.mode, task: cur.task });
  };
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    const idM = line.match(/^-\s*agentId:\s*(.+)$/);
    if (idM) { flush(); cur = { agentId: idM[1].trim(), mode: "consult" }; continue; }
    if (!cur) continue;
    const modeM = line.match(/^mode:\s*(\S+)\s*$/i);
    if (modeM) { cur.mode = modeM[1].toLowerCase() === "execute" ? "execute" : "consult"; continue; }
    const taskM = line.match(/^task:\s*(.+)$/);
    if (taskM) { cur.task = taskM[1].trim(); continue; }
  }
  flush();
  return items.length ? { items } : null;
}

export function validateDispatchPlan(
  plan: DispatchPlan,
  knownAgentIds: Set<string>,
): { valid: DispatchItem[]; dropped: DispatchItem[] } {
  const valid: DispatchItem[] = [];
  const dropped: DispatchItem[] = [];
  for (const it of plan.items) (knownAgentIds.has(it.agentId) ? valid : dropped).push(it);
  return { valid, dropped };
}
```

- [ ] **步驟 4：跑測試確認通過**

`npx vitest run src/dispatchParser.test.ts` → 預期 PASS（6 tests）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/dispatchParser.ts server/src/dispatchParser.test.ts
git commit -m "feat: DISPATCH 標記解析 + 驗證（純函式）"
```

---

### 任務 2：`dispatchRunner.ts` — 並行限流 + consult 收集

**檔案：**
- 建立：`server/src/dispatchRunner.ts`
- 測試：`server/src/dispatchRunner.test.ts`

設計：`mapWithConcurrency` 為純函式（好測）；`runConsult` 以依賴注入 `runOne` 讓測試不必真的 spawn claude。

- [ ] **步驟 1：寫失敗的測試**

`server/src/dispatchRunner.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { mapWithConcurrency, runConsult } from "./dispatchRunner.js";
import type { DispatchItem } from "./dispatchParser.js";

describe("mapWithConcurrency", () => {
  it("保序回傳、全部完成", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it("同時在跑的數量不超過 limit", async () => {
    let running = 0, peak = 0;
    const work = async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--; return 0;
    };
    await mapWithConcurrency([0, 0, 0, 0, 0], 2, work);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("單項拋錯不影響其他項（由 fn 自行 try/catch 時）", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 3, async (n) => (n === 2 ? "ERR" : "ok"));
    expect(out).toEqual(["ok", "ERR", "ok"]);
  });
});

describe("runConsult（注入假 runOne）", () => {
  const items: DispatchItem[] = [
    { agentId: "a", mode: "consult", task: "問A" },
    { agentId: "b", mode: "consult", task: "問B" },
  ];
  it("收集每項輸出與狀態", async () => {
    const fake = async (it: DispatchItem) => ({ agentId: it.agentId, task: it.task, output: it.agentId + "答", status: "ok" as const });
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res).toEqual([
      { agentId: "a", task: "問A", output: "a答", status: "ok" },
      { agentId: "b", task: "問B", output: "b答", status: "ok" },
    ]);
  });
  it("逾時/錯誤項標記 status 但不拖垮整批", async () => {
    const fake = async (it: DispatchItem) =>
      it.agentId === "a"
        ? { agentId: "a", task: "問A", output: "", status: "timeout" as const }
        : { agentId: "b", task: "問B", output: "b答", status: "ok" as const };
    const res = await runConsult(items, "ws1", { concurrency: 3, perItemTimeoutMs: 1000 }, fake);
    expect(res.map((r) => r.status)).toEqual(["timeout", "ok"]);
  });
});
```

- [ ] **步驟 2：跑測試確認失敗**

`npx vitest run src/dispatchRunner.test.ts` → FAIL（模組不存在）。

- [ ] **步驟 3：寫實作**

`server/src/dispatchRunner.ts`：
```ts
import { agentManager } from "./agentManager.js";
import type { DispatchItem } from "./dispatchParser.js";

export interface ConsultResult {
  agentId: string;
  task: string;
  output: string;
  status: "ok" | "timeout" | "error";
}

/** 保序、限制同時併發數的 map。fn 自行處理錯誤（回傳值代表結果）。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 真正跑一個 consult 項：開受管子 session（帶工作區脈絡/記憶/MCP），收 final 回覆。 */
async function runOneConsult(
  item: DispatchItem,
  workspaceId: string,
  perItemTimeoutMs: number,
): Promise<ConsultResult> {
  return new Promise<ConsultResult>((resolve) => {
    // enableAutoFork=false：子諮詢不該再外掛 FORK 能力。
    const session = agentManager.start(item.agentId, `🤝 受派諮詢：${item.task.slice(0, 24)}`, undefined, workspaceId, false);
    let collected = "";
    let settled = false;
    const finish = (status: ConsultResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener("event", onEvent);
      resolve({ agentId: item.agentId, task: item.task, output: collected.trim(), status });
    };
    const onEvent = (evt: any) => {
      if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
      else if (evt.type === "result") finish(collected ? "ok" : "error");
      else if (evt.type === "error" && !collected) { /* 暫存，等 result/timeout 決定 */ }
    };
    const timer = setTimeout(() => finish(collected ? "ok" : "timeout"), perItemTimeoutMs);
    session.on("event", onEvent);
    agentManager.send(session.id, item.task);
  });
}

/** 並行（限流）跑所有 consult 項，回每項原始輸出（含逾時/錯誤標記）。 */
export async function runConsult(
  items: DispatchItem[],
  workspaceId: string,
  opts: { concurrency: number; perItemTimeoutMs: number },
  runOne: (item: DispatchItem, workspaceId: string, timeoutMs: number) => Promise<ConsultResult> = runOneConsult,
): Promise<ConsultResult[]> {
  return mapWithConcurrency(items, opts.concurrency, (it) => runOne(it, workspaceId, opts.perItemTimeoutMs));
}
```

- [ ] **步驟 4：跑測試確認通過**

`npx vitest run src/dispatchRunner.test.ts` → PASS（5 tests）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/dispatchRunner.ts server/src/dispatchRunner.test.ts
git commit -m "feat: dispatchRunner 並行限流 + consult 收集（注入式好測）"
```

---

### 任務 3：dispatch 端點（僅 consult）

**檔案：**
- 修改：`server/src/routes/sessions.ts`（在 `/orchestrator` 端點之後新增；檔頭 import 補 `loadAgentsImpl` 已有、新增 `runConsult` 與常數）

- [ ] **步驟 1：在 `sessions.ts` 檔頭加 import**

於 `import { isGeminiAvailable } from "../geminiProcess.js";`（第 12 行附近）之後加：
```ts
import { runConsult } from "../dispatchRunner.js";
import type { DispatchItem } from "../dispatchParser.js";

const DISPATCH_CONCURRENCY = 3;          // 同時併發數（非總數上限）
const CONSULT_TIMEOUT_MS = 120_000;      // 單項諮詢逾時
const CONSULT_FEEDBACK_SENTINEL = "[[CONSULT_RESULTS]]"; // 前端據此摺疊餵回訊息
```

- [ ] **步驟 2：在 `/orchestrator` 端點（約第 327 行 `res.json({ id: session.id });` 與其 `});` 之後）新增 dispatch 端點**

```ts
// PM 派工 — 接收已批准的計畫，實際跑子 agent。v1 僅 consult（execute 見切片②）。
sessionsRouter.post("/orchestrator/:sessionId/dispatch", async (req, res) => {
  const pmSessionId = req.params.sessionId;
  const pm = getSession(pmSessionId);
  if (!pm) return res.status(404).json({ error: "PM session 不存在，請重開專案經理對話" });
  const items: DispatchItem[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: "items 不可為空" });

  const validIds = new Set(loadAgentsImpl().map((a) => a.id));
  const consult = items.filter((i) => i.mode !== "execute" && validIds.has(i.agentId) && i.task);
  // execute 項：切片② 實作；此切片先忽略並回報未支援
  const executeIgnored = items.filter((i) => i.mode === "execute");
  if (consult.length === 0) {
    return res.status(400).json({ error: "沒有有效的 consult 項（execute 尚未支援，見切片②）" });
  }

  try {
    const results = await runConsult(consult, pm.workspaceId, {
      concurrency: DISPATCH_CONCURRENCY,
      perItemTimeoutMs: CONSULT_TIMEOUT_MS,
    });
    // 組彙整訊息餵回 PM（PM 串流經既有 session-room forward 自動到前端）。
    // 前綴 sentinel，讓前端把這則「使用者訊息」摺疊起來，保持對話乾淨。
    const labelled = results
      .map((r) => `### ${r.agentName ?? r.agentId}（${r.status}）\n${r.output || "（未取得回覆）"}`)
      .join("\n\n");
    const feedback = `${CONSULT_FEEDBACK_SENTINEL}\n以下是你委派同事的回覆，請**整合成一段給使用者的回覆**（衝突處註明採用誰、為什麼；逾時/錯誤的同事就說明未能取得）：\n\n${labelled.slice(0, 25000)}`;
    agentManager.send(pmSessionId, feedback);
    res.json({ consulted: results, executeIgnored: executeIgnored.map((i) => i.agentId) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});
```

> 注意：`ConsultResult` 無 `agentName` 欄位，上方 `r.agentName ?? r.agentId` 會永遠取 `agentId`。若要顯示中文名，於步驟 3 補上（見下）。

- [ ] **步驟 3：（修正型別一致性）在 `dispatchRunner.ts` 的 `ConsultResult` 加可選 `agentName`，並於 `runOneConsult` 帶入**

`server/src/dispatchRunner.ts`：`ConsultResult` 介面加 `agentName?: string;`。`runOneConsult` 開頭用 `agentManager` 拿不到名稱，改由呼叫端注入——簡化做法：在端點組 `labelled` 前用 `loadAgentsImpl()` 建 `id→name` map 補上。**故步驟 2 的 `r.agentName ?? r.agentId` 改為**：
```ts
const nameOf = new Map(loadAgentsImpl().map((a) => [a.id, a.name]));
const labelled = results
  .map((r) => `### ${nameOf.get(r.agentId) ?? r.agentId}（${r.status}）\n${r.output || "（未取得回覆）"}`)
  .join("\n\n");
```
（`ConsultResult` 不需要 `agentName` 欄位；移除步驟 2 的注意事項假設，直接用 map。）

- [ ] **步驟 4：手動驗證（curl）**

確認 dev server 在跑（5191）。先在某 PM session 手動造一筆（或用既有 orchestrator session id）。範例（用 default 工作區開一個 orchestrator session 後取其 id 替換 `<SID>`）：
```bash
curl -s -X POST http://127.0.0.1:5191/api/orchestrator/<SID>/dispatch \
  -H "Content-Type: application/json" \
  -d '{"items":[{"agentId":"<某真實agentId>","mode":"consult","task":"用一句話自我介紹"}]}'
```
預期：回 `{"consulted":[{"agentId":"...","status":"ok","output":"..."}], ...}`，且該 PM session 隨後串流出一段整合回覆（可在前端該對話看到）。

- [ ] **步驟 5：跑全套確認沒打爛 + Commit**

```bash
cd server && npx vitest run    # 仍全綠
git add server/src/routes/sessions.ts server/src/dispatchRunner.ts
git commit -m "feat: PM consult 派工端點 /orchestrator/:id/dispatch（餵回整合）"
```

---

### 任務 4：PM system prompt 教 consult

**檔案：**
- 修改：`server/src/routes/sessions.ts`（`/orchestrator` 端點的 `extra` 模板，約第 317-323 行）

- [ ] **步驟 1：在 `extra` 模板尾端（` 可用團隊清單：\n${catalog}` 之前）插入 consult 說明**

```ts
  const dispatchGuide = `
## 你可以「請教同事並整合」（consult）

當使用者的問題有部分該由特定專家回答時，你可以**提議去請教同事**。輸出下列標記（**只寫計畫、不要自己回答那部分**），系統會跳出批准卡，使用者按下後才會真的去問：

\`\`\`
=== DISPATCH ===
- agentId: <團隊清單中的 id>
  mode: consult
  task: 要問這位同事的單一明確問題（繁中）
=== END DISPATCH ===
\`\`\`

規則：
- agentId 必須完全來自下方團隊清單。
- 要問幾位就列幾項（1 位=單純請教；多位=召集，回來後你負責整合）。
- task 要具體、單一焦點。
- 寫完標記後用一句話告訴使用者「我想請教 X、Y，按批准卡即可」，**不要自己代答**。
`;
  const extra = `\n\n# 你目前可動用的團隊（${allAgents.length} 位）\n
請以「專案經理」身份協助使用者：(1) 釐清需求 (2) 推薦最合適的 agent 組合 (3) 建議如何派工。
回覆時請用 Markdown，並在推薦 agent 時用反引號包住其 \`agent-id\`，方便使用者複製對應名稱去儀表板開啟對話。
${dispatchGuide}
可用團隊清單：
${catalog}
`;
```
（即把原本 `const extra = ...` 整段替換為上面含 `dispatchGuide` 的版本。）

- [ ] **步驟 2：手動驗證**

前端開「找專案經理討論」，問一個明顯跨專業的需求（例：「幫我看這份合約風險」），確認 PM 會吐出 `=== DISPATCH ===` 標記（此時前端尚未有卡片，先確認標記文字出現即可）。

- [ ] **步驟 3：Commit**

```bash
git add server/src/routes/sessions.ts
git commit -m "feat: PM prompt 教 consult 派工標記"
```

---

### 任務 5：client `api.dispatch`

**檔案：**
- 修改：`client/src/lib/api.ts`（在 `launchWorkspaceChrome` / `stopWorkspaceChrome` 之後，約第 76 行區塊）

- [ ] **步驟 1：加 api 方法**

```ts
  dispatch: (sessionId: string, items: { agentId: string; mode: "consult" | "execute"; task: string }[]) =>
    fetch(`/api/orchestrator/${sessionId}/dispatch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }).then(j<{ consulted: { agentId: string; task: string; output: string; status: "ok" | "timeout" | "error" }[]; executeIgnored?: string[] }>),
```

- [ ] **步驟 2：型別檢查**

`cd client && npx tsc -b` → 零錯誤。

- [ ] **步驟 3：Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: client api.dispatch"
```

---

### 任務 6：`DispatchApprovalCard` + ChatWindow 偵測 + 原始回覆可展開

**檔案：**
- 建立：`client/src/components/DispatchApprovalCard.tsx`
- 修改：`client/src/components/ChatWindow.tsx`（偵測 + 渲染卡片 + 摺疊 sentinel 訊息 + 顯示原始回覆）

- [ ] **步驟 1：建立 `DispatchApprovalCard.tsx`**

```tsx
interface DispatchItemView { agentId: string; mode: "consult" | "execute"; task: string; }

export function DispatchApprovalCard({
  items, busy, onApprove, onCancel,
}: {
  items: DispatchItemView[];
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-2 rounded border border-sky-700/50 bg-sky-950/30 p-3 text-xs">
      <div className="mb-2 text-zinc-300">專案經理想派工給 {items.length} 位（先問再跑，按下才執行）：</div>
      <ul className="mb-2 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={`shrink-0 rounded px-1.5 ${it.mode === "execute" ? "bg-amber-600/30 text-amber-300" : "bg-sky-600/30 text-sky-300"}`}>
              {it.mode === "execute" ? "外包執行" : "請教"}
            </span>
            <span className="font-mono text-zinc-400">{it.agentId}</span>
            <span className="text-zinc-300">— {it.task}</span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button disabled={busy} onClick={onApprove}
          className="rounded bg-sky-700 px-3 py-1 text-white hover:bg-sky-600 disabled:opacity-40">
          {busy ? "派工中…" : "✅ 派工"}
        </button>
        <button disabled={busy} onClick={onCancel}
          className="rounded bg-zinc-700 px-3 py-1 text-white hover:bg-zinc-600 disabled:opacity-40">
          取消
        </button>
      </div>
    </div>
  );
}
```

- [ ] **步驟 2：ChatWindow 加偵測 + 狀態（仿 `detectedWorkflow`，約第 402-410 行旁）**

於 import 區加：`import { DispatchApprovalCard } from "./DispatchApprovalCard";`
於 `import { parseDispatchMarker }`：client 端不引 server 模組，**在 ChatWindow 內就地寫一個輕量解析**（與 server 同格式）：
```ts
// 與 server/src/dispatchParser.ts 同格式的就地解析（client 不跨引 server 模組）
const detectedDispatch = useMemo(() => {
  if (agentId !== "agents-orchestrator") return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const m = messages[i].content.match(/=== DISPATCH ===\s*\n([\s\S]*?)\n=== END DISPATCH ===/);
    if (!m) continue;
    const items: { agentId: string; mode: "consult" | "execute"; task: string }[] = [];
    let cur: any = null;
    const flush = () => { if (cur?.agentId && cur?.task) items.push({ agentId: cur.agentId, mode: cur.mode || "consult", task: cur.task }); };
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.trim();
      const id = line.match(/^-\s*agentId:\s*(.+)$/);
      if (id) { flush(); cur = { agentId: id[1].trim(), mode: "consult" }; continue; }
      if (!cur) continue;
      const mo = line.match(/^mode:\s*(\S+)/i); if (mo) { cur.mode = mo[1].toLowerCase() === "execute" ? "execute" : "consult"; continue; }
      const ta = line.match(/^task:\s*(.+)$/); if (ta) { cur.task = ta[1].trim(); continue; }
    }
    flush();
    return items.length ? items : null;
  }
  return null;
}, [messages, agentId]);

const [dispatchBusy, setDispatchBusy] = useState(false);
const [dispatched, setDispatched] = useState(false);
const [consultRaw, setConsultRaw] = useState<{ agentId: string; task: string; output: string; status: string }[] | null>(null);

const approveDispatch = async () => {
  if (!detectedDispatch) return;
  setDispatchBusy(true);
  try {
    const r = await api.dispatch(sessionId, detectedDispatch);
    setConsultRaw(r.consulted);
    setDispatched(true);
  } catch (e: any) {
    alert("派工失敗：" + (e?.message || e));
  } finally {
    setDispatchBusy(false);
  }
};
```

- [ ] **步驟 3：ChatWindow 渲染卡片（在 recommendedAgents banner 附近，約第 657 行那群 banner 之中）**

```tsx
{detectedDispatch && !dispatched && (
  <DispatchApprovalCard
    items={detectedDispatch}
    busy={dispatchBusy}
    onApprove={approveDispatch}
    onCancel={() => setDispatched(true)}
  />
)}
{consultRaw && consultRaw.length > 0 && (
  <details className="mb-2 rounded border border-zinc-700 bg-zinc-900/50 p-2 text-xs">
    <summary className="cursor-pointer text-zinc-300">🔍 同事原始回覆（{consultRaw.length} 位）</summary>
    <div className="mt-2 space-y-2">
      {consultRaw.map((c, i) => (
        <div key={i}>
          <div className="text-zinc-400">{c.agentId}（{c.status}）</div>
          <pre className="whitespace-pre-wrap text-zinc-300">{c.output || "（未取得回覆）"}</pre>
        </div>
      ))}
    </div>
  </details>
)}
```

- [ ] **步驟 4：摺疊餵回 PM 的 sentinel 訊息（在 messages 渲染處）**

找到 messages.map 渲染每則訊息的地方，對 `role==="user" && content.startsWith("[[CONSULT_RESULTS]]")` 的訊息改渲染為一行灰字「（已將同事回覆交給專案經理整合）」，不顯示原文。範例（依實際渲染結構調整）：
```tsx
{messages.map((m, i) => {
  if (m.role === "user" && m.content.startsWith("[[CONSULT_RESULTS]]")) {
    return <div key={i} className="my-1 text-[11px] text-zinc-600">（已將同事回覆交給專案經理整合）</div>;
  }
  /* ...既有渲染... */
})}
```

- [ ] **步驟 5：型別檢查 + 端到端手動驗證**

`cd client && npx tsc -b` → 零錯誤。
前端硬刷新 → 找專案經理 → 問跨專業需求 → 出現批准卡 → 按「✅ 派工」→ 確認：(a) PM 串流出整合回覆；(b) sentinel 訊息被摺疊成灰字；(c)「🔍 同事原始回覆」可展開看到每位原文。

- [ ] **步驟 6：Commit**

```bash
git add client/src/components/DispatchApprovalCard.tsx client/src/components/ChatWindow.tsx
git commit -m "feat: 派工批准卡 + consult 原始回覆可展開 + 摺疊餵回訊息"
```

---

## 切片② execute 非同步（背景跑 + 完成回報）

### 任務 7：`dispatchRunner.startExecute` + 完成回呼

**檔案：**
- 修改：`server/src/dispatchRunner.ts`
- 測試：`server/src/dispatchRunner.test.ts`（補 startExecute 注入式測試）

- [ ] **步驟 1：寫失敗測試（注入式）**

於 `dispatchRunner.test.ts` 加（注入形狀與步驟 3 的 `ExecuteDeps {start, attachDone}` + 第四參 `onDone` 完全一致）：
```ts
import { startExecute } from "./dispatchRunner.js";
describe("startExecute（注入假 deps）", () => {
  it("為每項回 subSessionId 並在完成時呼叫 onDone", async () => {
    const done: any[] = [];
    const deps = {
      start: (it: DispatchItem) => "sub-" + it.agentId,
      attachDone: (_subId: string, cb: (output: string, ok: boolean) => void) => {
        setTimeout(() => cb("做完了", true), 5);
      },
    };
    const handles = startExecute(
      [{ agentId: "ec", mode: "execute", task: "上架" }], "ws1", "pm1",
      (d) => done.push(d), deps,
    );
    expect(handles[0]).toEqual({ subSessionId: "sub-ec", agentId: "ec" });
    await new Promise((r) => setTimeout(r, 20));
    expect(done[0]).toMatchObject({ agentId: "ec", subSessionId: "sub-ec", output: "做完了", status: "ok", pmSessionId: "pm1" });
  });
});
```
> 註：此測試以注入 `deps` 抽象掉真實 session；正式實作的預設依賴（`defaultExecuteDeps`）用 `agentManager` + session 事件，由步驟 4 手動驗證。

- [ ] **步驟 2：跑測試確認失敗** → `npx vitest run src/dispatchRunner.test.ts`。

- [ ] **步驟 3：實作 `startExecute`**

```ts
export interface ExecuteHandle { subSessionId: string; agentId: string; }
export interface ExecuteDone { pmSessionId: string; agentId: string; subSessionId: string; output: string; status: "ok" | "error"; }

interface ExecuteDeps {
  start: (item: DispatchItem, workspaceId: string) => string;            // 開背景真 session，回 id
  attachDone: (subSessionId: string, cb: (output: string, ok: boolean) => void) => void; // 掛一次性完成監聽
}

// 預設依賴：用 agentManager 開真 session 並掛 result 監聽
const defaultExecuteDeps: ExecuteDeps = {
  start: (item, workspaceId) => {
    const s = agentManager.start(item.agentId, `🛠️ 外包執行：${item.task.slice(0, 24)}`, undefined, workspaceId, false);
    agentManager.send(s.id, item.task);
    return s.id;
  },
  attachDone: (subSessionId, cb) => {
    const s = agentManager.get(subSessionId);
    if (!s) return cb("(子 session 不存在)", false);
    let collected = "";
    const onEvent = (evt: any) => {
      if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
      else if (evt.type === "result") { s.removeListener("event", onEvent); cb(collected.trim(), !!collected); }
    };
    s.on("event", onEvent);
  },
};

export function startExecute(
  items: DispatchItem[],
  workspaceId: string,
  pmSessionId: string,
  onDone: (d: ExecuteDone) => void,
  deps: ExecuteDeps = defaultExecuteDeps,
): ExecuteHandle[] {
  return items.map((item) => {
    const subSessionId = deps.start(item, workspaceId);
    deps.attachDone(subSessionId, (output, ok) =>
      onDone({ pmSessionId, agentId: item.agentId, subSessionId, output, status: ok ? "ok" : "error" }),
    );
    return { subSessionId, agentId: item.agentId };
  });
}
```
> 註：步驟 1 測試的注入形狀（`{ start, attachDone }` + 第四參 `onDone`）已與此處 `ExecuteDeps` + `startExecute` 簽名一致。

- [ ] **步驟 4：跑測試 + 手動驗證背景執行**（PASS 後）；commit：
```bash
git add server/src/dispatchRunner.ts server/src/dispatchRunner.test.ts
git commit -m "feat: startExecute 背景執行 + 完成回呼"
```

---

### 任務 8：dispatch 端點支援 execute + socket 通知

**檔案：**
- 修改：`server/src/routes/sessions.ts`

- [ ] **步驟 1：端點處理 execute 項**

把任務 3 的 `executeIgnored` 分支換成實際呼叫：
```ts
const execute = items.filter((i) => i.mode === "execute" && validIds.has(i.agentId) && i.task);
let executing: { subSessionId: string; agentId: string }[] = [];
if (execute.length > 0) {
  const io = req.app.get("io");
  const nameOf = new Map(loadAgentsImpl().map((a) => [a.id, a.name]));
  executing = startExecute(execute, pm.workspaceId, pmSessionId, (d) => {
    const label = nameOf.get(d.agentId) ?? d.agentId;
    const report = `[[EXEC_REPORT]]\n同事「${label}」回報外包任務${d.status === "ok" ? "完成" : "失敗"}：\n\n${d.output.slice(0, 12000)}\n\n請用一句話向使用者轉達此回報。`;
    agentManager.send(d.pmSessionId, report);
    io?.to(`session:${d.pmSessionId}`).emit("session:event", { sessionId: d.pmSessionId, type: "dispatch:done", payload: { agentId: d.agentId, status: d.status } });
  });
  // 立即請 PM 回一句「已交辦」
  if (consult.length === 0) {
    agentManager.send(pmSessionId, `[[EXEC_ACK]]\n你已把上述 ${execute.length} 件外包任務交辦出去（背景進行中），請用一句話告訴使用者「已交辦，完成會回報」。`);
  }
}
```
並於回應加 `executing`：`res.json({ consulted: results ?? [], executing })`（注意：當只有 execute、沒有 consult 時，任務 3 那個「沒有有效 consult 就 400」的早退要改成「consult 與 execute 皆空才 400」）。

- [ ] **步驟 2：調整早退條件** — 將任務 3 的
```ts
if (consult.length === 0) { return res.status(400).json({ error: "..." }); }
```
改為：
```ts
if (consult.length === 0 && items.filter((i) => i.mode === "execute" && validIds.has(i.agentId) && i.task).length === 0) {
  return res.status(400).json({ error: "沒有有效的派工項" });
}
const results = consult.length > 0 ? await runConsult(consult, pm.workspaceId, { concurrency: DISPATCH_CONCURRENCY, perItemTimeoutMs: CONSULT_TIMEOUT_MS }) : [];
```
（並把 consult 整合段包在 `if (consult.length > 0)` 內。）

- [ ] **步驟 3：import `startExecute`** — 任務 3 的 import 行補成 `import { runConsult, startExecute } from "../dispatchRunner.js";`

- [ ] **步驟 4：手動驗證 + Commit**

curl 一個 `mode:execute` 項（指向有開瀏覽器工具的工作區與電商類 agent），確認：背景 session 建立、PM 先回「已交辦」、子 session 跑完後 PM 出現回報。
```bash
git add server/src/routes/sessions.ts
git commit -m "feat: dispatch 端點支援 execute 非同步 + 完成回報 + socket 通知"
```

---

### 任務 9：PM prompt 增 execute 判斷 + 前端 toast

**檔案：**
- 修改：`server/src/routes/sessions.ts`（`dispatchGuide`）
- 修改：`client/src/components/ChatWindow.tsx`（sentinel 摺疊涵蓋 `[[EXEC_REPORT]]`/`[[EXEC_ACK]]`；`dispatch:done` toast）

- [ ] **步驟 1：`dispatchGuide` 增 execute 說明**：補一段「要『外包執行』（請同事實際動手做事，例如上架、操作後台）時，mode 用 `execute`；execute 會背景跑、完成回報，你不必等。判斷：要『意見』用 consult，要『把事做掉』用 execute。」

- [ ] **步驟 2：ChatWindow sentinel 摺疊擴充** — 步驟（任務6 步驟4）的判斷改為 `m.content.startsWith("[[CONSULT_RESULTS]]") || m.content.startsWith("[[EXEC_REPORT]]") || m.content.startsWith("[[EXEC_ACK]]")`，灰字文案對應調整。

- [ ] **步驟 3：socket toast** — 於 ChatWindow 既有 `sock.on("session:event", handler)`（約第 357 行）的 handler 內，加：`if (evt.type === "dispatch:done") { /* 顯示簡單 toast，例如設一個 state 顯示「<agentId> 已完成交辦」3 秒 */ }`。

- [ ] **步驟 4：型別檢查 + 手動驗證 + Commit**
```bash
git add server/src/routes/sessions.ts client/src/components/ChatWindow.tsx
git commit -m "feat: PM prompt 教 execute + 前端回報摺疊與完成 toast"
```

---

## 切片③ workflow（PM 主動提議）

> 既有 `ChatWindow.tsx`（約第 402 行）已對**任何對話**偵測 ` ```workflow ` 區塊並提供「套用為 Workflow」按鈕，`applyWorkflowDraft(sessionId, wsId, ...)` 亦通用。故本切片**只需教 PM 何時提議 workflow**。

### 任務 10：PM prompt 增 workflow 提議

**檔案：**
- 修改：`server/src/routes/sessions.ts`（`dispatchGuide`）

- [ ] **步驟 1：`dispatchGuide` 增 workflow 說明**

補一段：
```
## 重複性流程 → 提議排成 Workflow

若使用者的需求是「會一直重複跑的多步流程」（例：每週多平台內容生產），不要用 DISPATCH，而是提議排成可存可重跑的 workflow：輸出一個 ```workflow 程式碼區塊（JSON，含 name/description/steps[]，step 有 id/agentId/prompt，可 dependsOn 表並行），系統會跳出「套用為 Workflow」按鈕。

判斷：一次性/臨場 → DISPATCH（consult/execute）；會重複的多步流程 → workflow。
```
（workflow JSON 範例可精簡引用既有 `/api/workflow/draft` 端點 prompt 內的格式，避免重複——指向 `routes/workspaces.ts` 的 workflowDraftRouter 範例即可，但 prompt 內仍需給一個最小可解析範例。給：）
```json
{ "name": "每週內容生產", "description": "...", "maxConcurrency": 2,
  "steps": [ { "id": "research", "agentId": "marketing-trend-researcher", "prompt": "..." },
             { "id": "ig", "agentId": "marketing-content-creator", "dependsOn": ["research"], "prompt": "...{{research.out}}" } ] }
```

- [ ] **步驟 2：手動驗證** — 問 PM 一個「每週重複」的需求，確認它吐 ` ```workflow ` 區塊且前端「套用為 Workflow」可成功建立。

- [ ] **步驟 3：Commit**
```bash
git add server/src/routes/sessions.ts
git commit -m "feat: PM prompt 教 workflow 提議（重複性流程）"
```

---

## 自檢結果（對照規格）

- **規格覆蓋**：consult（任務 1-6）、execute（任務 7-9）、workflow（任務 10）、先問再跑批准卡（任務 6）、並行限流不設總數上限（任務 2/3 `DISPATCH_CONCURRENCY`）、原始回覆可追溯（任務 6）、子 session 為真 session 自動進學習捕捉（`agentManager.start` 既有行為，任務 2/7 採用）、execute 繼承工作區 Chrome/MCP（`agentManager.start(…, workspaceId)` 既有行為）、§6 in-memory 限制（任務 7 `attachDone` 為記憶體監聽，server 重啟丟失——符合規格已聲明限制）。
- **型別一致**：`DispatchItem`/`DispatchPlan`（任務1）、`ConsultResult`（任務2）、`ExecuteHandle`/`ExecuteDone`/`ExecuteDeps`（任務7）跨任務沿用一致。任務 3 的 `agentName` 疑慮已於步驟 3 用 `loadAgentsImpl()` 的 `id→name` map 解決（`ConsultResult` 不加欄位）。任務 7 測試注入介面與 `ExecuteDeps`（`{start, attachDone}` + 第四參 `onDone`）已對齊。
- **無占位符**：所有程式步驟附完整程式碼或精確錨點/指令。

## 未涵蓋（後續，非本計畫）

B（MCP 工具）、自動門檻不先問、單次派工內對同專家多輪追問、跨工作區派工、execute `dispatch_jobs` 持久化以支援 server 重啟續接回報、派工成本統計面板。
