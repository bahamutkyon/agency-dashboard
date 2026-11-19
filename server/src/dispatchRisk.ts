/**
 * 派工風險分級：決定 PM 的 DISPATCH 要不要停下來等使用者批准。
 *
 * 原則（使用者 2026-11-19 拍板）：內部工作（諮詢、查資料、寫報告存檔、退回重做）直接跑；
 * 只有「對外動作」——上架、發文、寄信、付款下單、刪除、登入帳號——才跳批准卡。
 * 判斷兩層：PM 自己標 `external: true`，加上關鍵字保險（PM 忘了標也攔得到）。
 * 誤判方向刻意偏保守：多攔一張卡＝回到舊行為，不會闖禍。
 */
import type { DispatchItem } from "./dispatchParser.js";

const EXTERNAL_RE = /上架|下架|刊登|發布|發佈|發文|發貼|貼文發出|寄出|寄信|發信|寄送|私訊|付款|下單|購買|結帳|轉帳|匯款|刪除|登入|註冊|部署|正式環境/g;
/** 否定語在關鍵字前 0–6 字內（「不要發布」「先不上架」「別寄出」）→ 不算。 */
const NEGATION_RE = /(不要|不得|不可|不用|不會|先不|暫不|勿|別|禁止|切勿)[^，。；、\n]{0,6}$/;

const NOUN_AFTER_RE = /^(文案|草稿|清單|資料|建議|計畫|規劃|流程|格式|說明|範本|模板|檢查|前)/;

function externalHits(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(EXTERNAL_RE)) {
    const before = text.slice(Math.max(0, m.index! - 8), m.index!);
    if (NEGATION_RE.test(before)) continue;
    // 名詞用法（「上架文案」「發文草稿」「付款方式說明」）是內部產出，不是動作
    if (NOUN_AFTER_RE.test(text.slice(m.index! + m[0].length))) continue;
    hits.push(m[0]);
  }
  return hits;
}

export function dispatchNeedsApproval(items: DispatchItem[]): { needs: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  for (const it of items) {
    if (it.external) reasons.add("專案經理標為對外");
    for (const h of externalHits([it.task, it.context ?? "", it.deliverable ?? ""].join("\n"))) reasons.add(h);
  }
  return { needs: reasons.size > 0, reasons: [...reasons] };
}
