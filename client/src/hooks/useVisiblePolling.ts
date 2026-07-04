import { useEffect, useRef } from "react";

/**
 * useVisiblePolling — setInterval that pauses automatically when the document
 * is hidden (e.g. phone background, minimised tab) and resumes when visible.
 *
 * On resume, fn is called immediately so the UI refreshes right away instead
 * of waiting for the next full interval.
 *
 * @param fn         Poll function. A new reference on every render is fine —
 *                   the hook always calls the latest version via an internal ref.
 * @param intervalMs Polling interval in milliseconds.
 */
export function useVisiblePolling(fn: () => void, intervalMs: number): void {
  // Keep a ref to the latest fn so the effect doesn't need to re-run when fn changes.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;

    const run = () => fnRef.current();

    const startPolling = () => {
      if (t !== null) return; // already running
      t = setInterval(run, intervalMs);
    };

    const stopPolling = () => {
      if (t !== null) {
        clearInterval(t);
        t = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run(); // immediate refresh on resume
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Initial run + start interval if already visible
    run();
    if (document.visibilityState === "visible") {
      startPolling();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    };
  }, [intervalMs]); // fn changes are handled via fnRef; re-run only if interval changes
}
