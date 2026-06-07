import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRbac } from "../../context/RbacContext";
import { PERMISSIONS } from "../../config/rbac";
import {
  INTELLIGENCE_TABS,
  MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS,
  normalizeIntelligenceTabId,
} from "../../navigation";
import IntelligenceMobileNav from "./IntelligenceMobileNav";
import IntelligenceDashboardsTab from "./IntelligenceDashboardsTab";
import IntelligenceVaultTab from "./IntelligenceVaultTab";
import IntelligenceMobileSettingsTab from "./IntelligenceMobileSettingsTab";
import IntelligenceTabPanels from "../IntelligenceTabPanels";
import "../../styles/intelligence-mobile.css";

function applyLegacyTabHints(rawTab, setSalesSection, setRestaurantSection) {
  const raw = String(rawTab || "").toLowerCase();
  if (raw === "imports" || raw === "foodics") setSalesSection("upload");
  if (raw === "operations") setRestaurantSection("operations");
}

function firstVisibleDashboardTab(visibleIds) {
  const hit = MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS.find((id) => visibleIds.includes(id));
  return hit || visibleIds[0] || "executive";
}

export default function IntelligenceMobileShell({
  askNacPrefill,
  askNacPrefillSeed,
  onAskNacPrefillConsumed,
  onAskNacFromSales,
  salesSection,
  setSalesSection,
  restaurantSection,
  setRestaurantSection,
}) {
  const rbac = useRbac();
  const [mobileTab, setMobileTab] = useState("ask");
  const [dashboardTab, setDashboardTab] = useState("executive");

  const visibleIntelligenceTabs = useMemo(
    () => INTELLIGENCE_TABS.filter((tab) => rbac.canAccessIntelligenceTab(tab.id)),
    [rbac],
  );

  const visibleDashboardTabs = useMemo(
    () => visibleIntelligenceTabs.filter((tab) => tab.id !== "ask").map((tab) => tab.id),
    [visibleIntelligenceTabs],
  );

  useEffect(() => {
    if (!visibleDashboardTabs.length) return;
    if (!visibleDashboardTabs.includes(dashboardTab)) {
      setDashboardTab(firstVisibleDashboardTab(visibleDashboardTabs));
    }
  }, [dashboardTab, visibleDashboardTabs]);

  const handleDashboardTabChange = useCallback(
    (nextTab) => {
      const normalized = normalizeIntelligenceTabId(nextTab);
      applyLegacyTabHints(normalized, setSalesSection, setRestaurantSection);
      setDashboardTab(normalized);
    },
    [setRestaurantSection, setSalesSection],
  );

  const handleAskNacFromSalesMobile = useCallback(
    (question) => {
      onAskNacFromSales?.(question);
      setMobileTab("ask");
    },
    [onAskNacFromSales],
  );

  const showExecutiveExport = rbac.hasPermission(PERMISSIONS.VIEW_EXECUTIVE_EXPORT);
  const session = rbac.session;

  return (
    <motion.div
      className="nac-intelligence-hub nac-intelligence-hub--mobile"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <main className="nac-intelligence-mobile-main">
        {mobileTab === "ask" ? (
          <IntelligenceTabPanels
            activeTab="ask"
            askNacPrefill={askNacPrefill}
            askNacPrefillSeed={askNacPrefillSeed}
            onAskNacPrefillConsumed={onAskNacPrefillConsumed}
            onAskNacFromSales={handleAskNacFromSalesMobile}
            askNacMobileFirst
          />
        ) : null}

        {mobileTab === "dashboards" ? (
          <IntelligenceDashboardsTab
            activeDashboardTab={dashboardTab}
            onDashboardTabChange={handleDashboardTabChange}
            visibleDashboardTabs={visibleDashboardTabs}
            salesSection={salesSection}
            restaurantSection={restaurantSection}
            onAskNacFromSales={handleAskNacFromSalesMobile}
          />
        ) : null}

        {mobileTab === "vault" ? <IntelligenceVaultTab session={session} /> : null}

        {mobileTab === "settings" ? (
          <IntelligenceMobileSettingsTab showExecutiveExport={showExecutiveExport} />
        ) : null}
      </main>

      <IntelligenceMobileNav active={mobileTab} onChange={setMobileTab} />
    </motion.div>
  );
}
