import React, { useState, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import { INTELLIGENCE_TABS } from "../navigation";
import MenuIntelligence from "../intelligence/MenuIntelligence";
import PredictiveAnalytics from "../intelligence/PredictiveAnalytics";
import OperationsInsights from "../intelligence/OperationsInsights";
import CompetitiveReputationWatch from "../intelligence/CompetitiveReputationWatch";
import "../styles/platform-os.css";

const AIInsights = lazy(() => import("../AIInsights"));
const RestaurantIntelligence = lazy(() => import("../RestaurantIntelligence"));
const FoodicsIntelligence = lazy(() => import("../FoodicsIntelligence"));
const SalesImportsIntelligence = lazy(() => import("../intelligence/SalesImportsIntelligence"));
const VisualIntelligenceEngine = lazy(() => import("../intelligence/VisualIntelligenceEngine"));

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

  return (
    <motion.div className="nac-intelligence-hub" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <p className="nac-platform-kicker">NAC Intelligence</p>
        <h1>Intelligence</h1>
        <p className="nac-platform-sub">Operational brain — insights, menu, sales, and forecasts</p>
      </header>

      <GlobalFilterBar variant="extended" />

      <HubTabs tabs={INTELLIGENCE_TABS} active={tab} onChange={setTab} />

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
      {tab === "predictive" && <PredictiveAnalytics />}
      {tab === "operations" && <OperationsInsights />}
      {tab === "competitive" && <CompetitiveReputationWatch />}
    </motion.div>
  );
}
