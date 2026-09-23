/**
 * Active-view navigation for NAC OS admin shell.
 * Prefetches lazy chunks on hover/idle; the shell mounts only the active view
 * so inactive pages cannot keep fetching or polling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function useKeepAliveNav(initialView = "overview") {
  const [activeView, setActiveViewState] = useState(initialView);
  const prefetchTimers = useRef({});

  const setActiveView = useCallback((viewId) => {
    if (!viewId) return;
    setActiveViewState(viewId);
  }, []);

  /** @deprecated Prefer active-only mount; kept for call-site compatibility. */
  const ensureMounted = useCallback(() => {}, []);

  const schedulePrefetch = useCallback((viewId, importer, delayMs = 120) => {
    if (!viewId || typeof importer !== "function") return;
    window.clearTimeout(prefetchTimers.current[viewId]);
    prefetchTimers.current[viewId] = window.setTimeout(() => {
      try {
        const result = importer();
        if (result && typeof result.then === "function") {
          result.catch(() => {});
        }
      } catch {
        /* ignore prefetch errors */
      }
    }, delayMs);
  }, []);

  const cancelPrefetch = useCallback((viewId) => {
    if (!viewId) return;
    window.clearTimeout(prefetchTimers.current[viewId]);
  }, []);

  useEffect(
    () => () => {
      Object.values(prefetchTimers.current).forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  /** Active-only: a view is "mounted" only while it is the active route. */
  const isMounted = useCallback((viewId) => viewId === activeView, [activeView]);

  return useMemo(
    () => ({
      activeView,
      setActiveView,
      ensureMounted,
      isMounted,
      mountedViews: new Set([activeView]),
      schedulePrefetch,
      cancelPrefetch,
    }),
    [activeView, setActiveView, ensureMounted, isMounted, schedulePrefetch, cancelPrefetch],
  );
}
