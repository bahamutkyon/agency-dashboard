import { agentManager } from "./agentManager.js";
import type { DispatchItem } from "./dispatchParser.js";

export interface ConsultResult {
  agentId: string;
  task: string;
  output: string;
  status: "ok" | "timeout" | "error";
  subSessionId: string;   // 受派子 session id —— 供前端「開啟對話」深聊
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
      resolve({ agentId: item.agentId, task: item.task, output: (collected || streamed).trim(), status, subSessionId: session.id });
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

// ====================== execute（非同步外包執行，切片②）======================

export interface ExecuteHandle { subSessionId: string; agentId: string; }
export interface ExecuteDone {
  pmSessionId: string;
  agentId: string;
  subSessionId: string;
  output: string;
  status: "ok" | "error";
}
export interface ExecuteDeps {
  start: (item: DispatchItem, workspaceId: string) => string;
  attachDone: (subSessionId: string, cb: (output: string, ok: boolean) => void) => void;
}

const EXECUTE_MAX_MS = 30 * 60 * 1000; // 單項外包執行最長 30 分鐘

/**
 * 外包執行的指令包裝：在原任務後追加「完成自驗 + 證據」要求。
 *
 * 起因：execute 是非同步、無人值守的背景執行，做完沒有人即時盯著。若不強制
 * 自驗附證據，最常見的失敗是 agent「說做完、其實沒做好」，而 PM 只會照單轉達。
 * 這段把「交辦出去的事可信」這條鏈補起來——回報必含可檢查的證據，禁止無驗證的
 * 「應該沒問題」。只用於 execute（外包）；consult 是同步顧問、使用者當場會看，不套。
 */
export function buildExecutePrompt(task: string): string {
  return `${task}

---
⚠️ 這是「外包執行」任務，完成後沒有人會即時盯著，你必須自己把關。回報的最後務必附上一段【完成自驗】，格式如下，不可省略：

【完成自驗】
- 我做了什麼：（具體、可檢查的動作，不要含糊）
- 怎麼確認有效：（實際驗證方式——跑了什麼命令／打開哪個頁面／比對什麼結果）
- 證據：（命令輸出、檔案路徑、截圖、連結等；真的沒有就明說「無客觀證據」）
- 還沒把握／未完成：（誠實列出；沒有就寫「無」）
- 結論：已驗證完成 ／ 部分完成（說明） ／ 未完成（說明）

規則：禁用「應該沒問題」「大概可以」「看起來沒問題」這類沒驗證的措辭；沒有實際驗證就標「未驗證」，不要假裝完成。`;
}

// 預設依賴：開背景真 session（吃工作區 Chrome/MCP）並掛 result 監聽。
const defaultExecuteDeps: ExecuteDeps = {
  start: (item, workspaceId) => {
    const s = agentManager.start(item.agentId, `🛠️ 外包執行：${item.task.slice(0, 24)}`, undefined, workspaceId, false);
    agentManager.send(s.id, buildExecutePrompt(item.task));
    return s.id;
  },
  attachDone: (subSessionId, cb) => {
    const s = agentManager.get(subSessionId);
    if (!s) { cb("（子 session 不存在）", false); return; }
    let collected = "";
    let streamed = "";
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.removeListener("event", onEvent);
      cb((collected || streamed).trim() || "（執行未產出內容）", ok);
    };
    const onEvent = (evt: any) => {
      if (evt.type === "delta" && typeof evt.payload === "string") streamed += evt.payload;
      else if (evt.type === "message" && evt.payload?.content) collected = String(evt.payload.content);
      else if (evt.type === "result") done(!!(collected || streamed));
    };
    const timer = setTimeout(() => done(false), EXECUTE_MAX_MS);
    s.on("event", onEvent);
  },
};

/**
 * 啟動 execute 項為背景真 session（不等完成），完成時透過 onDone 把結果交回。
 * 立即返回 handle。execute 任務可能跑數分鐘，故非同步、不卡 PM。
 */
export function startExecute(
  items: DispatchItem[],
  workspaceId: string,
  pmSessionId: string,
  onDone: (d: ExecuteDone) => void,
  deps: ExecuteDeps = defaultExecuteDeps,
): ExecuteHandle[] {
  return items.map((item) => {
    const subSessionId = deps.start(item, workspaceId);
    deps.attachDone(subSessionId, (output, ok) =>
      onDone({ pmSessionId, agentId: item.agentId, subSessionId, output, status: ok ? "ok" : "error" }),
    );
    return { subSessionId, agentId: item.agentId };
  });
}
