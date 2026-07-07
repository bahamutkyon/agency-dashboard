import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AutonomyRun, type PendingAction, type DispatchItem } from "../lib/api";
import { getSocket } from "../lib/socket";

export function useAutonomy(sessionId: string) {
  const [run, setRun] = useState<AutonomyRun | null>(null);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [{ run: r }, { pending: p }] = await Promise.all([
      api.autonomyRun(sessionId),
      api.autonomyPending(sessionId),
    ]);
    setRun(r);
    setPending(p);
  }, [sessionId]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const sock = getSocket();
    const handler = () => {
      void refresh();
    };
    sock.on("autonomy:event", handler);
    return () => {
      sock.off("autonomy:event", handler);
    };
  }, [refresh]);

  const start = async (goal: string, opts?: { policy?: string; maxSteps?: number; maxWallMs?: number }) => {
    setBusy(true);
    try {
      await api.autonomyStart(sessionId, goal, opts);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (run) {
      setBusy(true);
      try {
        await api.autonomyApprovePlan(run.id);
        await refresh();
      } finally {
        setBusy(false);
      }
    }
  };

  const stop = async () => {
    if (run) {
      try {
        await api.autonomyStop(run.id);
        await refresh();
      } catch (e) {
        console.warn("autonomy stop failed", e);
      }
    }
  };

  const resume = async () => {
    if (run) {
      try {
        await api.autonomyResume(run.id);
        await refresh();
      } catch (e) {
        console.warn("autonomy resume failed", e);
      }
    }
  };

  const sendInput = async (text: string) => {
    if (run) {
      await api.autonomyInput(run.id, text);
      await refresh();
    }
  };

  const inject = async (text: string): Promise<boolean> => {
    if (run) {
      setBusy(true);
      try {
        await api.autonomyInject(run.id, text);
        await refresh();
        return true;
      } catch (e) {
        console.warn("autonomy inject failed", e);
        return false;
      } finally {
        setBusy(false);
      }
    }
    return false;
  };

  // A4：後端 CAS 對重複核可/拒絕回 409。前端顯示訊息即可、不當錯誤爆紅，並 refresh
  //（此時卡片多半已被別的分頁/請求處理掉，refresh 後自然消失）。
  const handleDecisionError = async (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      alert("此動作已處理過");
      await refresh();
      return;
    }
    throw e;
  };

  // B5：把批准卡逐項勾選/編輯後的 items 一併送出（後端據此只跑勾選項並回饋被拿掉的）。
  const approveAction = async (id: string, items?: DispatchItem[]) => {
    setBusy(true);
    try {
      await api.actionApprove(id, items && items.length > 0 ? { items } : undefined);
      await refresh();
    } catch (e) {
      await handleDecisionError(e);
    } finally {
      setBusy(false);
    }
  };

  const rejectAction = async (id: string) => {
    setBusy(true);
    try {
      await api.actionReject(id);
      await refresh();
    } catch (e) {
      await handleDecisionError(e);
    } finally {
      setBusy(false);
    }
  };

  return {
    run,
    pending,
    busy,
    start,
    approvePlan,
    stop,
    resume,
    sendInput,
    inject,
    approveAction,
    rejectAction,
  };
}
