import React, { useMemo, useState, Suspense, lazy, useCallback } from "react";
import { GooglePlacesProvider } from "../context/GooglePlacesContext";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import ExecutiveExportButton from "../components/ExecutiveExportButton";
import IntelligenceDataStatus from "../components/IntelligenceDataStatus";
import { INTELLIGENCE_TABS, normalizeIntelligenceTabId } from "../navigation";
import { MenuBiDashboardProvider, useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useRbac } from "../context/RbacContext";
import { PERMISSIONS } from "../config/rbac";
import MenuIntelligence from "../intelligence/MenuIntelligence";
import CompetitiveReputationWatch from "../intelligence/CompetitiveReputationWatch";
import AskNacTab from "../intelligence/AskNacTab";
import SalesIntelligenceHub from "../intelligence/SalesIntelligenceHub";
import RestaurantIntelligenceHub from "../intelligence/RestaurantIntelligenceHub";
import "../styles/platform-os.css";
import "../styles/review-intelligence.css";
import "../styles/intelligence-polish.css";

const ExecutiveCommandCenter = lazy(() => import("../intelligence/ExecutiveCommandCenter"));
const VisualIntelligenceEngine = lazy(() => import("../intelligence/VisualIntelligenceEngine"));

function IntelligenceTrustStrip() {
  const { operationalTrust } = useMenuBiDashboardContext();
  return <OperationalTrustBadge trust={operationalTrust} />;
}

function ViewFallback({ label }) {
  return (
    <div className="nac-bi-loading" style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <RefreshCw size={20} className="nac-bi-spin" />
      <span style={{ marginLeft: 8 }}>{label}</span>
    </div>
  );
}

function applyLegacyTabHints(rawTab, setSalesSection, setRestaurantSection) {
  const raw = String(rawTab || "").toLowerCase();
  if (raw === "imports" || raw === "foodics") setSalesSection("upload");
  if (raw === "operations") setRestaurantSection("operations");
}

export default function IntelligenceHub() {
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
    <GooglePlacesProvider>
    <MenuBiDashboardProvider options={{ source: "IntelligenceHub" }}>
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

      {activeTab === "ask" && (
        <div className="nac-intelligence-panel">
          <AskNacTab
            initialQuestion={askNacPrefill}
            prefillSeed={askNacPrefillSeed}
            onInitialQuestionConsumed={handleAskNacPrefillConsumed}
          />
        </div>
      )}
      {activeTab === "visual" && (
        <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading visual intelligence…" />}>
          <VisualIntelligenceEngine />
        </Suspense>
        </div>
      )}
      {activeTab === "restaurant" && (
        <div className="nac-intelligence-panel">
        <RestaurantIntelligenceHub initialSection={restaurantSection} />
        </div>
      )}
      {activeTab === "sales" && (
        <div className="nac-intelligence-panel">
        <SalesIntelligenceHub initialSection={salesSection} onAskNac={handleAskNacFromSales} />
        </div>
      )}
      {activeTab === "menu" && (
        <div className="nac-intelligence-panel">
          <MenuIntelligence />
        </div>
      )}
      {activeTab === "executive" && (
        <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading command center…" />}>
          <ExecutiveCommandCenter />
        </Suspense>
        </div>
      )}
      {activeTab === "competitive" && (
        <div className="nac-intelligence-panel">
          <CompetitiveReputationWatch />
        </div>
      )}
    </motion.div>
    </MenuBiDashboardProvider>
    </GooglePlacesProvider>
  );
}
