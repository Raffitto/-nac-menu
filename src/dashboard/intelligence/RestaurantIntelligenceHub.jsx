import React, { Suspense, lazy, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import HubTabs from "../components/HubTabs";
import OperationsInsights from "./OperationsInsights";

const RestaurantIntelligence = lazy(() => import("../RestaurantIntelligence"));

const RESTAURANT_SECTIONS = [
  { id: "overview", label: "Dashboard" },
  { id: "operations", label: "Insights & signals" },
];

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
 * Restaurant Intelligence — unified operations + restaurant analytics.
 */
export default function RestaurantIntelligenceHub({ initialSection = "overview" }) {
  const [section, setSection] = useState(
    initialSection === "operations" ? "operations" : "overview",
  );

  useEffect(() => {
    setSection(initialSection === "operations" ? "operations" : "overview");
  }, [initialSection]);

  return (
    <div className="nac-restaurant-intelligence-hub">
      <header className="nac-intel-section-intro">
        <h2 className="nac-intel-section-intro__title">Restaurant Intelligence</h2>
        <p>
          Reviews, staff signals, menu behavior, and operational correlations — scoped to your global
          branch and time filters above.
        </p>
      </header>

      <HubTabs tabs={RESTAURANT_SECTIONS} active={section} onChange={setSection} />

      {section === "overview" && (
        <Suspense fallback={<ViewFallback label="Loading restaurant intelligence…" />}>
          <RestaurantIntelligence embeddedInHub />
        </Suspense>
      )}
      {section === "operations" && <OperationsInsights embeddedInHub />}
    </div>
  );
}
