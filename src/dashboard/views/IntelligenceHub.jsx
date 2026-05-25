import React, { useMemo, useState, Suspense, lazy } from "react";
import { GooglePlacesProvider } from "../context/GooglePlacesContext";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import ExecutiveExportButton from "../components/ExecutiveExportButton";
import { INTELLIGENCE_TABS } from "../navigation";
import { MenuBiDashboardProvider, useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useRbac } from "../context/RbacContext";
import { PERMISSIONS } from "../config/rbac";
import MenuIntelligence from "../intelligence/MenuIntelligence";
import PredictiveAnalytics from "../intelligence/PredictiveAnalytics";
import OperationsInsights from "../intelligence/OperationsInsights";
import CompetitiveReputationWatch from "../intelligence/CompetitiveReputationWatch";
import "../styles/platform-os.css";
import "../styles/review-intelligence.css";

const AIInsights = lazy(() => import("../AIInsights"));
const ExecutiveCommandCenter = lazy(() => import("../intelligence/ExecutiveCommandCenter"));
const RestaurantIntelligence = lazy(() => import("../RestaurantIntelligence"));
const FoodicsIntelligence = lazy(() => import("../FoodicsIntelligence"));
const SalesImportsIntelligence = lazy(() => import("../intelligence/SalesImportsIntelligence"));
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

export default function IntelligenceHub() {
  const [tab, setTab] = useState("ai");
  const rbac = useRbac();
  const visibleTabs = useMemo(
    () => INTELLIGENCE_TABS.filter((t) => rbac.canAccessIntelligenceTab(t.id)),
    [rbac],
  );

  React.useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.some((t) => t.id === tab)) {
      setTab(visibleTabs[0].id);
    }
  }, [tab, visibleTabs]);

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
            <p className="nac-platform-sub">Operational brain — insights, menu, sales, and forecasts</p>
          </div>
          <div className="nac-platform-header-actions">
            <IntelligenceTrustStrip />
            {showExecutiveExport ? <ExecutiveExportButton /> : null}
          </div>
        </div>
      </header>

      <GlobalFilterBar variant="extended" />

      <HubTabs tabs={visibleTabs} active={tab} onChange={setTab} />

      {tab === "ai" && (
        <Suspense fallback={<ViewFallback label="Loading AI insights…" />}>
          <AIInsights />
        </Suspense>
      )}
      {tab === "visual" && (
        <Suspense fallback={<ViewFallback label="Loading visual intelligence…" />}>
          <VisualIntelligenceEngine />
        </Suspense>
      )}
      {tab === "restaurant" && (
        <Suspense fallback={<ViewFallback label="Loading restaurant intelligence…" />}>
          <RestaurantIntelligence />
        </Suspense>
      )}
      {tab === "imports" && (
        <Suspense fallback={<ViewFallback label="Loading sales imports…" />}>
          <SalesImportsIntelligence />
        </Suspense>
      )}
      {tab === "sales" && (
        <Suspense fallback={<ViewFallback label="Loading sales intelligence…" />}>
          <FoodicsIntelligence />
        </Suspense>
      )}
      {tab === "menu" && <MenuIntelligence />}
      {tab === "executive" && (
        <Suspense fallback={<ViewFallback label="Loading command center…" />}>
          <ExecutiveCommandCenter />
        </Suspense>
      )}
      {tab === "predictive" && <PredictiveAnalytics />}
      {tab === "operations" && <OperationsInsights />}
      {tab === "competitive" && <CompetitiveReputationWatch />}
    </motion.div>
    </MenuBiDashboardProvider>
    </GooglePlacesProvider>
  );
}
