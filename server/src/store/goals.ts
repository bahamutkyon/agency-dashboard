import { db } from "../db.js";

export type GoalStatus = "active" | "done" | "archived";

export interface WorkspaceGoal {
  id: string;
  workspaceId: string;
  title: string;
  metric: string;
  currentValue: string;
  targetValue: string;
  deadline: string;
  status: GoalStatus;
  note: string;
  createdAt: number;
  updatedAt: number;
}

function rowToGoal(r: any): WorkspaceGoal {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    title: r.title,
    metric: r.metric,
    currentValue: r.current_value,
    targetValue: r.target_value,
    deadline: r.deadline,
    status: r.status as GoalStatus,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listGoals(workspaceId: string, status?: GoalStatus): WorkspaceGoal[] {
  if (status) {
    return (
      db
        .prepare(
          "SELECT * FROM workspace_goals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC",
        )
        .all(workspaceId, status) as any[]
    ).map(rowToGoal);
  }
  return (
    db
      .prepare("SELECT * FROM workspace_goals WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(workspaceId) as any[]
  ).map(rowToGoal);
}

export function getGoal(id: string): WorkspaceGoal | undefined {
  const r = db.prepare("SELECT * FROM workspace_goals WHERE id = ?").get(id) as any;
  return r ? rowToGoal(r) : undefined;
}

export function createGoal(input: {
  workspaceId: string;
  title: string;
  metric?: string;
  currentValue?: string;
  targetValue?: string;
  deadline?: string;
  note?: string;
}): WorkspaceGoal {
  const id = `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO workspace_goals
      (id, workspace_id, title, metric, current_value, target_value, deadline, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    id,
    input.workspaceId,
    input.title,
    input.metric ?? "",
    input.currentValue ?? "",
    input.targetValue ?? "",
    input.deadline ?? "",
    input.note ?? "",
    now,
    now,
  );
  return getGoal(id)!;
}

export function updateGoal(
  id: string,
  patch: {
    title?: string;
    metric?: string;
    currentValue?: string;
    targetValue?: string;
    deadline?: string;
    status?: GoalStatus;
    note?: string;
  },
  /** 工作區隔離：有給時，目標不屬於該工作區就拒改（回 undefined）。
   *  路由層與 GOAL_UPDATE 自動化都應該給——只憑 id 全域改寫是隔離漏洞。 */
  expectedWorkspaceId?: string,
): WorkspaceGoal | undefined {
  const cur = getGoal(id);
  if (!cur) return undefined;
  if (expectedWorkspaceId !== undefined && cur.workspaceId !== expectedWorkspaceId) return undefined;
  const now = Date.now();
  db.prepare(`
    UPDATE workspace_goals SET
      title = ?, metric = ?, current_value = ?, target_value = ?,
      deadline = ?, status = ?, note = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.title ?? cur.title,
    patch.metric ?? cur.metric,
    patch.currentValue ?? cur.currentValue,
    patch.targetValue ?? cur.targetValue,
    patch.deadline ?? cur.deadline,
    patch.status ?? cur.status,
    patch.note ?? cur.note,
    now,
    id,
  );
  return getGoal(id)!;
}

export function deleteGoal(id: string, expectedWorkspaceId?: string): boolean {
  if (expectedWorkspaceId !== undefined) {
    const cur = getGoal(id);
    if (!cur || cur.workspaceId !== expectedWorkspaceId) return false;
  }
  db.prepare("DELETE FROM workspace_goals WHERE id = ?").run(id);
  return true;
}

/**
 * 從 PM 訊息偵測 GOAL_UPDATE 標記並更新現值。
 * 格式：=== GOAL_UPDATE: <goalId> | <新現值> ===
 * 解析失敗 / goalId 不存在 → 靜默略過。
 */
export function detectGoalUpdate(content: string): { goalId: string; newValue: string } | null {
  // 允許 === 後面有空白
  const m = /===\s*GOAL_UPDATE:\s*([^\s|]+)\s*\|\s*(.+?)\s*===/s.exec(content);
  if (!m) return null;
  const goalId = m[1].trim();
  const newValue = m[2].trim();
  if (!goalId || !newValue) return null;
  return { goalId, newValue };
}
