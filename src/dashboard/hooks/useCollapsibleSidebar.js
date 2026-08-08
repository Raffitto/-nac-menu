import { useCallback, useEffect, useState } from "react";
import {
  SIDEBAR_EVENTS,
  defaultCollapsedForViewport,
  notifyLayoutResize,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "../../lib/sidebarPrefs";

/**
 * Independent persisted collapse state for app / menu sidebars.
 */
export default function useCollapsibleSidebar(storageKey, { toggleEvent } = {}) {
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed(storageKey, defaultCollapsedForViewport()),
  );

  const setAndPersist = useCallback(
    (next) => {
      setCollapsed((prev) => {
        const value = typeof next === "function" ? next(prev) : Boolean(next);
        writeSidebarCollapsed(storageKey, value);
        if (typeof window !== "undefined") {
          window.setTimeout(notifyLayoutResize, 220);
        }
        return value;
      });
    },
    [storageKey],
  );

  const toggle = useCallback(() => {
    setAndPersist((prev) => !prev);
  }, [setAndPersist]);

  const expand = useCallback(() => setAndPersist(false), [setAndPersist]);
  const collapse = useCallback(() => setAndPersist(true), [setAndPersist]);

  useEffect(() => {
    if (!toggleEvent) return undefined;
    const onToggle = () => toggle();
    window.addEventListener(toggleEvent, onToggle);
    return () => window.removeEventListener(toggleEvent, onToggle);
  }, [toggleEvent, toggle]);

  useEffect(() => {
    const onChanged = (event) => {
      if (event?.detail?.key !== storageKey) return;
      setCollapsed(Boolean(event.detail.collapsed));
    };
    window.addEventListener(SIDEBAR_EVENTS.changed, onChanged);
    return () => window.removeEventListener(SIDEBAR_EVENTS.changed, onChanged);
  }, [storageKey]);

  return {
    collapsed,
    toggle,
    expand,
    collapse,
    setCollapsed: setAndPersist,
  };
}
