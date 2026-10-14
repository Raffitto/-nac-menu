import { useEffect } from "react";

/**
 * Poll only while the tab is visible. Hidden tabs stop the timer.
 * Becoming visible refreshes once, then the interval starts again.
 */
export function useVisiblePolling(callback, intervalMs, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      if (timer || document.visibilityState === "hidden") return;
      timer = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        callback();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      callback();
      start();
    };

    if (document.visibilityState !== "hidden") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [callback, intervalMs, enabled]);
}
