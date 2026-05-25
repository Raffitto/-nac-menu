import React from "react";
import PredictiveIntelligencePanel from "../components/PredictiveIntelligencePanel";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";

/** Intelligence hub — Predictive tab */
export default function PredictiveAnalytics() {
  const { operationalTrust } = useMenuBiDashboardContext();
  return (
    <>
      <OperationalTrustBadge trust={operationalTrust} />
      <PredictiveIntelligencePanel showBranchScores />
    </>
  );
}
