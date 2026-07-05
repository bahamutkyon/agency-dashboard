/**
 * 解析 PM 輸出的 DISPATCH 標記 —— 沿用 codebase「標記攔截」慣例（同 FORK/MEMO/
 * workflow）。PM 只「寫計畫」不執行；前端偵測此區塊後跳批准卡，使用者按下才執行。
 *
 * 支援欄位：agentId（必）、mode（選，預設 consult）、task（必）、
 *           context（選）、deliverable（選）、accept（選，最多 3 條）。
 * 多行值：task/context/deliverable 支援縮排延續行；accept 取 `-` 開頭的延續行。
 * 序列化：serializeDispatchItem 產生可 round-trip 的格式。
 */
export interface DispatchItem {
  agentId: string;
  mode: "consult" | "execute";
  task: string;
  context?: string;
  deliverable?: string;
  accept?: string[];
}
export interface DispatchPlan {
  items: DispatchItem[];
}

const BLOCK_RE = /=== DISPATCH ===\s*\n([\s\S]*?)\n=== END DISPATCH ===/;

type FieldKey = "task" | "context" | "deliverable" | "accept";

interface ParsedField {
  key: FieldKey;
  inline: string;          // value on the same line as `key: ...`
  continuations: string[]; // raw subsequent lines that belong to this field
}

interface ParsedCurItem {
  agentId: string;
  mode: "consult" | "execute";
  task?: string;
  context?: string;
  deliverable?: string;
  accept?: string[];
}

function finalizeField(field: ParsedField): void { /* caller applies via applyField */ }

function applyField(cur: ParsedCurItem, field: ParsedField): void {
  if (field.key === "accept") {
    const items = field.continuations
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => l.slice(1).trim())
      .filter(Boolean)
      .slice(0, 3);
    if (items.length > 0) cur.accept = items;
    return;
  }
  // Text fields: combine inline + trimmed continuations, filter empty, join
  const segments = [field.inline, ...field.continuations.map((l) => l.trim())]
    .filter((s) => s !== "");
  const value = segments.join("\n").trim();
  if (value) (cur as any)[field.key] = value;
}

function flushItem(cur: ParsedCurItem | null, items: DispatchItem[]): void {
  if (!cur || !cur.agentId || !cur.task) return;
  const it: DispatchItem = { agentId: cur.agentId, mode: cur.mode, task: cur.task };
  if (cur.context) it.context = cur.context;
  if (cur.deliverable) it.deliverable = cur.deliverable;
  if (cur.accept && cur.accept.length > 0) it.accept = cur.accept;
  items.push(it);
}

export function parseDispatchMarker(text: string): DispatchPlan | null {
  const m = text.match(BLOCK_RE);
  if (!m) return null;
  const items: DispatchItem[] = [];
  let cur: ParsedCurItem | null = null;
  let currentField: ParsedField | null = null;

  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();

    // `- agentId: xxx` → flush current field + item, start new item
    const idM = line.match(/^-\s*agentId:\s*(.+)$/);
    if (idM) {
      if (currentField && cur) { applyField(cur, currentField); currentField = null; }
      flushItem(cur, items);
      cur = { agentId: idM[1].trim(), mode: "consult" };
      continue;
    }

    if (!cur) continue;

    // `mode: value`
    const modeM = line.match(/^mode:\s*(\S+)\s*$/i);
    if (modeM) {
      if (currentField) { applyField(cur, currentField); currentField = null; }
      cur.mode = modeM[1].toLowerCase() === "execute" ? "execute" : "consult";
      continue;
    }

    // `task|context|deliverable|accept: value`
    const fieldM = line.match(/^(task|context|deliverable|accept):\s*(.*)$/);
    if (fieldM) {
      if (currentField) { applyField(cur, currentField); }
      currentField = { key: fieldM[1] as FieldKey, inline: fieldM[2].trim(), continuations: [] };
      continue;
    }

    // Continuation of current field
    if (currentField) {
      currentField.continuations.push(raw);
    }
  }

  // Finalize last field and item
  if (currentField && cur) { applyField(cur, currentField); }
  flushItem(cur, items);

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

/**
 * 把 DispatchItem 序列化回 DISPATCH 區塊內的格式。
 * 多行 task/context/deliverable 以 4-space 縮排寫延續行，確保 re-parse 正確辨認。
 * round-trip：serializeDispatchItem → parseDispatchMarker 能完整還原所有欄位。
 */
export function serializeDispatchItem(item: DispatchItem): string {
  const lines: string[] = [];
  lines.push(`- agentId: ${item.agentId}`);
  lines.push(`  mode: ${item.mode}`);

  const writeTextField = (key: string, value: string) => {
    const parts = value.split("\n");
    lines.push(`  ${key}: ${parts[0]}`);
    for (const part of parts.slice(1)) {
      lines.push(`    ${part}`);
    }
  };

  writeTextField("task", item.task);
  if (item.context) writeTextField("context", item.context);
  if (item.deliverable) writeTextField("deliverable", item.deliverable);
  if (item.accept && item.accept.length > 0) {
    lines.push(`  accept:`);
    for (const a of item.accept) {
      lines.push(`    - ${a}`);
    }
  }

  return lines.join("\n");
}
