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
    WHERE agent_id = ?
      AND (scope = 'agent-global' OR scope = 'category' OR workspace_id = ?)
    ORDER BY created_at DESC LIMIT 100
  `).all(input.agentId, input.workspaceId) as any[];
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
  // agent-global（手藝/領域）與 category（類共通能力）提案本質跨工作區，
  // 不該被工作區過濾掩蓋——否則在非預設工作區會看不到能力學習產出的提案。
  // 只有 workspace scope（關於使用者的事實）才綁定工作區。
  const rows = workspaceId
    ? db.prepare("SELECT * FROM learning_proposals WHERE status = 'pending' AND (workspace_id = ? OR scope = 'agent-global' OR scope = 'category') ORDER BY created_at DESC").all(workspaceId)
    : db.prepare("SELECT * FROM learning_proposals WHERE status = 'pending' ORDER BY created_at DESC").all();
  return (rows as any[]).map(rowToProposal);
}

/** 把提案標記為 approved/rejected。CAS 語意:只會更新仍為 pending 的提案,
 *  回傳是否真的更新成功(用於防止同一提案被重複處理)。 */
export function setProposalStatus(id: string, status: "approved" | "rejected"): boolean {
  const r = db.prepare("UPDATE learning_proposals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(status, Date.now(), id) as { changes: number | bigint };
  return Number(r.changes) > 0;
}

// --- Agent 手藝記憶（workspace-aware）---

const CRAFT_CAP = 4000;

/**
 * scope 三種：
 *   - 'global'        : 全域（跨工作區共享，給通用方法論用）。workspace_id = ''。
 *   - 'workspace'     : 該工作區專屬。workspace_id = 真實 ws id。
 *   - 'legacy-global' : 遷移前累積的全域記憶，待使用者重審決定升 global / 改 workspace / 刪。
 *                       workspace_id = ''。注入時仍當全域用。
 */
export type MemoryScope = "global" | "workspace" | "legacy-global";

export interface CraftMemoryEntry {
  agentId: string;
  workspaceId: string;     // '' 代表全域
  scope: MemoryScope;
  content: string;
  updatedAt: number;
}

export interface CraftMemoryBundle {
  global: string;       // scope='global' 的內容
  workspace: string;    // scope='workspace' 對指定 ws 的內容
  legacyGlobal: string; // scope='legacy-global' 的內容
}

/**
 * 取得指定 agent 對指定 workspace 的所有可見手藝記憶（global + 該 ws + legacy-global）。
 * 注入 system prompt 時應用此函式。
 */
export function getCraftMemoryFor(agentId: string, workspaceId: string): CraftMemoryBundle {
  const rows = db.prepare(`
    SELECT scope, content FROM agent_craft_memory
    WHERE agent_id = ? AND (workspace_id = '' OR workspace_id = ?)
  `).all(agentId, workspaceId) as { scope: MemoryScope; content: string }[];
  const bundle: CraftMemoryBundle = { global: "", workspace: "", legacyGlobal: "" };
  for (const r of rows) {
    if (r.scope === "global") bundle.global = r.content || "";
    else if (r.scope === "workspace") bundle.workspace = r.content || "";
    else if (r.scope === "legacy-global") bundle.legacyGlobal = r.content || "";
  }
  return bundle;
}

/**
 * 列出該 agent 所有 craft 記憶條目（含所有 workspace + 全域），供 UI 管理用。
 */
export function listCraftMemoryEntries(agentId: string): CraftMemoryEntry[] {
  const rows = db.prepare(`
    SELECT agent_id, workspace_id, scope, content, updated_at
    FROM agent_craft_memory WHERE agent_id = ?
    ORDER BY workspace_id, scope
  `).all(agentId) as any[];
  return rows.map((r) => ({
    agentId: r.agent_id, workspaceId: r.workspace_id, scope: r.scope,
    content: r.content, updatedAt: r.updated_at,
  }));
}

/** 列出所有 legacy-global 的 craft 條目，供「Legacy 重審」UI 用。 */
export function listLegacyCraftEntries(): CraftMemoryEntry[] {
  const rows = db.prepare(`
    SELECT agent_id, workspace_id, scope, content, updated_at
    FROM agent_craft_memory WHERE scope = 'legacy-global'
    ORDER BY agent_id
  `).all() as any[];
  return rows.map((r) => ({
    agentId: r.agent_id, workspaceId: r.workspace_id, scope: r.scope,
    content: r.content, updatedAt: r.updated_at,
  }));
}

/**
 * 追加一條 craft 記憶到指定 (agent, workspace, scope) 槽位。
 * workspaceId 為 '' 表示全域（scope 必須是 'global' 或 'legacy-global'）。
 */
export function appendCraftMemory(
  agentId: string,
  entry: string,
  scope: MemoryScope = "workspace",
  workspaceId: string = "",
): void {
  if (scope === "workspace" && !workspaceId) {
    throw new Error("appendCraftMemory: scope='workspace' 需指定 workspaceId");
  }
  if ((scope === "global" || scope === "legacy-global") && workspaceId) {
    throw new Error(`appendCraftMemory: scope='${scope}' 不可指定 workspaceId`);
  }
  const wsKey = scope === "workspace" ? workspaceId : "";
  const r = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id = ? AND workspace_id = ? AND scope = ?")
    .get(agentId, wsKey, scope) as { content: string } | undefined;
  const cur = (r?.content || "").trim();
  const ts = new Date().toISOString().slice(0, 10);
  const line = `- [${ts}] ${entry.trim()}`;
  let next = cur ? `${cur}\n${line}` : line;
  if (next.length > CRAFT_CAP) next = "(舊手藝記憶已壓縮)\n" + next.slice(-(CRAFT_CAP - 200));
  db.prepare(`
    INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, workspace_id, scope) DO UPDATE SET
      content = excluded.content,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(agentId, wsKey, scope, next, Date.now());
}

