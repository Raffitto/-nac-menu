import React, { Suspense, lazy } from "react";
import { RefreshCw } from "lucide-react";
import MenuIntelligence from "./MenuIntelligence";
import CompetitiveReputationWatch from "./CompetitiveReputationWatch";
import AskNacTab from "./AskNacTab";
import SalesIntelligenceHub from "./SalesIntelligenceHub";
import RestaurantIntelligenceHub from "./RestaurantIntelligenceHub";

const ExecutiveCommandCenter = lazy(() => import("./ExecutiveCommandCenter"));
const VisualIntelligenceEngine = lazy(() => import("./VisualIntelligenceEngine"));

function ViewFallback({ label }) {
  return (
    <div
      className="nac-bi-loading"
      style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <RefreshCw size={20} className="nac-bi-spin" />
      <span style={{ marginLeft: 8 }}>{label}</span>
    </div>
  );
}

/** Shared Intelligence tab panels — reused by desktop hub and mobile dashboards tab. */
export default function IntelligenceTabPanels({
  activeTab,
  salesSection,
  restaurantSection,
  askNacPrefill,
  askNacPrefillSeed,
  onAskNacPrefillConsumed,
  onAskNacFromSales,
  askNacMobileFirst = false,
  onMobileNavigate,
}) {
  if (activeTab === "ask") {
    return (
      <div className="nac-intelligence-panel">
        <AskNacTab
          initialQuestion={askNacPrefill}
          prefillSeed={askNacPrefillSeed}
          onInitialQuestionConsumed={onAskNacPrefillConsumed}
          mobileFirst={askNacMobileFirst}
          showVaultPanel={!askNacMobileFirst}
          maxSuggestions={askNacMobileFirst ? 3 : 8}
          onMobileNavigate={onMobileNavigate}
        />
      </div>
    );
  }

  if (activeTab === "visual") {
    return (
      <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading visual intelligence…" />}>
          <VisualIntelligenceEngine />
        </Suspense>
      </div>
    );
  }

  if (activeTab === "restaurant") {
    return (
      <div className="nac-intelligence-panel">
        <RestaurantIntelligenceHub initialSection={restaurantSection} />
      </div>
    );
  }

  if (activeTab === "sales") {
    return (
      <div className="nac-intelligence-panel">
        <SalesIntelligenceHub initialSection={salesSection} onAskNac={onAskNacFromSales} />
      </div>
    );
  }

  if (activeTab === "menu") {
    return (
      <div className="nac-intelligence-panel">
        <MenuIntelligence />
      </div>
    );
  }

  if (activeTab === "executive") {
    return (
      <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading command center…" />}>
          <ExecutiveCommandCenter />
        </Suspense>
      </div>
    );
  }

  if (activeTab === "competitive") {
    return (
      <div className="nac-intelligence-panel">
        <CompetitiveReputationWatch />
      </div>
    );
  }

  return null;
}
