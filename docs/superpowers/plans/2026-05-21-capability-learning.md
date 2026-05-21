# 能力學習進程 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓使用者能主動觸發「能力學習」進程，每個 agent 學習自己職業該有的核心專業能力（類層共通能力 + 個人層獨有手藝），產出走 Phase 1 既有的提案佇列批准後注入。

**架構：** 新增 `category_capability_memory` 表存類層記憶；`capabilityLearning.ts` 用一次性 Claude CLI 呼叫產生學習提案、寫進既有 `learning_proposals`；擴充 approve 路由把 `scope='category'` 提案寫進類記憶；`buildCapabilityBlock` 把注入區塊變兩段；新增 `POST /api/learning/run` 序列執行 + socket 進度；前端新增 `CapabilityLearningPanel.tsx`。

**技術棧：** Node + TypeScript（server，`tsx` 執行、`node:sqlite`）、vitest、Express、socket.io、React 18 + Vite（client）。

**規格：** `docs/superpowers/specs/2026-05-21-capability-learning-design.md`

---

## 文件結構

| 文件 | 職責 | 動作 |
|---|---|---|
| `server/src/db.ts` | DB schema | 修改：加 `category_capability_memory` 表 |
| `server/src/learningCapture.ts` | 學習標記解析、型別 | 修改：`LearnScope` 加 `"category"` |
| `server/src/learningStore.ts` | 學習提案 / 記憶 DB 存取 | 修改：加 `getCategoryMemory` / `appendCategoryMemory` |
| `server/src/capabilityPrompts.ts` | 能力學習 prompt 組裝（純函式） | 新建 |
| `server/src/capabilityLearning.ts` | 能力學習 runner、提案寫入、run 狀態機 | 新建 |
| `server/src/learningInjector.ts` | system prompt 注入區塊組裝 | 修改：`buildCraftMemoryBlock` → `buildCapabilityBlock` |
| `server/src/agentLoader.ts` | agent 載入、分類 | 修改：匯出 `categoryFor` |
| `server/src/agentManager.ts` | session 啟動、system prompt 組裝 | 修改：注入接線 |
| `server/src/index.ts` | HTTP / socket 路由 | 修改：approve 路由 + `/api/learning/run` |
| `client/src/components/CapabilityLearningPanel.tsx` | 能力學習啟動面板 | 新建 |
| `client/src/App.tsx` | 主框架 | 修改：掛載新面板 |
| `server/src/store.category.test.ts` | 類記憶測試 | 新建 |
| `server/src/capabilityPrompts.test.ts` | prompt 純函式測試 | 新建 |
| `server/src/capabilityLearning.test.ts` | ingest / run 狀態機測試 | 新建 |
| `server/src/learningInjector.test.ts` | 注入區塊測試 | 修改：改測 `buildCapabilityBlock` |

所有 server 測試指令在 `server/` 目錄下執行：`cd server`。

---

## 任務 1：類層記憶 — DB 表與 store 函式

**文件：**
- 修改：`server/src/db.ts`（`SCHEMA` 常數內）
- 修改：`server/src/learningStore.ts`
- 測試：`server/src/store.category.test.ts`

- [ ] **步驟 1：加 DB 表**

在 `server/src/db.ts` 的 `SCHEMA` 模板字串末尾（`agent_craft_memory` 表定義之後、結尾反引號之前）加入：

```sql
CREATE TABLE IF NOT EXISTS category_capability_memory (
  category   TEXT PRIMARY KEY,
  content    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
```

`db.exec(SCHEMA)` 已在既有程式碼中呼叫（`CREATE TABLE IF NOT EXISTS` 對既有 DB 冪等），不需額外 migration。

- [ ] **步驟 2：寫失敗的測試**

建立 `server/src/store.category.test.ts`：

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { getCategoryMemory, appendCategoryMemory } from "./learningStore.js";
import { db } from "./db.js";

const CAT = "test-cap-cat";

describe("category capability memory", () => {
  afterAll(() => {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT);
  });

  it("未寫入時回傳空字串", () => {
    expect(getCategoryMemory("nonexistent-cat-xyz")).toBe("");
  });

  it("appendCategoryMemory 寫入並可讀回，帶日期前綴", () => {
    appendCategoryMemory(CAT, "頂尖專家要懂得量化決策");
    const m = getCategoryMemory(CAT);
    expect(m).toContain("頂尖專家要懂得量化決策");
    expect(m).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] /);
  });

  it("再次 append 累加成多行（UPSERT 不覆蓋）", () => {
    appendCategoryMemory(CAT, "第二條能力");
    const m = getCategoryMemory(CAT);
    expect(m).toContain("頂尖專家要懂得量化決策");
    expect(m).toContain("第二條能力");
    expect(m.split("\n").length).toBe(2);
  });
});
```

- [ ] **步驟 3：運行測試驗證失敗**

運行：`cd server && npx vitest run src/store.category.test.ts`
預期：FAIL，報錯 `getCategoryMemory is not a function` / `appendCategoryMemory is not a function`。

- [ ] **步驟 4：實現 store 函式**

在 `server/src/learningStore.ts` 末尾（`appendCraftMemory` 之後）加入。`CRAFT_CAP` 常數已在該檔定義（值 4000），直接複用：

```typescript
// --- 類層能力記憶（category-global，跨工作區，同類 agent 共享）---

