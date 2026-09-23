import React, { createContext, useContext, useMemo } from "react";

const ActiveViewContext = createContext({
  activeView: "overview",
  isActive: () => true,
});

/**
 * Shell-level active view for keep-alive / route gating.
 * Data hooks should AND their `enabled` flag with `useIsViewActive(viewId)`.
 */
export function ActiveViewProvider({ activeView, children }) {
  const value = useMemo(
    () => ({
      activeView,
      isActive: (viewId) => !viewId || viewId === activeView,
    }),
    [activeView],
  );
  return <ActiveViewContext.Provider value={value}>{children}</ActiveViewContext.Provider>;
}

export function useActiveView() {
  return useContext(ActiveViewContext);
}

/** True when this pane is the visible admin view (or no provider — treat as active). */
export function useIsViewActive(viewId) {
  const ctx = useContext(ActiveViewContext);
  if (!viewId) return true;
  return ctx.isActive(viewId);
}

export default ActiveViewContext;