/**
 * 直接覆蓋 (agent, workspace, scope) 槽位。空字串 → 刪除該條目。
 */
export function setCraftMemory(
  agentId: string,
  content: string,
  scope: MemoryScope = "workspace",
  workspaceId: string = "",
): void {
  if (scope === "workspace" && !workspaceId) {
    throw new Error("setCraftMemory: scope='workspace' 需指定 workspaceId");
  }
  if ((scope === "global" || scope === "legacy-global") && workspaceId) {
    throw new Error(`setCraftMemory: scope='${scope}' 不可指定 workspaceId`);
  }
  const wsKey = scope === "workspace" ? workspaceId : "";
  if (!content || !content.trim()) {
    db.prepare("DELETE FROM agent_craft_memory WHERE agent_id = ? AND workspace_id = ? AND scope = ?").run(agentId, wsKey, scope);
    return;
  }
  db.prepare(`
    INSERT INTO agent_craft_memory (agent_id, workspace_id, scope, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, workspace_id, scope) DO UPDATE SET
      content = excluded.content,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(agentId, wsKey, scope, content, Date.now());
}

/**
 * 重新指派一個 craft 條目的 scope（用於 legacy 重審：legacy-global → global / workspace）。
 * 從來源槽位刪除，寫到目標槽位。
 */
export function promoteCraftMemory(
  agentId: string,
  fromScope: MemoryScope,
  fromWorkspaceId: string,
  toScope: MemoryScope,
  toWorkspaceId: string,
): void {
  const src = db.prepare("SELECT content FROM agent_craft_memory WHERE agent_id = ? AND workspace_id = ? AND scope = ?")
    .get(agentId, fromWorkspaceId, fromScope) as { content: string } | undefined;
  if (!src) return;
  db.prepare("BEGIN").run();
  try {
    db.prepare("DELETE FROM agent_craft_memory WHERE agent_id = ? AND workspace_id = ? AND scope = ?")
      .run(agentId, fromWorkspaceId, fromScope);
    setCraftMemory(agentId, src.content, toScope, toWorkspaceId);
    db.prepare("COMMIT").run();
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}

/**
 * @deprecated 為向後相容保留：回傳「全域 + legacy-global」聚合內容（行為近似舊版）。
 * 新程式碼請改用 getCraftMemoryFor(agentId, workspaceId)。
 */
export function getCraftMemory(agentId: string): string {
  const b = getCraftMemoryFor(agentId, "");
  return [b.legacyGlobal, b.global].filter((s) => s.trim()).join("\n");
}

// --- 類層能力記憶（workspace-aware）---

export interface CategoryMemoryEntry {
  category: string;
  workspaceId: string;
  scope: MemoryScope;
  content: string;
  updatedAt: number;
}

export interface CategoryMemoryBundle {
  global: string;
  workspace: string;
  legacyGlobal: string;
}

export function getCategoryMemoryFor(categoryId: string, workspaceId: string): CategoryMemoryBundle {
  const rows = db.prepare(`
    SELECT scope, content FROM category_capability_memory
    WHERE category = ? AND (workspace_id = '' OR workspace_id = ?)
  `).all(categoryId, workspaceId) as { scope: MemoryScope; content: string }[];
  const bundle: CategoryMemoryBundle = { global: "", workspace: "", legacyGlobal: "" };
  for (const r of rows) {
    if (r.scope === "global") bundle.global = r.content || "";
    else if (r.scope === "workspace") bundle.workspace = r.content || "";
    else if (r.scope === "legacy-global") bundle.legacyGlobal = r.content || "";
  }
  return bundle;
}

export function listLegacyCategoryEntries(): CategoryMemoryEntry[] {
  const rows = db.prepare(`
    SELECT category, workspace_id, scope, content, updated_at
    FROM category_capability_memory WHERE scope = 'legacy-global'
    ORDER BY category
  `).all() as any[];
  return rows.map((r) => ({
    category: r.category, workspaceId: r.workspace_id, scope: r.scope,
    content: r.content, updatedAt: r.updated_at,
  }));
}

export function appendCategoryMemory(
  categoryId: string,
  entry: string,
  scope: MemoryScope = "workspace",
  workspaceId: string = "",
): void {
  if (scope === "workspace" && !workspaceId) {
    throw new Error("appendCategoryMemory: scope='workspace' 需指定 workspaceId");
  }
  if ((scope === "global" || scope === "legacy-global") && workspaceId) {
    throw new Error(`appendCategoryMemory: scope='${scope}' 不可指定 workspaceId`);
  }
  const wsKey = scope === "workspace" ? workspaceId : "";
  const r = db.prepare("SELECT content FROM category_capability_memory WHERE category = ? AND workspace_id = ? AND scope = ?")
    .get(categoryId, wsKey, scope) as { content: string } | undefined;
  const cur = (r?.content || "").trim();
  const ts = new Date().toISOString().slice(0, 10);
  const line = `- [${ts}] ${entry.trim()}`;
  let next = cur ? `${cur}\n${line}` : line;
  if (next.length > CRAFT_CAP) next = "(舊能力記憶已壓縮)\n" + next.slice(-(CRAFT_CAP - 200));
  db.prepare(`
    INSERT INTO category_capability_memory (category, workspace_id, scope, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, workspace_id, scope) DO UPDATE SET
      content = excluded.content,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(categoryId, wsKey, scope, next, Date.now());
}

export function setCategoryMemory(
  categoryId: string,
  content: string,
  scope: MemoryScope = "workspace",
  workspaceId: string = "",
): void {
  if (scope === "workspace" && !workspaceId) {
    throw new Error("setCategoryMemory: scope='workspace' 需指定 workspaceId");
  }
  if ((scope === "global" || scope === "legacy-global") && workspaceId) {
    throw new Error(`setCategoryMemory: scope='${scope}' 不可指定 workspaceId`);
  }
  const wsKey = scope === "workspace" ? workspaceId : "";
  if (!content || !content.trim()) {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ? AND workspace_id = ? AND scope = ?").run(categoryId, wsKey, scope);
    return;
  }
  db.prepare(`
    INSERT INTO category_capability_memory (category, workspace_id, scope, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, workspace_id, scope) DO UPDATE SET
      content = excluded.content,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(categoryId, wsKey, scope, content, Date.now());
}

export function promoteCategoryMemory(
  categoryId: string,
  fromScope: MemoryScope,
  fromWorkspaceId: string,
  toScope: MemoryScope,
  toWorkspaceId: string,
): void {
  const src = db.prepare("SELECT content FROM category_capability_memory WHERE category = ? AND workspace_id = ? AND scope = ?")
    .get(categoryId, fromWorkspaceId, fromScope) as { content: string } | undefined;
  if (!src) return;
  db.prepare("BEGIN").run();
  try {
    db.prepare("DELETE FROM category_capability_memory WHERE category = ? AND workspace_id = ? AND scope = ?")
      .run(categoryId, fromWorkspaceId, fromScope);
    setCategoryMemory(categoryId, src.content, toScope, toWorkspaceId);
    db.prepare("COMMIT").run();
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}

/**
 * @deprecated 為向後相容保留：回傳「全域 + legacy-global」聚合內容。
 * 新程式碼請改用 getCategoryMemoryFor(categoryId, workspaceId)。
 */
export function getCategoryMemory(categoryId: string): string {
  const b = getCategoryMemoryFor(categoryId, "");
  return [b.legacyGlobal, b.global].filter((s) => s.trim()).join("\n");
}

// --- 能力學習排程（時間驅動）---

export interface LearningSchedule {
  id: string;
  name: string;
  targets: { type: "category" | "agent"; id: string }[];
  cron: string;
  enabled: boolean;
  lastRunAt?: number;
  createdAt: number;
}

function rowToLearningSchedule(r: any): LearningSchedule {
  return {
    id: r.id,
    name: r.name,
    targets: JSON.parse(r.targets || "[]"),
    cron: r.cron,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at ?? undefined,
    createdAt: r.created_at,
  };
}

export function listLearningSchedules(): LearningSchedule[] {
  const rows = db.prepare("SELECT * FROM learning_schedules ORDER BY created_at DESC").all() as any[];
  return rows.map(rowToLearningSchedule);
}

export function getLearningSchedule(id: string): LearningSchedule | undefined {
  const r = db.prepare("SELECT * FROM learning_schedules WHERE id = ?").get(id) as any;
  return r ? rowToLearningSchedule(r) : undefined;
}

export function upsertLearningSchedule(s: LearningSchedule): void {
  db.prepare(`
    INSERT INTO learning_schedules (id, name, targets, cron, enabled, last_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, targets = excluded.targets, cron = excluded.cron,
      enabled = excluded.enabled, last_run_at = excluded.last_run_at
  `).run(s.id, s.name, JSON.stringify(s.targets), s.cron,
         s.enabled ? 1 : 0, s.lastRunAt ?? null, s.createdAt);
}

export function deleteLearningSchedule(id: string): void {
  db.prepare("DELETE FROM learning_schedules WHERE id = ?").run(id);
}
