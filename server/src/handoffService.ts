/**
 * 專案經理一句話交接：存交接單 → 開新 PM 對話（同工作區/project，帶入交接單）→ 舊對話標已交接。
 * 依賴注入（start/stop/emit），避免與 routes/agentManager 循環 import，也方便測試。
 */
import { getSession, DEFAULT_WORKSPACE_ID } from "./store.js";
import { getSessionState, setHandoffDoc, setHandedOffTo, setAutoDigest } from "./store/sessionState.js";

export interface HandoffDeps {
  start: (wsId: string, opts: { projectId?: string; handoffFrom: string }) => string;
  stop: (sessionId: string) => void;
  emit: (event: string, payload: unknown) => void;
}

export interface HandoffResult { ok: boolean; toId?: string; reused?: boolean; error?: string }

export function performHandoff(fromId: string, doc: string, deps: HandoffDeps): HandoffResult {
  const from = getSession(fromId);
  if (!from) return { ok: false, error: "來源對話不存在" };

  const prevTo = getSessionState(fromId)?.handedOffTo;
  const prev = prevTo ? getSession(prevTo) : undefined;
  if (prev) {
    // 新對話還沒開聊：更新交接單並停程序，下一句話用新版喚醒。
    // 已開聊：新對話已依舊版交接單在走，不改寫（否則卡片顯示與喚醒 prompt 會悄悄換掉，同 PUT 的限制）。
    const started = (prev.messages || []).some((m) => m.role === "user");
    if (!started) { setHandoffDoc(fromId, doc); deps.stop(prev.id); }
    deps.emit("session:handoff", { fromId, toId: prev.id, toTitle: prev.title });
    return { ok: true, toId: prev.id, reused: true };
  }

  setHandoffDoc(fromId, doc);
  let toId: string;
  try {
    toId = deps.start(from.workspaceId || DEFAULT_WORKSPACE_ID, { projectId: from.projectId || undefined, handoffFrom: fromId });
  } catch (e: any) {
    const error = String(e?.message || e);
    deps.emit("session:handoff_failed", { fromId, error });
    return { ok: false, error };
  }
  setHandedOffTo(fromId, toId);
  setAutoDigest(fromId, "已交接到新對話", "done");
  deps.emit("session:handoff", { fromId, toId, toTitle: getSession(toId)?.title ?? "" });
  return { ok: true, toId };
}
