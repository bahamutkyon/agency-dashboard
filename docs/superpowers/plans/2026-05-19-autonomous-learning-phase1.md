# 自主學習系統 Phase 1（學習引擎）實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推薦）或 superpowers:executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟蹤進度。

**目標：** 讓 agent 能在對話中提出「學習提案」，使用者在審核佇列批准後，學習成果回灌進 agent 能力。

**架構：** agent 在回應末尾輸出 `LEARN` 標記 → 後端解析成「學習提案」存入 SQLite（pending）→ 使用者在前端面板批准/拒絕 → 批准的提案按 scope 寫入「工作區客戶檔案」（沿用既有 `workspace.memory`）或「agent 手藝記憶」（新表）→ 下次 agent 啟動時注入手藝記憶。純邏輯（標記解析、去重、注入塊組裝）抽成無 DB 依賴的純函式以便單元測試。

**技術棧：** TypeScript（ESM）、Express、`node:sqlite`、React + Vite + Tailwind、Vitest（本計劃新增）。

**Phase 1 範圍說明：** 本計劃只做「學習引擎」——對話擷取、提案、審核、回灌。不含排程、`craftConsolidator`、`topicTracker`、`tracked_topics` 表（屬 Phase 2）。設計規格提到的「衝突並列標示」在 Phase 1 不做語意矛盾偵測；審核佇列本身即為主要安全閘，並列標示留待後續迭代。

**參考檔案：**
- 設計規格：`docs/superpowers/specs/2026-05-18-autonomous-learning-design.md`
- 既有 DB 模式：`server/src/db.ts`、`server/src/store.ts`
- 既有注入模式：`server/src/skillPriming.ts`、`server/src/agentManager.ts`
- 既有 API 路由模式：`server/src/index.ts`
- 既有面板模式：`client/src/components/NotesPanel.tsx`

---

### 任務 0：安裝 Vitest 測試框架

專案目前無任何測試基礎設施。Vitest 原生支援 ESM + TypeScript，無需額外設定檔。

**文件：**
- 修改：`server/package.json`

- [ ] **步驟 1：加入 vitest 依賴與 test script**

修改 `server/package.json`，在 `scripts` 加一行、在 `devDependencies` 加一行：

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "mcp": "tsx src/mcpServer.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.9.0",
    "@types/node-cron": "^3.0.11",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **步驟 2：安裝**

運行：`cd server && npm install`
預期：vitest 安裝成功，無錯誤。

- [ ] **步驟 3：驗證 vitest 可執行**

運行：`cd server && npx vitest run`
預期：vitest 啟動，回報 "No test files found"（此時尚無測試檔），exit code 0 或提示無檔案——只要 vitest 本身能跑起來即可。

