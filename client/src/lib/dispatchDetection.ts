// 派工偵測純邏輯（從 ChatWindow 抽出，便於單元測試）
// 與 server/src/dispatchParser.ts 同格式；client 不跨引 server 模組，故就地解析。

export interface DispatchMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface DispatchItem {
  agentId: string;
  mode: "consult" | "execute";
  task: string;
}

const DISPATCH_RE = /=== DISPATCH ===\s*\n([\s\S]*?)\n=== END DISPATCH ===/;

/**
 * 從訊息歷史偵測「待批准的派工」。
 *
 * 規則：只認 PM（agents-orchestrator）**最近一則 assistant 訊息**裡的 DISPATCH——
 * PM 一旦講了後續話（整合回覆／已交辦），代表這輪派工已執行過，回 null（卡片不該再跳）。
 * 此判斷純靠持久化的訊息歷史推導，因此重啟／重整都正確（不依賴前端暫存狀態）。
 *
 * @returns 待批准的派工項陣列；若沒有待批准派工則回 null。
 */
export function detectDispatch(
  messages: DispatchMsg[],
  agentId: string,
): DispatchItem[] | null {
  if (agentId !== "agents-orchestrator") return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const m = messages[i].content.match(DISPATCH_RE);
    if (!m) return null; // 最近一則 assistant 訊息已非 DISPATCH → 沒有待批准的派工
    const items: DispatchItem[] = [];
    let cur: Partial<DispatchItem> | null = null;
    const flush = () => {
      if (cur?.agentId && cur?.task) {
        items.push({ agentId: cur.agentId, mode: cur.mode || "consult", task: cur.task });
      }
    };
    for (const raw of m[1].split(/\r?\n/)) {
      const line = raw.trim();
      const id = line.match(/^-\s*agentId:\s*(.+)$/);
      if (id) { flush(); cur = { agentId: id[1].trim(), mode: "consult" }; continue; }
      if (!cur) continue;
      const mo = line.match(/^mode:\s*(\S+)/i);
      if (mo) { cur.mode = mo[1].toLowerCase() === "execute" ? "execute" : "consult"; continue; }
      const ta = line.match(/^task:\s*(.+)$/);
      if (ta) { cur.task = ta[1].trim(); continue; }
    }
    flush();
    return items.length ? items : null;
  }
  return null;
}

/**
 * 派工指紋：用 sessionId + 派工內容唯一標識一輪派工，供 localStorage 記住「已批准/已取消」，
 * 補強 consult 同步執行中重整的窄窗重複派工風險。
 */
export function dispatchFingerprint(items: DispatchItem[]): number {
  const sig = items.map((i) => `${i.agentId}|${i.mode}|${i.task}`).join("\n");
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return h;
}

/** 組出 localStorage key（null items 回 null）。 */
export function dispatchStorageKey(sessionId: string, items: DispatchItem[] | null): string | null {
  if (!items) return null;
  return `dispatched:${sessionId}:${dispatchFingerprint(items)}`;
}
