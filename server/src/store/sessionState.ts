/**
 * 對話狀態（C1/C2）與交接來源（D2）。獨立於 upsertSession——它只 UPDATE 固定欄位，這些欄位不會被覆蓋。
 *
 * state：open | waiting_user | done | null
 * state_source：manual（使用者按的，自動摘要不覆蓋——除非之後又有新訊息，代表對話重啟）| auto
 */
import { db } from "../db.js";

export type SessionStateValue = "open" | "waiting_user" | "done";

export interface SessionStateRow {
  state: SessionStateValue | null;
  stateSource: "manual" | "auto" | null;
  stateAt: number | null;
  stoppedAt: string | null;
  digestAt: number | null;
  handoffFrom: string | null;
}

export function getSessionState(id: string): SessionStateRow | undefined {
  const r = db.prepare("SELECT state, state_source, state_at, stopped_at, digest_at, handoff_from FROM sessions WHERE id = ?").get(id) as any;
  if (!r) return undefined;
  return {
    state: r.state ?? null, stateSource: r.state_source ?? null, stateAt: r.state_at ?? null,
    stoppedAt: r.stopped_at ?? null, digestAt: r.digest_at ?? null, handoffFrom: r.handoff_from ?? null,
  };
}

/** 使用者手動標記（null＝清除，重新開啟）。 */
export function setManualState(id: string, state: SessionStateValue | null, now = Date.now()): void {
  db.prepare("UPDATE sessions SET state = ?, state_source = ?, state_at = ? WHERE id = ?")
    .run(state, state ? "manual" : null, state ? now : null, id);
}

/** 閒置回收時模型產生的「停在哪」＋狀態。手動狀態只在之後又有新訊息時才會被覆蓋。 */
export function setAutoDigest(id: string, stoppedAt: string, state: SessionStateValue, now = Date.now()): void {
  const cur = getSessionState(id);
  if (!cur) return;
  let keepManual = false;
  if (cur.stateSource === "manual" && cur.stateAt != null) {
    const newer = db.prepare("SELECT 1 FROM messages WHERE session_id = ? AND ts > ? LIMIT 1").get(id, cur.stateAt);
    keepManual = !newer;
  }
  if (keepManual) {
    db.prepare("UPDATE sessions SET stopped_at = ?, digest_at = ? WHERE id = ?").run(stoppedAt, now, id);
  } else {
    db.prepare("UPDATE sessions SET stopped_at = ?, digest_at = ?, state = ?, state_source = 'auto', state_at = ? WHERE id = ?")
      .run(stoppedAt, now, state, now, id);
  }
}

export function setHandoffFrom(id: string, fromId: string | null): void {
  db.prepare("UPDATE sessions SET handoff_from = ? WHERE id = ?").run(fromId, id);
}
