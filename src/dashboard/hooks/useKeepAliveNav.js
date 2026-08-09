import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Keep visited dashboard views mounted so return navigation is instant.
 * Active view is shown; inactive visited views stay mounted but hidden.
 */
export default function useKeepAliveNav(initialView = "overview") {
  const [activeView, setActiveViewState] = useState(initialView);
  const [mounted, setMounted] = useState(() => new Set([initialView]));
  const prefetchTimers = useRef({});

  const setActiveView = useCallback((viewId) => {
    if (!viewId) return;
    setActiveViewState(viewId);
    setMounted((prev) => {
      if (prev.has(viewId)) return prev;
      const next = new Set(prev);
      next.add(viewId);
      return next;
    });
  }, []);

  const ensureMounted = useCallback((viewId) => {
    if (!viewId) return;
    setMounted((prev) => {
      if (prev.has(viewId)) return prev;
      const next = new Set(prev);
      next.add(viewId);
      return next;
    });
  }, []);

  const schedulePrefetch = useCallback(
    (viewId, importer, delayMs = 120) => {
      if (!viewId || typeof importer !== "function") return;
      if (mounted.has(viewId)) return;
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
    },
    [mounted],
  );

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

  const isMounted = useCallback((viewId) => mounted.has(viewId), [mounted]);

  return useMemo(
    () => ({
      activeView,
      setActiveView,
      ensureMounted,
      isMounted,
      mountedViews: mounted,
      schedulePrefetch,
      cancelPrefetch,
    }),
    [activeView, setActiveView, ensureMounted, isMounted, mounted, schedulePrefetch, cancelPrefetch],
  );
}
