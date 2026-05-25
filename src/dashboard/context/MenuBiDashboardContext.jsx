import React, { createContext, useContext, useEffect } from "react";
import { useMenuBiDashboard } from "../hooks/useMenuBiDashboard";
import PipelineDebugOverlay from "../components/PipelineDebugOverlay";
import AnalyticsIntegrityPanel from "../components/AnalyticsIntegrityPanel";
import { installTruthValidationGlobals } from "../../lib/truthValidationRegistry";

const MenuBiDashboardContext = createContext(null);

/**
 * Single BI fetch for Intelligence Hub / shared admin surfaces.
 */
export function MenuBiDashboardProvider({ children, options = {}, source }) {
  useEffect(() => {
    installTruthValidationGlobals();
  }, []);

  const value = useMenuBiDashboard({
    ...options,
    source: source || options.source || "MenuBiDashboardProvider",
  });
  return (
    <MenuBiDashboardContext.Provider value={value}>
      {children}
      <PipelineDebugOverlay />
      <AnalyticsIntegrityPanel />
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

/** Safe accessor when provider may be absent (e.g. mixed hub layouts). */
export function useMenuBiDashboardContextOptional() {
  return useContext(MenuBiDashboardContext);
}

export default MenuBiDashboardContext;
