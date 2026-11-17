/** 串流訊息合併。舊版只看「最後一則」是否串流中——思考中送出補充訊息後，最後一則變成使用者訊息，
 *  後續 delta 會新增一則重複的回覆。改成找「最後一則串流中」的位置就地更新。 */
export interface MergeMsg { role: "user" | "assistant" | "system"; content: string; ts: number; partial?: boolean }

function lastPartialIdx<T extends MergeMsg>(prev: T[]): number {
  for (let i = prev.length - 1; i >= 0; i--) if (prev[i].partial) return i;
  return -1;
}

export function applyDelta<T extends MergeMsg>(prev: T[], streamed: string): T[] {
  const i = lastPartialIdx(prev);
  if (i >= 0) return prev.map((m, j) => (j === i ? { ...m, content: streamed } : m));
  return [...prev, { role: "assistant", content: streamed, ts: Date.now(), partial: true } as T];
}

export function applyFinal<T extends MergeMsg>(prev: T[], content: string): T[] {
  const finalMsg = { role: "assistant", content, ts: Date.now() } as T;
  const i = lastPartialIdx(prev);
  if (i >= 0) return prev.map((m, j) => (j === i ? finalMsg : m));
  return [...prev, finalMsg];
}
