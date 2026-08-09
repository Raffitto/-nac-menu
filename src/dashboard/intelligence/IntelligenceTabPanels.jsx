import React, { Suspense, lazy } from "react";
import { RefreshCw } from "lucide-react";
import MenuIntelligence from "./MenuIntelligence";
import CompetitiveReputationWatch from "./CompetitiveReputationWatch";
import AskNacTab from "./AskNacTab";
import SalesIntelligenceHub from "./SalesIntelligenceHub";
import OperationsInsights from "./OperationsInsights";

const ExecutiveCommandCenter = lazy(() => import("./ExecutiveCommandCenter"));
const VisualIntelligenceEngine = lazy(() => import("./VisualIntelligenceEngine"));
const RestaurantIntelligence = lazy(() => import("../RestaurantIntelligence"));

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

/**
 * Shared Intelligence panels — primary/secondary taxonomy.
 * Legacy activeTab ids still resolve via resolveIntelligenceDestination upstream.
 */
export default function IntelligenceTabPanels({
  activeTab,
  secondaryTab = null,
  salesSection,
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

  if (activeTab === "operations") {
    if (secondaryTab === "staff") {
      return (
        <div className="nac-intelligence-panel">
          <header className="nac-intel-section-intro">
            <h2 className="nac-intel-section-intro__title">Staff & Reviews</h2>
            <p>
              Reviews, staff signals, menu behavior, and restaurant health — scoped to your global
              branch and time filters above.
            </p>
          </header>
          <Suspense fallback={<ViewFallback label="Loading restaurant intelligence…" />}>
            <RestaurantIntelligence embeddedInHub />
          </Suspense>
        </div>
      );
    }
    if (secondaryTab === "diagnostics") {
      return (
        <div className="nac-intelligence-panel">
          <header className="nac-intel-section-intro">
            <h2 className="nac-intel-section-intro__title">Diagnostics</h2>
            <p>Operational correlations, insights, and diagnostic signals for the selected period.</p>
          </header>
          <OperationsInsights embeddedInHub />
        </div>
      );
    }
    return (
      <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading operations overview…" />}>
          <ExecutiveCommandCenter />
        </Suspense>
      </div>
    );
  }

  if (activeTab === "commercial") {
    if (secondaryTab === "menu") {
      return (
        <div className="nac-intelligence-panel">
          <MenuIntelligence />
        </div>
      );
    }
    return (
      <div className="nac-intelligence-panel">
        <SalesIntelligenceHub initialSection={salesSection} onAskNac={onAskNacFromSales} />
      </div>
    );
  }

  if (activeTab === "market") {
    if (secondaryTab === "competitors") {
      return (
        <div className="nac-intelligence-panel">
          <CompetitiveReputationWatch />
        </div>
      );
    }
    return (
      <div className="nac-intelligence-panel">
        <Suspense fallback={<ViewFallback label="Loading visual intelligence…" />}>
          <VisualIntelligenceEngine />
        </Suspense>
      </div>
    );
  }

  return null;
}
