import React, { useMemo, useState, useCallback } from "react";
import { GooglePlacesProvider } from "../context/GooglePlacesContext";
import { motion } from "framer-motion";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import ExecutiveExportButton from "../components/ExecutiveExportButton";
import IntelligenceDataStatus from "../components/IntelligenceDataStatus";
import { INTELLIGENCE_TABS, normalizeIntelligenceTabId } from "../navigation";
import { MenuBiDashboardProvider, useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useRbac } from "../context/RbacContext";
import { PERMISSIONS } from "../config/rbac";
import IntelligenceTabPanels from "../intelligence/IntelligenceTabPanels";
import IntelligenceMobileShell from "../intelligence/mobile/IntelligenceMobileShell";
import { useMobileIntelligenceLayout } from "../hooks/useMobileIntelligenceLayout";
import "../styles/platform-os.css";
import "../styles/review-intelligence.css";
import "../styles/intelligence-polish.css";

function IntelligenceTrustStrip() {
  const { operationalTrust } = useMenuBiDashboardContext();
  return <OperationalTrustBadge trust={operationalTrust} />;
}

function applyLegacyTabHints(rawTab, setSalesSection, setRestaurantSection) {
  const raw = String(rawTab || "").toLowerCase();
  if (raw === "imports" || raw === "foodics") setSalesSection("upload");
  if (raw === "operations") setRestaurantSection("operations");
}

function IntelligenceHubDesktop() {
  const [tab, setTab] = useState("ask");
  const [salesSection, setSalesSection] = useState("upload");
  const [restaurantSection, setRestaurantSection] = useState("overview");
  const [askNacPrefill, setAskNacPrefill] = useState("");
  const [askNacPrefillSeed, setAskNacPrefillSeed] = useState(0);
  const rbac = useRbac();
  const visibleTabs = useMemo(
    () => INTELLIGENCE_TABS.filter((t) => rbac.canAccessIntelligenceTab(t.id)),
    [rbac],
  );

  const activeTab = normalizeIntelligenceTabId(tab);

  React.useEffect(() => {
    if (!visibleTabs.length) return;
    applyLegacyTabHints(tab, setSalesSection, setRestaurantSection);
    const normalized = normalizeIntelligenceTabId(tab);
    if (!visibleTabs.some((t) => t.id === normalized)) {
      setTab(visibleTabs[0].id);
    } else if (normalized !== tab) {
      setTab(normalized);
    }
  }, [tab, visibleTabs]);

  const handleTabChange = (nextTab) => {
    const raw = String(nextTab || "").toLowerCase();
    if (raw === "sales") setSalesSection("upload");
    if (raw === "restaurant") setRestaurantSection("overview");
    applyLegacyTabHints(raw, setSalesSection, setRestaurantSection);
    setTab(normalizeIntelligenceTabId(nextTab));
  };

  const handleAskNacFromSales = useCallback((question) => {
    setAskNacPrefill(String(question || "").trim());
    setAskNacPrefillSeed((seed) => seed + 1);
    setTab("ask");
  }, []);

  const handleAskNacPrefillConsumed = useCallback(() => {
    setAskNacPrefill("");
  }, []);

  const showExecutiveExport = rbac.hasPermission(PERMISSIONS.VIEW_EXECUTIVE_EXPORT);

  return (
    <motion.div className="nac-intelligence-hub" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <div className="nac-platform-header-row">
          <div>
            <p className="nac-platform-kicker">NAC Intelligence</p>
            <h1>Intelligence</h1>
            <p className="nac-platform-sub">
              Ask NAC, executive command, restaurant operations, sales, menu, and competitive intelligence
            </p>
          </div>
          <div className="nac-platform-header-actions">
            <IntelligenceTrustStrip />
            {showExecutiveExport ? <ExecutiveExportButton /> : null}
          </div>
        </div>
      </header>

      <GlobalFilterBar variant="extended" />

      <IntelligenceDataStatus />

      <HubTabs tabs={visibleTabs} active={activeTab} onChange={handleTabChange} />

      <IntelligenceTabPanels
        activeTab={activeTab}
        salesSection={salesSection}
        restaurantSection={restaurantSection}
        askNacPrefill={askNacPrefill}
        askNacPrefillSeed={askNacPrefillSeed}
        onAskNacPrefillConsumed={handleAskNacPrefillConsumed}
        onAskNacFromSales={handleAskNacFromSales}
      />
    </motion.div>
  );
}

function IntelligenceHubMobile() {
  const [salesSection, setSalesSection] = useState("upload");
  const [restaurantSection, setRestaurantSection] = useState("overview");
  const [askNacPrefill, setAskNacPrefill] = useState("");
  const [askNacPrefillSeed, setAskNacPrefillSeed] = useState(0);

  const handleAskNacFromSales = useCallback((question) => {
    setAskNacPrefill(String(question || "").trim());
    setAskNacPrefillSeed((seed) => seed + 1);
  }, []);

  const handleAskNacPrefillConsumed = useCallback(() => {
    setAskNacPrefill("");
  }, []);

  return (
    <IntelligenceMobileShell
      askNacPrefill={askNacPrefill}
      askNacPrefillSeed={askNacPrefillSeed}
      onAskNacPrefillConsumed={handleAskNacPrefillConsumed}
      onAskNacFromSales={handleAskNacFromSales}
      salesSection={salesSection}
      setSalesSection={setSalesSection}
      restaurantSection={restaurantSection}
      setRestaurantSection={setRestaurantSection}
    />
  );
}

export default function IntelligenceHub() {
  const isMobile = useMobileIntelligenceLayout();

  return (
    <GooglePlacesProvider>
      <MenuBiDashboardProvider options={{ source: "IntelligenceHub" }}>
        {isMobile ? <IntelligenceHubMobile /> : <IntelligenceHubDesktop />}
      </MenuBiDashboardProvider>
    </GooglePlacesProvider>
  );
}
