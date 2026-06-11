import { useCallback, useEffect, useState } from "react";
import { api, type AutonomyRun, type PendingAction } from "../lib/api";
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

  const start = async (goal: string) => {
    setBusy(true);
    try {
      await api.autonomyStart(sessionId, goal);
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
      await api.autonomyStop(run.id);
      await refresh();
    }
  };

  const resume = async () => {
    if (run) {
      await api.autonomyResume(run.id);
      await refresh();
    }
  };

  const sendInput = async (text: string) => {
    if (run) {
      await api.autonomyInput(run.id, text);
      await refresh();
    }
  };

  const approveAction = async (id: string) => {
    setBusy(true);
    try {
      await api.actionApprove(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const rejectAction = async (id: string) => {
    setBusy(true);
    try {
      await api.actionReject(id);
      await refresh();
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
    approveAction,
    rejectAction,
  };
}
