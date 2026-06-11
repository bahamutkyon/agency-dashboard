// server/src/actionProtocol.ts
import { parseDispatchMarker, type DispatchItem } from "./dispatchParser.js";

export type ActionKind = "plan" | "next_step" | "goal_done" | "need_input" | "dispatch" | "external_send" | "destructive" | "spend";
export type Risk = "high" | "low";

export interface ParsedAction {
  kind: ActionKind;
  risk: Risk;
  summary: string;
  detail: string;
  raw: string;
  dispatchItems?: DispatchItem[];
}

export const HIGH_RISK_KINDS: ActionKind[] = ["plan", "dispatch", "external_send", "destructive", "spend"];
const KNOWN_KINDS: ActionKind[] = ["plan", "next_step", "goal_done", "need_input", "dispatch", "external_send", "destructive", "spend"];

export function classifyRisk(kind: ActionKind): Risk {
  return HIGH_RISK_KINDS.includes(kind) ? "high" : "low";
}

/**
 * 從 body 中取出 detail: 之後的全部文字（可能多行）。
 * 若找不到 detail: 行則回空字串。
 */
function extractDetail(body: string): string {
  const detailIdx = body.search(/^\s*detail:/m);
  if (detailIdx === -1) return "";
  const afterLabel = body.slice(detailIdx);
  // 去掉 "detail:" 前綴與緊接的空格，保留後面所有文字（含換行）
  const withoutPrefix = afterLabel.replace(/^\s*detail:\s*/, "");
  return withoutPrefix.trim();
}

/** 解析一段文字中的所有 ACTION 區塊。容錯：缺欄位用合理預設、未知 kind → need_input。 */
export function parseActions(text: string): ParsedAction[] {
  const ACTION_RE = /=== ACTION ===\s*\n([\s\S]*?)\n=== END ACTION ===/g;
  const out: ParsedAction[] = [];
  let m: RegExpExecArray | null;
  while ((m = ACTION_RE.exec(text)) !== null) {
    const body = m[1];
    const kindRaw = (body.match(/^\s*kind:\s*(\S+)/m)?.[1] || "need_input").toLowerCase();
    const kind: ActionKind = (KNOWN_KINDS as string[]).includes(kindRaw) ? (kindRaw as ActionKind) : "need_input";
    const riskRaw = body.match(/^\s*risk:\s*(\S+)/m)?.[1]?.toLowerCase();
    const risk: Risk = riskRaw === "high" || riskRaw === "low" ? riskRaw : classifyRisk(kind);
    const detail = extractDetail(body);
    const summary = (body.match(/^\s*summary:\s*(.+)$/m)?.[1]?.trim()) || detail.split(/\r?\n/)[0]?.trim() || kind;
    const action: ParsedAction = { kind, risk, summary, detail, raw: m[0] };
    if (kind === "dispatch") {
      const plan = parseDispatchMarker(`=== DISPATCH ===\n${detail}\n=== END DISPATCH ===`);
      action.dispatchItems = plan?.items ?? [];
    }
    out.push(action);
  }
  return out;
}
