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
  const rows = workspaceId
    ? db.prepare("SELECT * FROM learning_proposals WHERE status = 'pending' AND workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
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
