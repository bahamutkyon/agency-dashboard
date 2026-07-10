/**
 * watchtowerContext.ts — 組裝看守任務評估所需的「工作區狀態包」
 *
 * 只讀該工作區資料，嚴格工作區隔離。
 * 風格對齊 cockpitContext.ts，但為單一工作區。
 */
import { listGoals } from "./store/goals.js";
import { listOpen } from "./store/outcomes.js";
import { listDelegations } from "./store/delegations.js";
import { getWatchtowerTask } from "./store/watchtower.js";

export interface WatchtowerContext {
  workspaceId: string;
  goals: Array<{ id: string; title: string; metric: string; currentValue: string; targetValue: string; deadline: string }>;
  openOutcomes: Array<{ id: string; description: string; dueAt: number }>;
  inFlightDelegations: Array<{ id: string; agentId: string; task: string; status: string; createdAt: number }>;
  failedDelegations: Array<{ id: string; agentId: string; task: string; createdAt: number }>;
  lastConclusion: string | null;
}

/**
 * 組裝該工作區的狀態包供看守任務評估回合使用。
 * 所有查詢帶 workspaceId，確保工作區隔離。
 */
export function buildWatchtowerContext(workspaceId: string, taskId?: string): WatchtowerContext {
  const goals = listGoals(workspaceId, "active").slice(0, 10).map((g) => ({
    id: g.id,
    title: g.title,
    metric: g.metric,
    currentValue: g.currentValue,
    targetValue: g.targetValue,
    deadline: g.deadline,
  }));

  const openOutcomes = listOpen(workspaceId).slice(0, 10).map((o) => ({
    id: o.id,
    description: o.description,
    dueAt: o.dueAt,
  }));

  // 在途 delegations（queued + running）
  const inFlightDelegations = listDelegations(
    { workspaceId, inFlightOnly: true },
    20,
  ).map((d) => ({
    id: d.id,
    agentId: d.agentId,
    task: d.task,
    status: d.status,
    createdAt: d.createdAt,
  }));

  // 失敗的 delegations（最近 20 筆，過濾 failed）
  const allRecent = listDelegations({ workspaceId }, 50);
  const failedDelegations = allRecent.filter((d) => d.status === "failed").slice(0, 10).map((d) => ({
    id: d.id,
    agentId: d.agentId,
    task: d.task,
    createdAt: d.createdAt,
  }));

  // 上次看守結論（供連貫判斷）
  let lastConclusion: string | null = null;
  if (taskId) {
    const task = getWatchtowerTask(taskId);
    lastConclusion = task?.lastConclusion ?? null;
  }

  return {
    workspaceId,
    goals,
    openOutcomes,
    inFlightDelegations,
    failedDelegations,
    lastConclusion,
  };
}

/**
 * 把狀態包格式化成 prompt 文字（供 haiku 評估回合讀）。
 */
export function formatWatchtowerContextPrompt(ctx: WatchtowerContext): string {
  const lines: string[] = [
    `# 工作區狀態包（workspace_id: ${ctx.workspaceId}）`,
    "",
  ];

  if (ctx.goals.length > 0) {
    lines.push("## 進行中目標");
    for (const g of ctx.goals) {
      const metric = g.metric ? `｜指標 ${g.metric}：${g.currentValue}/${g.targetValue}` : "";
      const dl = g.deadline ? `｜期限 ${g.deadline}` : "";
      lines.push(`- [${g.id}] ${g.title}${metric}${dl}`);
    }
  } else {
    lines.push("## 進行中目標\n（無）");
  }

  lines.push("");

  if (ctx.openOutcomes.length > 0) {
    lines.push("## 待回訪（交辦後還沒知道結果的）");
    for (const o of ctx.openOutcomes) {
      const due = new Date(o.dueAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" });
      lines.push(`- [${o.id}] ${o.description}（到期：${due}）`);
    }
  } else {
    lines.push("## 待回訪\n（無）");
  }

  lines.push("");

  if (ctx.inFlightDelegations.length > 0) {
    lines.push("## 在途交辦（正在執行中）");
    for (const d of ctx.inFlightDelegations) {
      lines.push(`- [${d.id}] ${d.agentId}：${d.task}`);
    }
  } else {
    lines.push("## 在途交辦\n（無）");
  }

  lines.push("");

  if (ctx.failedDelegations.length > 0) {
    lines.push("## 近期失敗交辦");
    for (const d of ctx.failedDelegations) {
      lines.push(`- [${d.id}] ${d.agentId}：${d.task}`);
    }
  } else {
    lines.push("## 近期失敗交辦\n（無）");
  }

  if (ctx.lastConclusion) {
    lines.push("", "## 上次看守結論", ctx.lastConclusion);
  }

  return lines.join("\n");
}
