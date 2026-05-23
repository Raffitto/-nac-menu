import React, { createContext, useContext } from "react";
import { useMenuBiDashboard } from "../hooks/useMenuBiDashboard";
import PipelineDebugOverlay from "../components/PipelineDebugOverlay";

const MenuBiDashboardContext = createContext(null);

/**
 * Single BI fetch for Intelligence Hub / shared admin surfaces.
 */
export function MenuBiDashboardProvider({ children, options = {}, source }) {
  const value = useMenuBiDashboard({
    ...options,
    source: source || options.source || "MenuBiDashboardProvider",
  });
  return (
    <MenuBiDashboardContext.Provider value={value}>
      {children}
      <PipelineDebugOverlay />
    </MenuBiDashboardContext.Provider>
  );
}

/** Use inside MenuBiDashboardProvider to avoid duplicate BI fetches. */
export function useMenuBiDashboardContext() {
  const ctx = useContext(MenuBiDashboardContext);
  if (!ctx) {
    throw new Error("useMenuBiDashboardContext requires MenuBiDashboardProvider");
  }
  return ctx;
}

export default MenuBiDashboardContext;