- [ ] **步驟 4：Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: 加入 vitest 測試框架"
```

---

### 任務 1：新增資料表 schema

在 `db.ts` 的 `SCHEMA` 常數加入兩張表，沿用既有 `CREATE TABLE IF NOT EXISTS` 慣例。

**文件：**
- 修改：`server/src/db.ts`（`SCHEMA` 常數，約第 25-146 行之間）

- [ ] **步驟 1：在 SCHEMA 常數末尾（反引號結束前）加入兩張表**

在 `db.ts` 的 `SCHEMA` 模板字串內、`workflow_runs` 表定義之後、結尾反引號之前，加入：

```sql
CREATE TABLE IF NOT EXISTS learning_proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- fact | craft | domain | calibration
  scope TEXT NOT NULL,         -- workspace | agent-global
  content TEXT NOT NULL,
  source TEXT NOT NULL,        -- e.g. conversation:<sessionId>
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lp_status ON learning_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_agent ON learning_proposals(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_craft_memory (
  agent_id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
```

- [ ] **步驟 2：驗證表已建立**

運行：
```bash
cd server && npx tsx -e "import('./src/db.js').then(m => { const r = m.db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('learning_proposals','agent_craft_memory')\").all(); console.log(r); })"
```
預期：輸出包含 `learning_proposals` 與 `agent_craft_memory` 兩列。

- [ ] **步驟 3：Commit**

```bash
git add server/src/db.ts
git commit -m "feat: 學習系統資料表 schema"
```

---

### 任務 2：learningCapture.ts — 標記解析與去重（純函式，TDD）

純函式模組，不依賴 DB。負責把 agent 回應文字解析成學習提案草稿，並提供去重相似度計算。

**文件：**
- 創建：`server/src/learningCapture.ts`
- 測試：`server/src/learningCapture.test.ts`

- [ ] **步驟 1：編寫失敗的測試**

創建 `server/src/learningCapture.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { deriveScope, parseLearnMarkers, similarity, isDuplicate } from "./learningCapture.js";

describe("deriveScope", () => {
  it("fact/calibration → workspace", () => {
    expect(deriveScope("fact")).toBe("workspace");
    expect(deriveScope("calibration")).toBe("workspace");
  });
  it("craft/domain → agent-global", () => {
    expect(deriveScope("craft")).toBe("agent-global");
    expect(deriveScope("domain")).toBe("agent-global");
  });
});

describe("parseLearnMarkers", () => {
  it("解析單一 LEARN 標記並推導 scope", () => {
    const text = "回答內容\n\n=== LEARN kind=craft ===\n標題前 8 字放數字\n=== END LEARN ===";
    const out = parseLearnMarkers(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "craft", scope: "agent-global", content: "標題前 8 字放數字" });
  });

  it("REMEMBER 標記視為 kind=fact、scope=workspace", () => {
    const text = "=== REMEMBER ===\n使用者偏好親切口語\n=== END REMEMBER ===";
    const out = parseLearnMarkers(text);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("fact");
    expect(out[0].scope).toBe("workspace");
    expect(out[0].content).toBe("使用者偏好親切口語");
  });

  it("未知 kind 退回 fact", () => {
    const text = "=== LEARN kind=banana ===\n內容\n=== END LEARN ===";
    expect(parseLearnMarkers(text)[0].kind).toBe("fact");
  });

  it("略過空內容與超過 200 字的內容", () => {
    const long = "x".repeat(201);
    const text = `=== LEARN kind=fact ===\n${long}\n=== END LEARN ===`;
    expect(parseLearnMarkers(text)).toHaveLength(0);
  });

  it("最多回傳 5 條", () => {
    const block = (i: number) => `=== LEARN kind=fact ===\n條目${i}\n=== END LEARN ===`;
    const text = [0, 1, 2, 3, 4, 5, 6].map(block).join("\n");
    expect(parseLearnMarkers(text)).toHaveLength(5);
  });

  it("無標記時回傳空陣列", () => {
    expect(parseLearnMarkers("普通回答，沒有標記")).toEqual([]);
  });
});

describe("similarity / isDuplicate", () => {
  it("完全相同 → 1", () => {
    expect(similarity("使用者偏好口語", "使用者偏好口語")).toBe(1);
  });
  it("完全不同 → 接近 0", () => {
    expect(similarity("抖音演算法", "報稅流程說明")).toBeLessThan(0.3);
  });
  it("isDuplicate：近似內容視為重複", () => {
    expect(isDuplicate("使用者偏好親切口語", ["使用者偏好親切的口語"])).toBe(true);
  });
  it("isDuplicate：不相關內容不算重複", () => {
    expect(isDuplicate("抖音新演算法上線", ["使用者是仲介業者"])).toBe(false);
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/learningCapture.test.ts`
預期：FAIL，報錯找不到 `./learningCapture.js` 模組。

- [ ] **步驟 3：編寫實現代碼**

創建 `server/src/learningCapture.ts`：

```ts
/**
 * 學習擷取 — 從 agent 回應文字解析 LEARN / REMEMBER 標記，轉成學習提案草稿。
 * 純函式，不依賴 DB，方便單元測試。
 */

export type LearnKind = "fact" | "craft" | "domain" | "calibration";
export type LearnScope = "workspace" | "agent-global";

export interface LearnDraft {
  kind: LearnKind;
  scope: LearnScope;
  content: string;
}

const VALID_KINDS: LearnKind[] = ["fact", "craft", "domain", "calibration"];
const MAX_CONTENT_LEN = 200;
const MAX_DRAFTS = 5;

/** kind → scope：fact/calibration 鎖工作區；craft/domain 跟 agent 全域。 */
export function deriveScope(kind: LearnKind): LearnScope {
  return kind === "craft" || kind === "domain" ? "agent-global" : "workspace";
}

/**
 * 解析文字中所有 LEARN 與 REMEMBER 標記。
 *  - === LEARN kind=craft === ... === END LEARN ===
 *  - === REMEMBER === ... === END REMEMBER ===（視為 kind=fact）
 * 略過空內容與超過 200 字的內容；單次最多回傳 5 條。
 */
export function parseLearnMarkers(text: string): LearnDraft[] {
  const out: LearnDraft[] = [];

  const learnRe = /===\s*LEARN\s+kind=(\w+)\s*===\s*\n([\s\S]*?)\n===\s*END\s*LEARN\s*===/gi;
  for (const m of text.matchAll(learnRe)) {
    const content = m[2].trim();
    if (!content || content.length > MAX_CONTENT_LEN) continue;
    const rawKind = m[1].toLowerCase();
    const kind = (VALID_KINDS as string[]).includes(rawKind) ? (rawKind as LearnKind) : "fact";
    out.push({ kind, scope: deriveScope(kind), content });
  }

  const rememberRe = /===\s*REMEMBER\s*===\s*\n([\s\S]*?)\n===\s*END\s*REMEMBER\s*===/gi;
  for (const m of text.matchAll(rememberRe)) {
    const content = m[1].trim();
    if (!content || content.length > MAX_CONTENT_LEN) continue;
    out.push({ kind: "fact", scope: "workspace", content });
  }

  return out.slice(0, MAX_DRAFTS);
}

/**
 * 粗略相似度 — 字元 bigram 的 Jaccard 係數，回傳 0~1。用於提案去重。
 */
export function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const A = norm(a), B = norm(b);
  if (A === B) return 1;
  if (!A || !B) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    if (s.length === 1) { set.add(s); return set; }
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const sa = bigrams(A), sb = bigrams(B);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 內容與既有清單任一條相似度 ≥ 0.8 即視為重複。 */
export function isDuplicate(content: string, existing: string[]): boolean {
  return existing.some((e) => similarity(content, e) >= 0.8);
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/learningCapture.test.ts`
預期：PASS，全部測試通過。

- [ ] **步驟 5：Commit**

```bash
git add server/src/learningCapture.ts server/src/learningCapture.test.ts
git commit -m "feat: 學習標記解析與去重（learningCapture）"
```

---

### 任務 3：learningStore.ts — 提案與手藝記憶的 DB 存取

薄 DB 層，邏輯（去重）已由任務 2 的 `isDuplicate` 提供並測試過。本任務以可執行的 tsx 腳本做端到端驗證。

**文件：**
- 創建：`server/src/learningStore.ts`

- [ ] **步驟 1：編寫實現代碼**

創建 `server/src/learningStore.ts`：

```ts
/**
 * 學習庫 — 學習提案與 agent 手藝記憶的 DB 存取。
 */
import { db } from "./db.js";
import { isDuplicate, type LearnKind, type LearnScope } from "./learningCapture.js";

export interface LearningProposal {
  id: string;
  agentId: string;
  workspaceId: string;
  kind: LearnKind;
  scope: LearnScope;
  content: string;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}

function rowToProposal(r: any): LearningProposal {
  return {
    id: r.id,
    agentId: r.agent_id,
    workspaceId: r.workspace_id,
    kind: r.kind,
    scope: r.scope,
    content: r.content,
    source: r.source,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? null,
  };
}

function genId(): string {
  return `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 建立提案。先對「該 agent 最近 100 條提案」做去重，重複則不建立、回傳 null。
 */
export function createProposal(input: {
  agentId: string;
  workspaceId: string;
  kind: LearnKind;
  scope: LearnScope;
  content: string;
  source: string;
}): LearningProposal | null {
  const prior = db.prepare(`
    SELECT content FROM learning_proposals
    WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(input.agentId) as any[];
  if (isDuplicate(input.content, prior.map((r) => r.content))) return null;

  const id = genId();
  db.prepare(`
    INSERT INTO learning_proposals
      (id, agent_id, workspace_id, kind, scope, content, source, status, created_at, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
  `).run(id, input.agentId, input.workspaceId, input.kind, input.scope,
         input.content, input.source, Date.now());
  return getProposal(id)!;
}

export function getProposal(id: string): LearningProposal | undefined {
  const r = db.prepare("SELECT * FROM learning_proposals WHERE id = ?").get(id) as any;
  return r ? rowToProposal(r) : undefined;
}

export function listPendingProposals(workspaceId?: string): LearningProposal[] {
  const rows = workspaceId
    ? db.prepare("SELECT * FROM learning_proposals WHERE status = 'pending' AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM learning_proposals WHERE status = 'pending' ORDER BY created_at DESC").all();
  return (rows as any[]).map(rowToProposal);
}

export function setProposalStatus(id: string, status: "approved" | "rejected"): void {
  db.prepare("UPDATE learning_proposals SET status = ?, decided_at = ? WHERE id = ?")
    .run(status, Date.now(), id);
}

// --- Agent 手藝記憶（全域，跨工作區）---

const CRAFT_CAP = 4000;

export function getCraftMemory(agentId: string): string {
  const r = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id = ?").get(agentId) as any;
  return r?.content || "";
}

export function appendCraftMemory(agentId: string, entry: string): void {
  const cur = getCraftMemory(agentId).trim();
  const ts = new Date().toISOString().slice(0, 10);
  const line = `- [${ts}] ${entry.trim()}`;
  let next = cur ? `${cur}\n${line}` : line;
  if (next.length > CRAFT_CAP) next = "(舊手藝記憶已壓縮)\n" + next.slice(-(CRAFT_CAP - 200));
  db.prepare(`
    INSERT INTO agent_craft_memory (agent_id, content, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(agentId, next, Date.now());
}
```

- [ ] **步驟 2：端到端驗證**

運行（單行）：
```bash
cd server && npx tsx -e "import('./src/learningStore.js').then(m => { const p = m.createProposal({ agentId:'test-agent', workspaceId:'default', kind:'craft', scope:'agent-global', content:'測試手藝條目', source:'manual' }); console.log('created:', p && p.id); const dup = m.createProposal({ agentId:'test-agent', workspaceId:'default', kind:'craft', scope:'agent-global', content:'測試手藝條目', source:'manual' }); console.log('dup should be null:', dup); const pend = m.listPendingProposals('default'); console.log('pending count:', pend.length); m.setProposalStatus(p.id, 'approved'); m.appendCraftMemory('test-agent', '測試手藝條目'); console.log('craft memory:', m.getCraftMemory('test-agent')); console.log('pending after approve:', m.listPendingProposals('default').filter(x => x.id === p.id).length); })"
```
預期：`created:` 印出一個 `lp_` 開頭的 id；`dup should be null: null`；`pending count:` ≥ 1；`craft memory:` 含「測試手藝條目」；`pending after approve: 0`。

- [ ] **步驟 3：清掉驗證留下的測試資料**

運行：
```bash
cd server && npx tsx -e "import('./src/db.js').then(m => { m.db.prepare(\"DELETE FROM learning_proposals WHERE agent_id='test-agent'\").run(); m.db.prepare(\"DELETE FROM agent_craft_memory WHERE agent_id='test-agent'\").run(); console.log('cleaned'); })"
```
預期：輸出 `cleaned`。

- [ ] **步驟 4：Commit**

```bash
git add server/src/learningStore.ts
git commit -m "feat: 學習提案與手藝記憶 DB 存取（learningStore）"
```

---

### 任務 4：learningInjector.ts — 注入塊組裝（純函式，TDD）

純函式。把 agent 手藝記憶組成 system prompt 注入塊。工作區客戶檔案沿用 `agentManager` 既有的 `memory` 注入，本模組不重複處理。

**文件：**
- 創建：`server/src/learningInjector.ts`
- 測試：`server/src/learningInjector.test.ts`

- [ ] **步驟 1：編寫失敗的測試**

創建 `server/src/learningInjector.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildCraftMemoryBlock } from "./learningInjector.js";

describe("buildCraftMemoryBlock", () => {
  it("有內容時產生含標題與內容的注入塊", () => {
    const block = buildCraftMemoryBlock("- [2026-05-19] 標題前 8 字放數字");
    expect(block).toContain("你累積的手藝與領域知識");
    expect(block).toContain("標題前 8 字放數字");
  });

  it("空內容回傳空字串", () => {
    expect(buildCraftMemoryBlock("")).toBe("");
    expect(buildCraftMemoryBlock("   ")).toBe("");
  });
});
```

- [ ] **步驟 2：運行測試驗證失敗**

運行：`cd server && npx vitest run src/learningInjector.test.ts`
預期：FAIL，找不到 `./learningInjector.js` 模組。

- [ ] **步驟 3：編寫實現代碼**

創建 `server/src/learningInjector.ts`：

```ts
/**
 * 學習回灌 — 把 agent 手藝記憶組成 system prompt 注入塊。
 * 工作區客戶檔案沿用 agentManager 既有的 workspace.memory 注入，此處不重複。
 */

export function buildCraftMemoryBlock(craftContent: string): string {
  const c = (craftContent || "").trim();
  if (!c) return "";
  return `\n\n# 你累積的手藝與領域知識
以下是你過去執行任務時提煉、並經使用者批准的工作經驗與領域動態。請當成你的專業底牌，主動運用：

${c}
`;
}
```

- [ ] **步驟 4：運行測試驗證通過**

運行：`cd server && npx vitest run src/learningInjector.test.ts`
預期：PASS。

- [ ] **步驟 5：Commit**

```bash
git add server/src/learningInjector.ts server/src/learningInjector.test.ts
git commit -m "feat: 手藝記憶注入塊組裝（learningInjector）"
```

---

### 任務 5：agentManager.ts 接線

把標記擷取改走提案、把手藝記憶注入 system prompt、把 agent 的「記憶能力」說明換成 `LEARN` 標記版。

**文件：**
- 修改：`server/src/agentManager.ts`

- [ ] **步驟 1：更新 import**

`agentManager.ts` 開頭的 import 區塊（第 1-15 行附近）：從 `./store.js` 的 import 中**移除** `appendWorkspaceMemory`（接線後此處不再直接呼叫它）。在 import 區塊**新增**三行：

```ts
import { parseLearnMarkers } from "./learningCapture.js";
import { createProposal, getCraftMemory } from "./learningStore.js";
import { buildCraftMemoryBlock } from "./learningInjector.js";
```

- [ ] **步驟 2：把 memoryCapability 換成 learningCapability**

`agentManager.ts` 第 115 行附近有一個 `const memoryCapability = ...`。將整個 `memoryCapability` 常數宣告替換為：

```ts
    const learningCapability = `

# 學習能力（輸出學習標記）

如果在對話中你發現了**跨對話有長期價值**的東西，可在回答**最末尾**輸出學習標記，系統會收進「學習審核佇列」等使用者批准：

\`\`\`
=== LEARN kind=craft ===
一行描述（< 200 字）
=== END LEARN ===
\`\`\`

kind 四選一：
- \`fact\` — 關於使用者的事實（他是誰、專案背景、品牌規則）
- \`craft\` — 你的工作手藝改進（下次該怎麼做更好）
- \`domain\` — 你專業領域的最新動態 / 新知識
- \`calibration\` — 使用者對你的回饋（讚 / 改 / 否定）轉成的行為準則

規則：每次回答最多 3 條；只記跨對話有用的；不記當下瑣事。
`;
```

- [ ] **步驟 3：在 start() 注入手藝記憶塊、改用 learningCapability**

`agentManager.ts` 第 113 行附近有 `const skillPrimingBlock = buildSkillPrimingBlock(agentId);`。在它**下一行**新增：

```ts
    const craftBlock = buildCraftMemoryBlock(getCraftMemory(agentId));
```

接著找到第 117 行附近組合 `combined` 的那一行，將：

```ts
    let combined = (extraSystemPrompt || "") + skillPrimingBlock + memoryBlock + agentMemoryBlock + (enableAutoFork ? FORK_CAPABILITY : "") + memoryCapability;
```

替換為：

```ts
    let combined = (extraSystemPrompt || "") + skillPrimingBlock + craftBlock + memoryBlock + agentMemoryBlock + (enableAutoFork ? FORK_CAPABILITY : "") + learningCapability;
```

- [ ] **步驟 4：把 attachPersistence 的 REMEMBER 擷取改走提案**

`agentManager.ts` 的 `attachPersistence` 方法內、`message` 事件分支中有一段解析 `REMEMBER` 標記並呼叫 `appendWorkspaceMemory` 的程式碼（約第 250-257 行）。將整段：

```ts
        const wsId = (s as any).workspaceId as string | undefined;
        if (wsId) {
          const matches = String(evt.payload.content).matchAll(/===\s*REMEMBER\s*===\s*\n([\s\S]*?)\n===\s*END\s*REMEMBER\s*===/gi);
          for (const m of matches) {
            const entry = m[1].trim();
            if (entry && entry.length < 200) appendWorkspaceMemory(wsId, entry);
          }
        }
```

替換為：

```ts
        const wsId = (s as any).workspaceId as string | undefined;
        if (wsId) {
          const drafts = parseLearnMarkers(String(evt.payload.content));
          for (const d of drafts) {
            createProposal({
              agentId: s.agentId,
              workspaceId: wsId,
              kind: d.kind,
              scope: d.scope,
              content: d.content,
              source: `conversation:${s.id}`,
            });
          }
        }
```

- [ ] **步驟 5：型別檢查**

運行：`cd server && npx tsc --noEmit`
預期：無錯誤。若報 `appendWorkspaceMemory` 未使用或未定義，確認步驟 1 的 import 調整正確。

- [ ] **步驟 6：端到端驗證**

啟動後端：`cd server && npm run dev`（背景執行）。另開終端機運行：

```bash
cd server && npx tsx -e "import('./src/learningStore.js').then(m => { const p = m.createProposal({ agentId:'smoke', workspaceId:'default', kind:'fact', scope:'workspace', content:'接線冒煙測試', source:'conversation:smoke' }); console.log('proposal ok:', !!p); m.db && 0; })"
```
預期：輸出 `proposal ok: true`。確認後關閉後端，並運行清理：
```bash
cd server && npx tsx -e "import('./src/db.js').then(m => { m.db.prepare(\"DELETE FROM learning_proposals WHERE agent_id='smoke'\").run(); console.log('cleaned'); })"
```

> 注意：完整的「agent 對話 → 標記 → 提案」鏈路會在任務 7 的瀏覽器驗證中端到端確認。

- [ ] **步驟 7：Commit**

```bash
git add server/src/agentManager.ts
git commit -m "feat: agentManager 接入學習提案擷取與手藝記憶注入"
```

---

### 任務 6：index.ts — 學習系統 API 路由

新增 4 個路由：列出待審提案、批准、拒絕、讀取手藝記憶。

**文件：**
- 修改：`server/src/index.ts`

- [ ] **步驟 1：更新 import**

在 `index.ts` 從 `./store.js` 的 import（第 19-27 行）中，於既有名單加入 `appendWorkspaceMemory`。並在 import 區塊新增一行：

```ts
import {
  listPendingProposals, getProposal, setProposalStatus,
  getCraftMemory, appendCraftMemory,
} from "./learningStore.js";
```

- [ ] **步驟 2：新增 4 個路由**

在 `index.ts` 的 notes 路由區塊之後（約第 980 行 `app.delete("/api/notes/:id" ...)` 之後）加入：

```ts
// ============ 學習系統 ============

app.get("/api/learning/proposals", (req, res) => {
  const wsId = ws(req) || DEFAULT_WORKSPACE_ID;
  res.json(listPendingProposals(wsId));
});

app.post("/api/learning/proposals/:id/approve", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });
  if (p.scope === "agent-global") {
    appendCraftMemory(p.agentId, p.content);
  } else {
    appendWorkspaceMemory(p.workspaceId, p.content);
  }
  setProposalStatus(p.id, "approved");
  res.json({ ok: true });
});

app.post("/api/learning/proposals/:id/reject", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "找不到提案" });
  if (p.status !== "pending") return res.status(409).json({ error: "提案已處理過" });
  setProposalStatus(p.id, "rejected");
  res.json({ ok: true });
});

app.get("/api/learning/craft", (req, res) => {
  const agentId = String(req.query.agentId || "");
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  res.json({ agentId, content: getCraftMemory(agentId) });
});
```

- [ ] **步驟 3：型別檢查**

運行：`cd server && npx tsc --noEmit`
預期：無錯誤。

- [ ] **步驟 4：驗證路由**

啟動後端：`cd server && npm run dev`（背景執行）。另開終端機：

```bash
curl -s "http://localhost:5191/api/learning/proposals?workspace=default"
curl -s "http://localhost:5191/api/learning/craft?agentId=nobody"
```
預期：第一個回傳 `[]`（或既有待審提案的 JSON 陣列）；第二個回傳 `{"agentId":"nobody","content":""}`。確認後關閉後端。

- [ ] **步驟 5：Commit**

```bash
git add server/src/index.ts
git commit -m "feat: 學習系統 API 路由"
```

---

### 任務 7：前端 — api.ts + LearningQueuePanel + App 接線

新增前端型別與 API 方法、審核佇列面板，並接進 App 導覽。

**文件：**
- 修改：`client/src/lib/api.ts`
- 創建：`client/src/components/LearningQueuePanel.tsx`
- 修改：`client/src/App.tsx`
- 修改：`client/src/components/AgentSidebar.tsx`

- [ ] **步驟 1：api.ts 新增型別與方法**

在 `client/src/lib/api.ts` 檔案末尾（最後一個 `export interface` 之後）新增型別：

```ts
export interface LearningProposal {
  id: string;
  agentId: string;
  workspaceId: string;
  kind: "fact" | "craft" | "domain" | "calibration";
  scope: "workspace" | "agent-global";
  content: string;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}
```

在 `api` 物件內（最後一個方法 `applyWorkflowDraft` 之後、物件結束的 `}` 之前）新增三個方法：

```ts
  learningProposals: () => fetch(withWorkspace("/api/learning/proposals")).then(j<LearningProposal[]>),
  approveLearning: (id: string) =>
    fetch(`/api/learning/proposals/${id}/approve`, { method: "POST" }).then(j),
  rejectLearning: (id: string) =>
    fetch(`/api/learning/proposals/${id}/reject`, { method: "POST" }).then(j),
```

- [ ] **步驟 2：建立 LearningQueuePanel 組件**

創建 `client/src/components/LearningQueuePanel.tsx`：

```tsx
import { useEffect, useState } from "react";
import { api, type AgentMeta, type LearningProposal } from "../lib/api";

const KIND_LABEL: Record<string, string> = {
  fact: "📌 關於你",
  craft: "🛠️ 手藝",
  domain: "🌐 領域新知",
  calibration: "🎯 回饋校準",
};

export function LearningQueuePanel({ agents }: { agents: AgentMeta[] }) {
  const [proposals, setProposals] = useState<LearningProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => api.learningProposals().then(setProposals).catch(() => {});
  useEffect(() => { reload(); }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id;

  const decide = async (p: LearningProposal, action: "approve" | "reject") => {
    setBusy(p.id);
    try {
      if (action === "approve") await api.approveLearning(p.id);
      else await api.rejectLearning(p.id);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">🧠 學習審核佇列</h2>
          <p className="text-xs text-zinc-500 mt-1">
            agent 提出的學習成果。批准後才會寫進該 agent 的能力 / 工作區檔案；拒絕的不再重複出現。
          </p>
        </div>

        {proposals.length === 0 && (
          <div className="bg-panel border border-zinc-800 rounded-lg p-8 text-center text-zinc-500">
            <div className="text-4xl mb-2">🧠</div>
            <div className="text-sm">目前沒有待審的學習。agent 在對話中學到東西時會出現在這裡。</div>
          </div>
        )}

        <div className="space-y-2">
          {proposals.map((p) => (
            <div key={p.id} className="bg-panel border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                    <span>{KIND_LABEL[p.kind] || p.kind}</span>
                    <span>·</span>
                    <span>{agentName(p.agentId)}</span>
                    <span>·</span>
                    <span>{p.scope === "agent-global" ? "跨工作區" : "限本工作區"}</span>
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">{p.content}</div>
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    disabled={busy === p.id}
                    onClick={() => decide(p, "approve")}
                    className="text-xs px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-white disabled:opacity-50"
                  >批准</button>
                  <button
                    disabled={busy === p.id}
                    onClick={() => decide(p, "reject")}
                    className="text-xs px-3 py-1 bg-zinc-800 hover:bg-rose-700 rounded text-zinc-400 hover:text-white disabled:opacity-50"
                  >拒絕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **步驟 3：App.tsx 接線**

在 `client/src/App.tsx` 做四處修改：

1. import 區（第 14 行 `NotesPanel` import 之後）新增：
```tsx
import { LearningQueuePanel } from "./components/LearningQueuePanel";
```

2. `View` 型別（第 24-33 行）新增一個成員，加在 `| { kind: "notes" }` 之後：
```tsx
  | { kind: "learning" }
```

3. 在 `openNotes` 函式（第 186 行）之後新增：
```tsx
  const openLearning = () => setView({ kind: "learning" });
```

4. 在 `<AgentSidebar>` 的 props（第 297-312 行）中，於 `onOpenNotes` 那一行之後新增：
```tsx
              onOpenLearning={() => { openLearning(); if (window.innerWidth < 768) toggleSidebar(); }}
```

5. 在面板渲染區（第 404 行 `{isView("notes") && <NotesPanel .../>}` 之後）新增：
```tsx
          {isView("learning") && <LearningQueuePanel key={`l-${reloadKey}`} agents={agents} />}
```

- [ ] **步驟 4：AgentSidebar.tsx 新增導覽按鈕**

開啟 `client/src/components/AgentSidebar.tsx`，做三處修改：

1. props 介面（約第 17 行）`onOpenNotes: () => void;` 之後新增一行：
```tsx
  onOpenLearning: () => void;
```

2. 元件參數解構（約第 26 行）`onOpenBatch, onOpenNotes, onOpenWorkflows,` 改為：
```tsx
  onOpenBatch, onOpenNotes, onOpenLearning, onOpenWorkflows,
```

3. JSX 中「筆記」按鈕（約第 92-99 行）之後，緊接著新增一個按鈕：
```tsx
          <button
            onClick={onOpenLearning}
            className="px-2 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex flex-col items-center justify-center gap-0.5"
            title="學習審核佇列"
          >
            <span>🧠</span>
            <span>學習</span>
          </button>
```

- [ ] **步驟 5：型別檢查與建置**

運行：`cd client && npx tsc --noEmit && npm run build`
預期：無型別錯誤，建置成功。

- [ ] **步驟 6：瀏覽器端到端驗證**

啟動完整 dashboard：專案根目錄運行 `npm run dev`（背景執行）。瀏覽器開 `http://localhost:5190`：

1. 開一個 agent 對話，輸入訊息：`請在回答最後輸出一條 === LEARN kind=craft === 測試手藝條目 === END LEARN === 標記`
2. 等 agent 回覆完成。
3. 從側欄點「🧠 學習」進入審核佇列 — 應看到一筆 `🛠️ 手藝` 提案，內容含「測試手藝條目」、標示「跨工作區」。
4. 點「批准」 — 該提案從列表消失。
5. 驗證手藝記憶已寫入：`curl -s "http://localhost:5191/api/learning/craft?agentId=<該 agent 的 id>"` — `content` 欄應含「測試手藝條目」。
6. 對同一 agent 開新對話，確認其 system prompt 已含手藝記憶（可在 server console 或新對話中問 agent「你累積了哪些手藝記憶」交叉確認）。

預期：上述 6 步全部符合。若提案沒出現，檢查 server console 是否有 `parseLearnMarkers` / `createProposal` 相關錯誤。

- [ ] **步驟 7：Commit**

```bash
git add client/src/lib/api.ts client/src/components/LearningQueuePanel.tsx client/src/App.tsx client/src/components/AgentSidebar.tsx
git commit -m "feat: 學習審核佇列前端面板與導覽接線"
```

---

## 完成後驗收

- [ ] 全部單元測試通過：`cd server && npm test`
- [ ] agent 在對話輸出 `LEARN` 標記 → 提案進審核佇列（pending）
- [ ] 批准 `craft`/`domain` 提案 → 寫入 `agent_craft_memory`；批准 `fact`/`calibration` 提案 → 寫入 `workspace.memory`
- [ ] 拒絕的提案不再出現、且相同內容不會重複冒出（去重生效）
- [ ] 下次 agent 啟動時 system prompt 含手藝記憶注入塊
- [ ] 既有 `REMEMBER` 標記改為產生提案（不再自動寫入備忘錄）

## Phase 2 銜接（本計劃不做）

Phase 2 將新增 `tracked_topics` 表、`craftConsolidator.ts`（用量驅動的手藝整合）、`topicTracker.ts`（自適應間隔的領域追蹤，掛 `scheduler.ts`）、以及 `TrackedTopicsPanel.tsx`。屆時另開一份計劃。