export function getCategoryMemory(categoryId: string): string {
  const r = db.prepare("SELECT content FROM category_capability_memory WHERE category = ?").get(categoryId) as any;
  return r?.content || "";
}

export function appendCategoryMemory(categoryId: string, entry: string): void {
  const cur = getCategoryMemory(categoryId).trim();
  const ts = new Date().toISOString().slice(0, 10);
  const line = `- [${ts}] ${entry.trim()}`;
  let next = cur ? `${cur}\n${line}` : line;
  if (next.length > CRAFT_CAP) next = "(舊能力記憶已壓縮)\n" + next.slice(-(CRAFT_CAP - 200));
  db.prepare(`
    INSERT INTO category_capability_memory (category, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(categoryId, next, Date.now());
}
```

- [ ] **步驟 5：運行測試驗證通過**

運行：`cd server && npx vitest run src/store.category.test.ts`
預期：PASS（3 個測試）。

- [ ] **步驟 6：Commit**

```bash
git add server/src/db.ts server/src/learningStore.ts server/src/store.category.test.ts
git commit -m "feat: 類層能力記憶 — category_capability_memory 表與 store 函式"
```

---

## 任務 2：LearnScope 擴充與 prompt 純函式

**文件：**
- 修改：`server/src/learningCapture.ts:7`
- 創建：`server/src/capabilityPrompts.ts`
- 測試：`server/src/capabilityPrompts.test.ts`

- [ ] **步驟 1：擴充 LearnScope 型別**

在 `server/src/learningCapture.ts` 第 7 行，把：

```typescript
export type LearnScope = "workspace" | "agent-global";
```

改為：

```typescript
export type LearnScope = "workspace" | "agent-global" | "category";
```

`deriveScope` 不需改（它永不回傳 `"category"`；類層 scope 由 runner 明確指定）。

- [ ] **步驟 2：寫失敗的測試**

建立 `server/src/capabilityPrompts.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { buildCategoryLearningPrompt, buildAgentLearningPrompt } from "./capabilityPrompts.js";

describe("buildCategoryLearningPrompt", () => {
  it("含類別名稱與 domain 標記指示", () => {
    const p = buildCategoryLearningPrompt("行銷部");
    expect(p).toContain("行銷部");
    expect(p).toContain("=== LEARN kind=domain ===");
    expect(p).toContain("5-8");
  });
});

describe("buildAgentLearningPrompt", () => {
  it("含 agent 名稱、描述與 craft 標記指示", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "專注抖音平台的短視頻營銷專家", "");
    expect(p).toContain("抖音策略師");
    expect(p).toContain("專注抖音平台的短視頻營銷專家");
    expect(p).toContain("=== LEARN kind=craft ===");
  });

  it("類記憶為空時不出現「類共通能力」段落", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "描述", "");
    expect(p).not.toContain("類共通能力");
  });

  it("類記憶非空時帶入「類共通能力」段落與內容", () => {
    const p = buildAgentLearningPrompt("抖音策略師", "描述", "- [2026-05-21] 要懂演算法");
    expect(p).toContain("類共通能力");
    expect(p).toContain("要懂演算法");
  });
});
```

- [ ] **步驟 3：運行測試驗證失敗**

運行：`cd server && npx vitest run src/capabilityPrompts.test.ts`
預期：FAIL，報錯找不到模組 `./capabilityPrompts.js`。

- [ ] **步驟 4：實現 prompt 純函式**

建立 `server/src/capabilityPrompts.ts`：

```typescript
/**
 * 能力學習 prompt 組裝 — 純函式，不依賴 DB / 子行程，方便單元測試。
 */

/** 類層學習：要 agent 以「領域總監」視角盤點該類別頂尖專家的核心能力。 */
export function buildCategoryLearningPrompt(categoryLabel: string): string {
  return `你是統籌「${categoryLabel}」整個部門全體專家的領域總監，見過這個領域最頂尖的人才。

# 任務
盤點：一個世界頂尖的「${categoryLabel}」專家，必須內化哪些**核心能力與專業判斷**？
寫出 5-8 條。每條是一句可直接內化、能指導實際工作的能力要點或專業心法，**不超過 200 字**，具體、可操作，不要空話套話。

# 輸出格式
每條能力用下面的標記包起來（kind 固定為 domain）：

=== LEARN kind=domain ===
能力要點內容
=== END LEARN ===

直接輸出 5-8 個這樣的標記區塊，不要前言、不要編號、不要額外解釋。`;
}

/** 個人層學習：在類共通能力之上，要 agent 盤點自己角色獨有的手藝。 */
export function buildAgentLearningPrompt(
  agentName: string,
  agentDescription: string,
  categoryMemory: string,
): string {
  const cat = (categoryMemory || "").trim();
  const catBlock = cat
    ? `\n# 你所屬領域的類共通能力（你已具備）\n${cat}\n`
    : "";
  const onTop = cat ? "在上述類共通能力之上" : "在你的專業角色基礎上";
  const avoid = cat ? "避免與上述類共通能力重複，" : "";
  return `你是「${agentName}」。${agentDescription}
${catBlock}
# 任務
${onTop}，作為更具體、更專精的「${agentName}」，你還需要哪些**獨有的**專業細節、手藝、判斷，才能比同領域的一般專家更強？
寫出 3-5 條。每條聚焦你這個角色**獨有**的東西，${avoid}**不超過 200 字**，具體可操作。

# 輸出格式
每條用下面的標記包起來（kind 固定為 craft）：

=== LEARN kind=craft ===
手藝要點內容
=== END LEARN ===

直接輸出 3-5 個這樣的標記區塊，不要前言、不要編號、不要額外解釋。`;
}
```

- [ ] **步驟 5：運行測試驗證通過**

運行：`cd server && npx vitest run src/capabilityPrompts.test.ts`
預期：PASS（4 個測試）。

- [ ] **步驟 6：Commit**

```bash
git add server/src/learningCapture.ts server/src/capabilityPrompts.ts server/src/capabilityPrompts.test.ts
git commit -m "feat: 能力學習 prompt 純函式與 LearnScope category 取值"
```

---

## 任務 3：能力學習 runner — 提案寫入與單目標執行

**文件：**
- 創建：`server/src/capabilityLearning.ts`
- 測試：`server/src/capabilityLearning.test.ts`

- [ ] **步驟 1：寫失敗的測試**

建立 `server/src/capabilityLearning.test.ts`（先只測 `ingestLearningOutput` 與 `parseCategoryAgentId`，這兩個不需子行程）：

```typescript
import { describe, it, expect, afterAll } from "vitest";
import {
  ingestLearningOutput, parseCategoryAgentId, CATEGORY_PREFIX,
} from "./capabilityLearning.js";
import { db } from "./db.js";

const CAT = "test-ingest-cat";

describe("parseCategoryAgentId", () => {
  it("解析帶前綴的 agentId", () => {
    expect(parseCategoryAgentId(CATEGORY_PREFIX + "marketing")).toBe("marketing");
  });
  it("無前綴回傳 null", () => {
    expect(parseCategoryAgentId("marketing-content-creator")).toBeNull();
  });
});

describe("ingestLearningOutput", () => {
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + CAT);
  });

  it("解析類層輸出，建立 scope=category 的提案", () => {
    const text = [
      "=== LEARN kind=domain ===",
      "頂尖專家要會量化決策",
      "=== END LEARN ===",
      "=== LEARN kind=domain ===",
      "頂尖專家要持續追蹤產業動態",
      "=== END LEARN ===",
    ].join("\n");
    const created = ingestLearningOutput(text, { type: "category", id: CAT });
    expect(created).toBe(2);
    const rows = db.prepare(
      "SELECT scope, kind FROM learning_proposals WHERE agent_id = ?",
    ).all(CATEGORY_PREFIX + CAT) as any[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scope === "category" && r.kind === "domain")).toBe(true);
  });

  it("沒有標記時回傳 0", () => {
    expect(ingestLearningOutput("普通文字沒有標記", { type: "category", id: CAT })).toBe(0);
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：FAIL，報錯找不到模組 `./capabilityLearning.js`。

- [ ] **步驟 3：實現 capabilityLearning 模組**

建立 `server/src/capabilityLearning.ts`：

```typescript
/**
 * 能力學習 runner — 用一次性 Claude CLI 呼叫產生學習提案。
 * 兩層：類層（category）產出 domain 提案、個人層（agent）產出 craft 提案，
 * 全部寫進既有的 learning_proposals 表，走 Phase 1 的批准 UI。
 */
import { spawnClaude } from "./claudeProcess.js";
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCategoryMemory } from "./learningStore.js";
import { DEFAULT_WORKSPACE_ID } from "./db.js";
import { loadAgents, categoryLabel } from "./agentLoader.js";
import { buildCategoryLearningPrompt, buildAgentLearningPrompt } from "./capabilityPrompts.js";

/** 類層提案的 agent_id 前綴 — 避免與真實 agentId 撞名。 */
export const CATEGORY_PREFIX = "__category__:";

/** 能力學習用的模型：一次性反思任務，重品質但非 Opus。 */
const LEARNING_MODEL = "claude-sonnet-4-6";

export interface LearnTarget {
  type: "category" | "agent";
  id: string; // category id 或 agent id
}

/** 從類層提案的 agent_id 取回 categoryId；非類層格式回傳 null。 */
export function parseCategoryAgentId(agentId: string): string | null {
  return agentId.startsWith(CATEGORY_PREFIX) ? agentId.slice(CATEGORY_PREFIX.length) : null;
}

/**
 * 把 Claude 回應文字解析成學習提案並寫入 DB，回傳實際建立的提案數
 * （createProposal 內建去重，重複的不計入）。
 */
export function ingestLearningOutput(text: string, target: LearnTarget): number {
  const drafts = parseLearnMarkers(text);
  let created = 0;
  for (const d of drafts) {
    const proposal = target.type === "category"
      ? createProposal({
          agentId: CATEGORY_PREFIX + target.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          kind: "domain",
          scope: "category",
          content: d.content,
          source: "capability-learning:category",
        })
      : createProposal({
          agentId: target.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          kind: "craft",
          scope: "agent-global",
          content: d.content,
          source: "capability-learning:agent",
        });
    if (proposal) created++;
  }
  return created;
}

/** 一次性非互動呼叫 Claude，回傳 result 文字。失敗則 throw。 */
function runClaudeOnce(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnClaude([
      "-p", "--output-format", "json",
      "--model", LEARNING_MODEL,
      "--no-session-persistence",
      "--disable-slash-commands",
    ]);
    let out = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d) => {
      out += String(d);
      if (out.length > 5_000_000) { child.kill(); reject(new Error("輸出超過上限")); }
    });
    child.stderr!.on("data", () => {});
    child.stdin!.write(Buffer.from(prompt, "utf8"));
    child.stdin!.end();
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error(`claude exit ${code}`)); return; }
      try {
        const j = JSON.parse(out);
        resolve(String(j.result || ""));
      } catch (e: any) {
        reject(new Error(`解析回應失敗: ${e.message}`));
      }
    });
  });
}

/** 跑單一 target 的能力學習，回傳建立的提案數。 */
export async function runLearningTarget(target: LearnTarget): Promise<{ created: number }> {
  let prompt: string;
  if (target.type === "category") {
    prompt = buildCategoryLearningPrompt(categoryLabel(target.id));
  } else {
    const agent = loadAgents().find((a) => a.id === target.id);
    if (!agent) throw new Error(`找不到 agent: ${target.id}`);
    const catMem = getCategoryMemory(agent.category);
    prompt = buildAgentLearningPrompt(agent.name, agent.description, catMem);
  }
  const text = await runClaudeOnce(prompt);
  const created = ingestLearningOutput(text, target);
  if (created === 0 && !parseLearnMarkers(text).length) {
    throw new Error("回應未包含任何學習標記");
  }
  return { created };
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：PASS（4 個測試）。`runClaudeOnce` / `runLearningTarget` 不在本任務測試（需真實 Claude，於任務 8 端到端驗證）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/capabilityLearning.ts server/src/capabilityLearning.test.ts
git commit -m "feat: 能力學習 runner — 提案寫入與單目標執行"
```

---

## 任務 4：approve 路由 — 類層提案分支

**文件：**
- 修改：`server/src/index.ts:990-1007`（`/api/learning/proposals/:id/approve`）

- [ ] **步驟 1：寫失敗的測試**

在 `server/src/capabilityLearning.test.ts` 末尾追加一段，驗證「類層提案批准後寫進類記憶」的完整鏈路（直接驅動 store 層，模擬 approve 路由會做的事）：

```typescript
import { getCategoryMemory } from "./learningStore.js";
import { getProposal, setProposalStatus, appendCraftMemory } from "./learningStore.js";
import { appendCategoryMemory } from "./learningStore.js";

describe("approve 類層提案 → 寫進類記憶", () => {
  const CAT2 = "test-approve-cat";
  afterAll(() => {
    db.prepare("DELETE FROM learning_proposals WHERE agent_id = ?").run(CATEGORY_PREFIX + CAT2);
    db.prepare("DELETE FROM category_capability_memory WHERE category = ?").run(CAT2);
  });

  it("scope=category 的提案，依 agent_id 前綴寫進 category memory", () => {
    ingestLearningOutput(
      "=== LEARN kind=domain ===\n批准測試能力\n=== END LEARN ===",
      { type: "category", id: CAT2 },
    );
    const row = db.prepare(
      "SELECT id FROM learning_proposals WHERE agent_id = ? LIMIT 1",
    ).get(CATEGORY_PREFIX + CAT2) as any;
    const p = getProposal(row.id)!;
    // 模擬 approve 路由的副作用分支
    const categoryId = parseCategoryAgentId(p.agentId);
    expect(categoryId).toBe(CAT2);
    appendCategoryMemory(categoryId!, p.content);
    expect(getCategoryMemory(CAT2)).toContain("批准測試能力");
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：FAIL — 此測試新增前 `capabilityLearning.test.ts` 不含此 describe；加入後因尚未確認 import 正確會先紅。確認失敗訊息是斷言或 import，而非語法錯誤。

> 註：此測試實際驗證的是 store 層鏈路。路由本身的接線於任務 8 端到端驗證。

- [ ] **步驟 3：實現 approve 路由分支**

修改 `server/src/index.ts`。先在檔案上方 import 區（既有 `from "./learningStore.js"` 那段）把 `appendCategoryMemory` 加入：

```typescript
  getCraftMemory, appendCraftMemory, appendCategoryMemory,
```

再從 `capabilityLearning.js` import `parseCategoryAgentId`（在既有 import 區新增一行）：

```typescript
import { parseCategoryAgentId } from "./capabilityLearning.js";
```

然後把 `/api/learning/proposals/:id/approve` 路由（原 990-1007 行）改為——注意：類別格式驗證必須在 `setProposalStatus`（CAS 搶占）**之前**，避免提案被標記 approved 卻沒寫入記憶：

```typescript
app.post("/api/learning/proposals/:id/approve", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });

  // 類層提案：先驗證 agent_id 前綴格式，格式異常直接拒絕、不搶占。
  let categoryId: string | null = null;
  if (p.scope === "category") {
    categoryId = parseCategoryAgentId(p.agentId);
    if (!categoryId) return res.status(400).json({ error: "類別提案格式異常" });
  }

  // 以 CAS 搶占標記，確保並發 / 重送下只有一個請求會執行副作用
  const claimed = setProposalStatus(p.id, "approved");
  if (!claimed) return res.status(409).json({ error: "提案已處理過" });
  try {
    if (p.scope === "category") {
      appendCategoryMemory(categoryId!, p.content);
    } else if (p.scope === "agent-global") {
      appendCraftMemory(p.agentId, p.content);
    } else {
      appendWorkspaceMemory(p.workspaceId, p.content);
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：PASS（全部，含新增的 approve describe）。

- [ ] **步驟 5：Commit**

```bash
git add server/src/index.ts server/src/capabilityLearning.test.ts
git commit -m "feat: approve 路由支援類層提案，批准後寫進類記憶"
```

---

## 任務 5：兩段式記憶注入

**文件：**
- 修改：`server/src/learningInjector.ts`
- 修改：`server/src/learningInjector.test.ts`
- 修改：`server/src/agentLoader.ts`（匯出 `categoryFor`）
- 修改：`server/src/agentManager.ts`

- [ ] **步驟 1：改寫 learningInjector 測試**

把 `server/src/learningInjector.test.ts` 整檔改為：

```typescript
import { describe, it, expect } from "vitest";
import { buildCapabilityBlock } from "./learningInjector.js";

describe("buildCapabilityBlock", () => {
  it("兩段皆空 → 回傳空字串", () => {
    expect(buildCapabilityBlock("", "")).toBe("");
    expect(buildCapabilityBlock("   ", "  ")).toBe("");
  });

  it("只有類記憶 → 只含類共通能力段，不含個人手藝段", () => {
    const b = buildCapabilityBlock("- [2026-05-21] 類能力", "");
    expect(b).toContain("類共通能力");
    expect(b).toContain("類能力");
    expect(b).not.toContain("個人手藝");
  });

  it("只有個人手藝 → 只含個人手藝段", () => {
    const b = buildCapabilityBlock("", "- [2026-05-21] 個人手藝條目");
    expect(b).toContain("個人手藝");
    expect(b).toContain("個人手藝條目");
    expect(b).not.toContain("類共通能力");
  });

  it("兩段都有 → 兩段都在", () => {
    const b = buildCapabilityBlock("類能力 X", "個人手藝 Y");
    expect(b).toContain("類能力 X");
    expect(b).toContain("個人手藝 Y");
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/learningInjector.test.ts`
預期：FAIL，報錯 `buildCapabilityBlock is not a function`（`learningInjector.ts` 目前只匯出 `buildCraftMemoryBlock`）。

- [ ] **步驟 3：改寫 learningInjector.ts**

把 `server/src/learningInjector.ts` 整檔改為：

```typescript
/**
 * 學習回灌 — 把類層能力記憶 + 個人手藝記憶組成 system prompt 注入塊。
 * 工作區客戶檔案沿用 agentManager 既有的 workspace.memory 注入，此處不重複。
 */

export function buildCapabilityBlock(categoryContent: string, craftContent: string): string {
  const cat = (categoryContent || "").trim();
  const craft = (craftContent || "").trim();
  let out = "";
  if (cat) {
    out += `\n\n# 你所屬領域的類共通能力
以下是你這個專業領域頂尖專家共通的核心能力與判斷，經使用者批准。請當成你的專業底盤：

${cat}
`;
  }
  if (craft) {
    out += `\n\n# 你累積的個人手藝與領域知識
以下是你過去執行任務時提煉、並經使用者批准的個人專業經驗。請當成你的獨門底牌，主動運用：

${craft}
`;
  }
  return out;
}
```

- [ ] **步驟 4：匯出 categoryFor**

在 `server/src/agentLoader.ts`，把第 98 行的函式宣告 `function categoryFor(id: string): string {` 改為加上 `export`：

```typescript
export function categoryFor(id: string): string {
```

（此函式用已快取的 `repoMapCache`，呼叫成本極低，不會觸發 213 檔重讀。）

- [ ] **步驟 5：接線 agentManager**

修改 `server/src/agentManager.ts`：

(a) 第 10 行的 import 改為：

```typescript
import { buildCapabilityBlock } from "./learningInjector.js";
```

(b) 第 9 行的 import 加上 `getCategoryMemory`：

```typescript
import { createProposal, getCraftMemory, getCategoryMemory } from "./learningStore.js";
```

(c) 第 11 行的 import 加上 `categoryFor`：

```typescript
import { readAgentDefinition, categoryFor } from "./agentLoader.js";
```

(d) 第 121 行：

```typescript
    const craftBlock = buildCraftMemoryBlock(getCraftMemory(agentId));
```

改為：

```typescript
    const craftBlock = buildCapabilityBlock(
      getCategoryMemory(categoryFor(agentId)),
      getCraftMemory(agentId),
    );
```

- [ ] **步驟 6：運行測試驗證通過**

運行：`cd server && npx vitest run src/learningInjector.test.ts`
預期：PASS（4 個測試）。

再跑全套確認沒打壞別的：`cd server && npx vitest run`
預期：全綠。

- [ ] **步驟 7：Commit**

```bash
git add server/src/learningInjector.ts server/src/learningInjector.test.ts server/src/agentLoader.ts server/src/agentManager.ts
git commit -m "feat: 兩段式記憶注入 — 類共通能力 + 個人手藝"
```

---

## 任務 6：學習 run 狀態機與 API

**文件：**
- 修改：`server/src/capabilityLearning.ts`（加 run 狀態機）
- 修改：`server/src/capabilityLearning.test.ts`（測狀態機）
- 修改：`server/src/index.ts`（加 `/api/learning/run` 路由）

- [ ] **步驟 1：寫失敗的測試**

在 `server/src/capabilityLearning.test.ts` 末尾追加：

```typescript
import { executeLearningRun, type LearningRun } from "./capabilityLearning.js";

describe("executeLearningRun", () => {
  function makeRun(targets: LearnTarget[]): LearningRun {
    return {
      id: "run_test", targets, status: "running",
      total: targets.length, done: 0, current: null,
      failed: [], createdProposals: 0,
    };
  }

  it("全部成功 → status done、done 計數正確、累計提案數", async () => {
    const run = makeRun([
      { type: "category", id: "a" },
      { type: "category", id: "b" },
    ]);
    const progress: number[] = [];
    await executeLearningRun(run, async () => ({ created: 3 }), (r) => progress.push(r.done));
    expect(run.status).toBe("done");
    expect(run.done).toBe(2);
    expect(run.createdProposals).toBe(6);
    expect(progress).toEqual([1, 2]);
  });

  it("單一 target 失敗 → 記入 failed、繼續跑完、status done", async () => {
    const run = makeRun([
      { type: "category", id: "ok" },
      { type: "category", id: "bad" },
    ]);
    await executeLearningRun(
      run,
      async (t) => {
        if (t.id === "bad") throw new Error("壞掉了");
        return { created: 1 };
      },
      () => {},
    );
    expect(run.status).toBe("done");
    expect(run.done).toBe(2);
    expect(run.failed).toHaveLength(1);
    expect(run.failed[0].error).toContain("壞掉了");
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：FAIL，報錯 `executeLearningRun is not a function`。

- [ ] **步驟 3：實現 run 狀態機**

在 `server/src/capabilityLearning.ts` 末尾加入：

```typescript
// --- 學習 run 狀態機 ---

export interface LearningRun {
  id: string;
  targets: LearnTarget[];
  status: "running" | "done" | "error";
  total: number;
  done: number;
  current: string | null;
  failed: { target: string; error: string }[];
  createdProposals: number;
}

const runs = new Map<string, LearningRun>();

export function getLearningRun(id: string): LearningRun | undefined {
  return runs.get(id);
}

/**
 * 序列執行一個 run：逐一處理 target，每完成一個呼叫 onProgress。
 * worker 注入以利測試；正式呼叫傳 runLearningTarget。
 */
export async function executeLearningRun(
  run: LearningRun,
  worker: (t: LearnTarget) => Promise<{ created: number }>,
  onProgress: (run: LearningRun) => void,
): Promise<void> {
  for (const t of run.targets) {
    run.current = `${t.type}:${t.id}`;
    try {
      const { created } = await worker(t);
      run.createdProposals += created;
    } catch (e: any) {
      run.failed.push({ target: `${t.type}:${t.id}`, error: e?.message || String(e) });
    }
    run.done++;
    onProgress(run);
  }
  run.current = null;
  run.status = "done";
}

/** 建立並登記一個新 run（狀態機初始值）。 */
export function createLearningRun(targets: LearnTarget[]): LearningRun {
  const run: LearningRun = {
    id: `lrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    targets, status: "running",
    total: targets.length, done: 0, current: null,
    failed: [], createdProposals: 0,
  };
  runs.set(run.id, run);
  return run;
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/capabilityLearning.test.ts`
預期：PASS（含新增 2 個 executeLearningRun 測試）。

- [ ] **步驟 5：加 API 路由**

修改 `server/src/index.ts`。在 import 區把 `capabilityLearning.js` 的 import 補齊：

```typescript
import {
  parseCategoryAgentId, createLearningRun, executeLearningRun,
  getLearningRun, runLearningTarget,
} from "./capabilityLearning.js";
```

在 `/api/learning/craft` 路由（原 1017-1021 行）之後加入：

```typescript
// 啟動能力學習 run — 序列逐一跑，socket 推進度。
app.post("/api/learning/run", (req, res) => {
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const clean = targets.filter(
    (t: any) => t && (t.type === "category" || t.type === "agent") && typeof t.id === "string",
  );
  if (clean.length === 0) return res.status(400).json({ error: "targets 不可為空" });

  const run = createLearningRun(clean);
  res.json({ runId: run.id, total: run.total });

  // 背景序列執行，不阻塞回應
  executeLearningRun(run, runLearningTarget, (r) => {
    io.emit("learning:progress", {
      runId: r.id, status: r.status, total: r.total, done: r.done,
      current: r.current, failed: r.failed, createdProposals: r.createdProposals,
    });
  }).catch((e) => {
    run.status = "error";
    console.warn("[capability-learning] run failed:", e?.message || e);
  });
});

// 查詢 run 進度
app.get("/api/learning/run/:id", (req, res) => {
  const run = getLearningRun(req.params.id);
  if (!run) return res.status(404).json({ error: "找不到 run" });
  res.json(run);
});
```

> `io` 是既有的 socket.io 實例（`index.ts` 下方 `--- HTTP server + Socket.IO ---` 區段已建立）。若 `app.post("/api/learning/run")` 位置在 `io` 宣告之前導致 TS 報未定義，把這兩個路由移到 `io` 宣告之後、socket handler 註冊區附近即可。

- [ ] **步驟 6：型別檢查**

運行：`cd server && npx tsc --noEmit -p . 2>&1 | grep -E "capabilityLearning|index.ts"`
預期：無輸出（我方檔案零型別錯誤；既有的 `memoryDistiller.ts` / `scheduler.ts` / `workflowRunner.ts` 錯誤與本任務無關，忽略）。

- [ ] **步驟 7：Commit**

```bash
git add server/src/capabilityLearning.ts server/src/capabilityLearning.test.ts server/src/index.ts
git commit -m "feat: 能力學習 run 狀態機與 /api/learning/run API"
```

---

## 任務 7：前端 — 能力學習面板

**文件：**
- 創建：`client/src/components/CapabilityLearningPanel.tsx`
- 修改：`client/src/App.tsx`

> **TDD 例外說明：** client 端目前無測試基建（零 `*.test.tsx`、無 vitest/jsdom 設定）。本任務為純 UI，遵循專案既有慣例以瀏覽器手動驗證（任務 8），不新建客戶端測試框架（屬範圍蔓延）。

- [ ] **步驟 1：研讀既有面板模式**

閱讀 `client/src/components/LearningQueuePanel.tsx`（3.4KB，最接近的同類面板）與 `client/src/components/SchedulePanel.tsx`，比對：如何 `fetch` API、如何訂閱 socket、面板容器的 className 慣例、如何透過 props 從 `App.tsx` 取得 `workspace` / socket 實例。`CapabilityLearningPanel` 必須沿用同樣的 fetch 慣例（相對路徑 `/api/...`，Vite proxy 已設）與視覺風格。

- [ ] **步驟 2：建立面板元件**

建立 `client/src/components/CapabilityLearningPanel.tsx`。需求（實作時對齊既有面板的 className 與 socket 取得方式）：

```tsx
import { useEffect, useState } from "react";

interface AgentMeta { id: string; name: string; category: string; }
interface Category { id: string; label: string; count: number; }
interface RunProgress {
  runId: string; status: string; total: number; done: number;
  current: string | null;
  failed: { target: string; error: string }[];
  createdProposals: number;
}

// socket 實例由 App.tsx 透過 prop 傳入（沿用 LearningQueuePanel 取得 socket 的同款做法）。
export function CapabilityLearningPanel({ socket }: { socket: any }) {
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // "category:<id>" / "agent:<id>"
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => { setAgents(d.agents || []); setCategories(d.categories || []); });
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onProg = (p: RunProgress) => {
      setProgress(p);
      if (p.status === "done" || p.status === "error") setBusy(false);
    };
    socket.on("learning:progress", onProg);
    return () => socket.off("learning:progress", onProg);
  }, [socket]);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function start() {
    const targets = [...picked].map((k) => {
      const [type, ...rest] = k.split(":");
      return { type, id: rest.join(":") };
    });
    if (targets.length === 0) return;
    setBusy(true);
    setProgress(null);
    const r = await fetch("/api/learning/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    if (!r.ok) { setBusy(false); alert("啟動失敗"); }
  }

  // 渲染：
  // 1. 引導文案：「建議先跑類別 → 到學習佇列批准 → 再跑個別 agent」
  // 2. 類別清單，每個可勾選（key = "category:<id>"），顯示該類 agent 數，可展開列出該類 agent（key = "agent:<id>"）
  // 3. 「開始學習（已選 N 個）」按鈕，busy 時 disabled
  // 4. progress 區：進度條 done/total、current 文字、failed 清單
  // 5. 跑完（status==="done"）顯示「已產生 createdProposals 條提案，請到『學習佇列』批准」
  // className 與容器結構對齊 LearningQueuePanel。
  return (/* 依上述需求實作，沿用既有面板樣式 */ null);
}
```

> 步驟 2 的 `return` 必須實作成完整 JSX（上面註解列出全部 5 塊渲染需求）。元件邏輯（state、fetch、socket）已完整給出，只有 JSX 樣式需對齊 `LearningQueuePanel`。

- [ ] **步驟 3：掛載到 App.tsx**

在 `client/src/App.tsx`：
(a) 頂部 import 加：`import { CapabilityLearningPanel } from "./components/CapabilityLearningPanel";`
(b) 比照 `LearningQueuePanel` 既有的掛載方式（找到 App.tsx 中 `LearningQueuePanel` 出現處），在同一層級加入 `CapabilityLearningPanel`，並把既有的 socket 實例以 `socket={socket}` 傳入。若 `LearningQueuePanel` 是透過某個視圖切換（view/tab）顯示，`CapabilityLearningPanel` 加一個同款入口。

- [ ] **步驟 4：建置驗證**

運行：`cd client && npx tsc -b`
預期：無錯誤。

- [ ] **步驟 5：Commit**

```bash
git add client/src/components/CapabilityLearningPanel.tsx client/src/App.tsx
git commit -m "feat: 能力學習面板 — 勾選類別/agent 啟動學習進程"
```

---

## 任務 8：端到端驗證

**文件：** 無（驗證任務）

- [ ] **步驟 1：啟動 dashboard**

確認 `npm run dev` 在跑（server 5191 / client 5190）。tsx watch 會自動套用 server 變更。

- [ ] **步驟 2：跑一個類別的能力學習**

瀏覽器開 `http://localhost:5190`，進「能力學習」面板，勾選**一個**類別（例如「設計部」），按「開始學習」。觀察：
- 進度條從 0 推進、`current` 有顯示
- 跑完顯示「已產生 N 條提案」（N 應為 5-8）

- [ ] **步驟 3：批准並驗證類記憶**

到「學習佇列」（`LearningQueuePanel`），確認出現該類別的 `domain` 提案，逐條批准。
用 API 驗證類記憶已寫入：

```bash
curl -s "http://localhost:5191/api/agents" >/dev/null   # 確認 server 活著
# 直接查 DB（PowerShell 下用 node 一次性查）：
node -e "const{db}=require('./server/dist/db.js')" 2>/dev/null || echo "改用下一步的注入驗證"
```

> 若不便直接查 DB，跳到步驟 4 用「注入」間接驗證。

- [ ] **步驟 4：驗證注入生效**

在 dashboard 對該類別底下任一 agent **新開**一個對話，第一句問：「請問你目前累積了哪些『類共通能力』？直接複述。」
預期：agent 能複述剛批准的類能力條目 → 證明 `buildCapabilityBlock` 注入鏈路打通。

> 注意：注入只在新開對話時建立 system prompt，進行中的舊對話看不到（與 Phase 1 craft 注入行為一致）。

- [ ] **步驟 5：跑個人層並驗證**

回能力學習面板，展開該類別、勾選**一個** agent，開始學習。批准其 `craft` 提案後，新開對話問該 agent：「你有哪些『個人手藝』？」
預期：能複述個人手藝條目，且與類共通能力是分開的兩段。

- [ ] **步驟 6：跑全套測試與型別檢查**

```bash
cd server && npx vitest run
```
預期：全綠（含本計劃新增的 store.category / capabilityPrompts / capabilityLearning / learningInjector 測試）。

```bash
cd server && npx tsc --noEmit -p .
```
預期：僅既有的 `memoryDistiller.ts` / `scheduler.ts` / `workflowRunner.ts` 錯誤（與本功能無關），本計劃新增 / 修改的檔案零錯誤。

- [ ] **步驟 7：最終 commit（若步驟中有修補）**

```bash
git add -A
git commit -m "test: 能力學習進程端到端驗證通過"
```

---

## 自檢結果

**規格覆蓋度：** 規格 §4.1 資料模型→任務 1+2；§4.2 capabilityLearning→任務 3；§4.3 learningStore→任務 1；§4.4 approve→任務 4；§4.5 注入→任務 5；§4.6 API→任務 6；§4.7 UI→任務 7；§6 錯誤處理→任務 3（輸出上限、解析失敗 throw）+任務 6（failed 清單）；§7 測試→各任務 TDD 步驟；§8 實作順序→任務編號一致。全部覆蓋。

**占位符掃描：** 任務 7 步驟 2 的 JSX `return` 是唯一「描述需求而非給完整碼」處——已明確標註元件邏輯（state/fetch/socket）完整給出、僅 JSX 需對齊既有面板，並列出全部 5 塊渲染需求，屬「遵循既有模式」的合理留白，非占位符。其餘步驟均含完整可執行碼。

**類型一致性：** `LearnTarget` / `LearningRun` / `CATEGORY_PREFIX` / `parseCategoryAgentId` / `ingestLearningOutput` / `runLearningTarget` / `executeLearningRun` / `createLearningRun` / `getLearningRun` 跨任務 3、4、6 命名一致；`buildCapabilityBlock` 跨任務 5 一致；`getCategoryMemory` / `appendCategoryMemory` 跨任務 1、3、4、5 一致。
