import { db } from "../db.js";

export type OutcomeStatus = "pending" | "notified" | "done" | "cancelled";

export interface OutcomeCheck {
  id: string;
  workspaceId: string;
  /** 連回原交辦（可空） */
  delegationId: string;
  /** 連目標（可空） */
  goalId: string;
  /** 要查什麼（如「露天 Hairball 那檔有沒有詢問/成交」） */
  description: string;
  dueAt: number;
  status: OutcomeStatus;
  /** 使用者填的結果 */
  result: string;
  createdAt: number;
  updatedAt: number;
}

/** FOLLOWUP 標記允許的最大天數——超過視為壞標記略過。 */
export const FOLLOWUP_MAX_DAYS = 90;

function rowToOutcome(r: any): OutcomeCheck {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    delegationId: r.delegation_id,
    goalId: r.goal_id,
    description: r.description,
    dueAt: r.due_at,
    status: r.status as OutcomeStatus,
    result: r.result,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getOutcomeCheck(id: string): OutcomeCheck | undefined {
  const r = db.prepare("SELECT * FROM outcome_checks WHERE id = ?").get(id) as any;
  return r ? rowToOutcome(r) : undefined;
}

export function createOutcomeCheck(input: {
  workspaceId: string;
  description: string;
  dueAt: number;
  delegationId?: string;
  goalId?: string;
}): OutcomeCheck {
  const id = `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO outcome_checks
      (id, workspace_id, delegation_id, goal_id, description, due_at, status, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.delegationId ?? "",
    input.goalId ?? "",
    input.description,
    input.dueAt,
    now,
    now,
  );
  return getOutcomeCheck(id)!;
}

/** 依 status 過濾（不給則全部）；同工作區、依到期時間排序（越早到期越前）。 */
export function listOutcomes(workspaceId: string, status?: OutcomeStatus): OutcomeCheck[] {
  if (status) {
    return (
      db
        .prepare("SELECT * FROM outcome_checks WHERE workspace_id = ? AND status = ? ORDER BY due_at ASC")
        .all(workspaceId, status) as any[]
    ).map(rowToOutcome);
  }
  return (
    db
      .prepare("SELECT * FROM outcome_checks WHERE workspace_id = ? ORDER BY due_at ASC")
      .all(workspaceId) as any[]
  ).map(rowToOutcome);
}

/** 到期待處理：status='pending' AND due_at<=now（跨工作區，排程器掃描用）。 */
export function listDue(now: number): OutcomeCheck[] {
  return (
    db
      .prepare("SELECT * FROM outcome_checks WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC")
      .all(now) as any[]
  ).map(rowToOutcome);
}

/** 待回訪（pending + notified），面板「待你填結果」清單用。 */
export function listOpen(workspaceId: string): OutcomeCheck[] {
  return (
    db
      .prepare(
        "SELECT * FROM outcome_checks WHERE workspace_id = ? AND status IN ('pending','notified') ORDER BY due_at ASC",
      )
      .all(workspaceId) as any[]
  ).map(rowToOutcome);
}

/**
 * 是否已存在「未結案且描述完全相同」的回訪（status IN pending/notified）。
 * FOLLOWUP 建立去重用：同一標記在多回合重複出現時，只掛一筆。
 */
export function hasOpenDuplicate(workspaceId: string, description: string): boolean {
  const r = db
    .prepare(
      "SELECT 1 FROM outcome_checks WHERE workspace_id = ? AND description = ? AND status IN ('pending','notified') LIMIT 1",
    )
    .get(workspaceId, description);
  return !!r;
}

/** 近 n 筆已填結果（done），依填寫時間新到舊。 */
export function listRecent(workspaceId: string, n: number): OutcomeCheck[] {
  return (
    db
      .prepare(
        "SELECT * FROM outcome_checks WHERE workspace_id = ? AND status = 'done' ORDER BY updated_at DESC LIMIT ?",
      )
      .all(workspaceId, Math.max(1, n)) as any[]
  ).map(rowToOutcome);
}

/**
 * pending → notified（排程器推播後標記，冪等）。
 * 只改 status='pending' 的列——已 notified/done/cancelled 不重改，回傳 undefined。
 */
export function markNotified(id: string): OutcomeCheck | undefined {
  const now = Date.now();
  const changes = db
    .prepare("UPDATE outcome_checks SET status = 'notified', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(now, id).changes as number;
  if (!changes) return undefined;
  return getOutcomeCheck(id);
}

/**
 * 填結果 → done。工作區驗證比照 store/goals.ts：
 * expectedWorkspaceId 有給且不符 → 拒改回 undefined（跨區隔離）。
 */
export function recordResult(
  id: string,
  result: string,
  expectedWorkspaceId?: string,
): OutcomeCheck | undefined {
  const cur = getOutcomeCheck(id);
  if (!cur) return undefined;
  if (expectedWorkspaceId !== undefined && cur.workspaceId !== expectedWorkspaceId) return undefined;
  const now = Date.now();
  db.prepare("UPDATE outcome_checks SET result = ?, status = 'done', updated_at = ? WHERE id = ?").run(
    result,
    now,
    id,
  );
  return getOutcomeCheck(id);
}

/** 取消回訪 → cancelled。工作區隔離同 recordResult。 */
export function cancelOutcome(id: string, expectedWorkspaceId?: string): OutcomeCheck | undefined {
  const cur = getOutcomeCheck(id);
  if (!cur) return undefined;
  if (expectedWorkspaceId !== undefined && cur.workspaceId !== expectedWorkspaceId) return undefined;
  const now = Date.now();
  db.prepare("UPDATE outcome_checks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id);
  return getOutcomeCheck(id);
}

export function deleteOutcomeCheck(id: string, expectedWorkspaceId?: string): boolean {
  if (expectedWorkspaceId !== undefined) {
    const cur = getOutcomeCheck(id);
    if (!cur || cur.workspaceId !== expectedWorkspaceId) return false;
  }
  db.prepare("DELETE FROM outcome_checks WHERE id = ?").run(id);
  return true;
}

/**
 * 從 PM 訊息偵測 FOLLOWUP 標記，掛成效回訪。
 * 格式：=== FOLLOWUP: <N>d | <要查什麼> ===
 *   N = 天數（允許小數），上限 FOLLOWUP_MAX_DAYS(90)。
 * 解析失敗 / 天數非正 / 超過上限 / 描述空 → 回 null（壞標記靜默略過）。
 */
export function detectFollowup(content: string): { days: number; description: string } | null {
  const m = /===\s*FOLLOWUP:\s*([\d.]+)\s*d\s*\|\s*(.+?)\s*===/s.exec(content);
  if (!m) return null;
  const days = Number.parseFloat(m[1]);
  const description = m[2].trim();
  if (!Number.isFinite(days) || days <= 0 || days > FOLLOWUP_MAX_DAYS) return null;
  if (!description) return null;
  return { days, description };
}

/**
 * 從 PM 訊息偵測所有 FOLLOWUP 標記並回陣列（上限 5 筆防灌爆）。
 * 相容舊版單數函式：呼叫端可改用本函式以支援一則訊息含多個標記。
 * 注意：刻意不用 s 旗標——多標記情境下 .+? 跨行會讓壞標記（如描述空）
 * 吞掉下一個標記的開頭 ===，描述限制在單行內才安全。
 */
export function detectFollowups(content: string): Array<{ days: number; description: string }> {
  const results: Array<{ days: number; description: string }> = [];
  const re = /===\s*FOLLOWUP:\s*([\d.]+)\s*d\s*\|[ \t]*(.+?)[ \t]*===/g;
  for (const m of content.matchAll(re)) {
    const days = Number.parseFloat(m[1]);
    const description = m[2].trim();
    if (Number.isFinite(days) && days > 0 && days <= FOLLOWUP_MAX_DAYS && description) {
      results.push({ days, description });
      if (results.length >= 5) {
        console.warn("[outcomes] detectFollowups 命中超過 5 筆上限，其餘標記已略過");
        break;
      }
    }
  }
  return results;
}
