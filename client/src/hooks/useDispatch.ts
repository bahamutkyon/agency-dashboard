import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { detectDispatch, dispatchStorageKey, type DispatchMsg } from "../lib/dispatchDetection";

export interface ConsultRaw {
  agentId: string;
  task: string;
  output: string;
  status: string;
  subSessionId: string;
}

/**
 * 派工偵測 + 批准流程。偵測純邏輯在 lib/dispatchDetection（有單元測試）；
 * 本 hook 負責 React 狀態（busy/dispatched/consultRaw）與 localStorage 指紋。
 */
export function useDispatch(messages: DispatchMsg[], agentId: string, sessionId: string) {
  const detectedDispatch = useMemo(() => detectDispatch(messages, agentId), [messages, agentId]);

  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const [consultRaw, setConsultRaw] = useState<ConsultRaw[] | null>(null);

  // 指紋 key：補強 consult 同步執行中重整的窄窗重複派工風險。
  const dispatchKey = useMemo(
    () => dispatchStorageKey(sessionId, detectedDispatch),
    [detectedDispatch, sessionId],
  );

  // 換到新的派工（或無派工）時重設；若該指紋已批准過則維持隱藏。
  useEffect(() => {
    if (dispatchKey && typeof localStorage !== "undefined" && localStorage.getItem(dispatchKey)) {
      setDispatched(true);
    } else {
      setDispatched(false);
    }
  }, [dispatchKey]);

  const markDispatched = () => {
    if (dispatchKey && typeof localStorage !== "undefined") localStorage.setItem(dispatchKey, "1");
    setDispatched(true);
  };

  const approveDispatch = async () => {
    if (!detectedDispatch) return;
    setDispatchBusy(true);
    try {
      const r = await api.dispatch(sessionId, detectedDispatch);
      setConsultRaw(r.consulted);
      markDispatched();
    } catch (e: any) {
      alert("派工失敗：" + (e?.message || e));
    } finally {
      setDispatchBusy(false);
    }
  };

  return { detectedDispatch, dispatchBusy, dispatched, consultRaw, approveDispatch, markDispatched };
}
