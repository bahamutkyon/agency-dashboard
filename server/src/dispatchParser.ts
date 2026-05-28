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
