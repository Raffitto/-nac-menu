import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useRbac } from "../../context/RbacContext";
import { PERMISSIONS } from "../../config/rbac";
import {
  INTELLIGENCE_TABS,
  MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS,
  getIntelligenceSecondaryTabs,
  normalizeIntelligenceTabId,
  resolveIntelligenceDestination,
} from "../../navigation";
import IntelligenceDashboardsTab from "./IntelligenceDashboardsTab";
import IntelligenceVaultTab from "./IntelligenceVaultTab";
import IntelligenceMobileSettingsTab from "./IntelligenceMobileSettingsTab";
import AskNacTab from "../AskNacTab";
import "../../styles/intelligence-mobile.css";

function applySalesSectionHint(rawTab, setSalesSection) {
  const raw = String(rawTab || "").toLowerCase();
  if (raw === "imports" || raw === "foodics") setSalesSection("upload");
}

function firstVisibleDashboardTab(visibleIds) {
  const hit = MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS.find((id) => visibleIds.includes(id));
  return hit || visibleIds[0] || "operations";
}

export default function IntelligenceMobileShell({
  askNacPrefill,
  askNacPrefillSeed,
  onAskNacPrefillConsumed,
  onAskNacFromSales,
  salesSection,
  setSalesSection,
}) {
  const rbac = useRbac();
  const [mobileTab, setMobileTab] = useState("ask");
  const [dashboardTab, setDashboardTab] = useState("operations");
  const [secondaryByPrimary, setSecondaryByPrimary] = useState({
    operations: "overview",
    commercial: "sales",
    market: "visual",
  });

  const visibleIntelligenceTabs = useMemo(
    () => INTELLIGENCE_TABS.filter((tab) => rbac.canAccessIntelligenceTab(tab.id)),
    [rbac],
  );

  const visibleDashboardTabs = useMemo(
    () => visibleIntelligenceTabs.filter((tab) => tab.id !== "ask").map((tab) => tab.id),
    [visibleIntelligenceTabs],
  );

  const secondaryTabs = useMemo(() => {
    const tabs = getIntelligenceSecondaryTabs(dashboardTab);
    return tabs.filter((tab) =>
      rbac.canAccessIntelligenceSecondary
        ? rbac.canAccessIntelligenceSecondary(dashboardTab, tab.id)
        : true,
    );
  }, [dashboardTab, rbac]);

  const activeSecondary =
    secondaryTabs.find((tab) => tab.id === secondaryByPrimary[dashboardTab])?.id ||
    secondaryTabs[0]?.id ||
    null;

  useEffect(() => {
    if (!visibleDashboardTabs.length) return;
    if (!visibleDashboardTabs.includes(dashboardTab)) {
      setDashboardTab(firstVisibleDashboardTab(visibleDashboardTabs));
    }
  }, [dashboardTab, visibleDashboardTabs]);

  useEffect(() => {
    if (!secondaryTabs.length || !activeSecondary) return;
    if (!secondaryTabs.some((tab) => tab.id === activeSecondary)) {
      setSecondaryByPrimary((prev) => ({
        ...prev,
        [dashboardTab]: secondaryTabs[0].id,
      }));
    }
  }, [activeSecondary, dashboardTab, secondaryTabs]);

  const handleDashboardTabChange = useCallback(
    (nextTab) => {
      const raw = String(nextTab || "").toLowerCase();
      applySalesSectionHint(raw, setSalesSection);
      if (INTELLIGENCE_TABS.some((tab) => tab.id === raw)) {
        setDashboardTab(raw);
        return;
      }
      const dest = resolveIntelligenceDestination(nextTab);
      setDashboardTab(dest.primary);
      if (dest.secondary) {
        setSecondaryByPrimary((prev) => ({ ...prev, [dest.primary]: dest.secondary }));
      }
    },
    [setSalesSection],
  );

  const handleSecondaryTabChange = useCallback((nextSecondary) => {
    setSecondaryByPrimary((prev) => ({ ...prev, [dashboardTab]: nextSecondary }));
  }, [dashboardTab]);

  const handleAskNacFromSalesMobile = useCallback(
    (question) => {
      onAskNacFromSales?.(question);
      setMobileTab("ask");
    },
    [onAskNacFromSales],
  );

  const handleMobileNavigate = useCallback((sectionId) => {
    const dest = resolveIntelligenceDestination(sectionId);
    if (dest.primary !== "ask" && MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS.includes(dest.primary)) {
      setDashboardTab(dest.primary);
      if (dest.secondary) {
        setSecondaryByPrimary((prev) => ({ ...prev, [dest.primary]: dest.secondary }));
      }
      setMobileTab("dashboards");
      return;
    }
    setMobileTab(sectionId);
  }, []);

  const showExecutiveExport = rbac.hasPermission(PERMISSIONS.VIEW_EXECUTIVE_EXPORT);
  const session = rbac.session;
  const isAskTab = mobileTab === "ask";

  return (
    <motion.div
      className={`nac-intelligence-hub nac-intelligence-hub--mobile ${isAskTab ? "nac-intelligence-hub--ask" : "nac-intelligence-hub--section"}`.trim()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {!isAskTab ? (
        <header className="nac-intelligence-mobile-section-topbar">
          <button
            type="button"
            className="nac-intelligence-mobile-section-topbar__back"
            onClick={() => setMobileTab("ask")}
            aria-label="Back to Ask NAC"
          >
            <ArrowLeft size={18} aria-hidden />
            <span>Ask NAC</span>
          </button>
          <span className="nac-intelligence-mobile-section-topbar__label">
            {mobileTab === "dashboards" ? "Dashboards" : mobileTab === "vault" ? "Vault" : "Settings"}
          </span>
        </header>
      ) : null}

      <main className="nac-intelligence-mobile-main">
        {isAskTab ? (
          <AskNacTab
            initialQuestion={askNacPrefill}
            prefillSeed={askNacPrefillSeed}
            onInitialQuestionConsumed={onAskNacPrefillConsumed}
            onAskNacFromSales={handleAskNacFromSalesMobile}
            mobileFirst
            showVaultPanel={false}
            maxSuggestions={3}
            onMobileNavigate={handleMobileNavigate}
          />
        ) : null}

        {mobileTab === "dashboards" ? (
          <IntelligenceDashboardsTab
            activeDashboardTab={normalizeIntelligenceTabId(dashboardTab)}
            onDashboardTabChange={handleDashboardTabChange}
            visibleDashboardTabs={visibleDashboardTabs}
            secondaryTab={activeSecondary}
            onSecondaryTabChange={handleSecondaryTabChange}
            visibleSecondaryTabs={secondaryTabs.map((tab) => tab.id)}
            salesSection={salesSection}
            onAskNacFromSales={handleAskNacFromSalesMobile}
          />
        ) : null}

        {mobileTab === "vault" ? <IntelligenceVaultTab session={session} /> : null}
        {mobileTab === "settings" ? (
          <IntelligenceMobileSettingsTab showExecutiveExport={showExecutiveExport} />
        ) : null}
      </main>
    </motion.div>
  );
}
