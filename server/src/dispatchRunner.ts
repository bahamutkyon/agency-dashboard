import { agentManager } from "./agentManager.js";
import type { DispatchItem } from "./dispatchParser.js";

export interface ConsultResult {
  agentId: string;
  task: string;
  output: string;
  status: "ok" | "timeout" | "error";
}

/** 保序、限制同時併發數的 map。fn 自行處理錯誤（回傳值代表結果）。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 真正跑一個 consult 項：開受管子 session（帶工作區脈絡/記憶/MCP），收 final 回覆。 */
async function runOneConsult(
  item: DispatchItem,
  workspaceId: string,
  perItemTimeoutMs: number,
): Promise<ConsultResult> {
  return new Promise<ConsultResult>((resolve) => {
    // enableAutoFork=false：子諮詢不該再外掛 FORK 能力。
    const session = agentManager.start(item.agentId, `🤝 受派諮詢：${item.task.slice(0, 24)}`, undefined, workspaceId, false);
    let collected = "";   // 最終 message 事件的權威全文
    let streamed = "";    // 累積的 delta 串流——逾時時用它救回「部分內容」而非空白
    let settled = false;
    const finish = (status: ConsultResult["status"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.removeListener("event", onEvent);
      // 有完整 message 用它；否則退而用串流到一半的內容（逾時仍給部分價值）。
      resolve({ agentId: item.agentId, task: item.task, output: (collected || streamed).trim(), status });
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
      else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
      else if (evt.type === "result") finish((collected || streamed) ? "ok" : "error");
    };
    // 逾時：若已串流到部分內容，仍回 timeout 狀態但帶回那段內容（不再是空白）。
    const timer = setTimeout(() => finish("timeout"), perItemTimeoutMs);
    session.on("event", onEvent);
    agentManager.send(session.id, item.task);
  });
}

/** 並行（限流）跑所有 consult 項，回每項原始輸出（含逾時/錯誤標記）。 */
export async function runConsult(
  items: DispatchItem[],
  workspaceId: string,
  opts: { concurrency: number; perItemTimeoutMs: number },
  runOne: (item: DispatchItem, workspaceId: string, timeoutMs: number) => Promise<ConsultResult> = runOneConsult,
): Promise<ConsultResult[]> {
  return mapWithConcurrency(items, opts.concurrency, (it) => runOne(it, workspaceId, opts.perItemTimeoutMs));
}
