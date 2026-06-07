import React from "react";
import GlobalFilterBar from "../../components/GlobalFilterBar";
import ExecutiveExportButton from "../../components/ExecutiveExportButton";
import IntelligenceDataStatus from "../../components/IntelligenceDataStatus";
import { useMenuBiDashboardContext } from "../../context/MenuBiDashboardContext";
import OperationalTrustBadge from "../../components/OperationalTrustBadge";

function IntelligenceTrustStrip() {
  const { operationalTrust } = useMenuBiDashboardContext();
  return <OperationalTrustBadge trust={operationalTrust} />;
}

export default function IntelligenceMobileSettingsTab({ showExecutiveExport = false }) {
  return (
    <div className="nac-intelligence-mobile-settings">
      <header className="nac-intelligence-mobile-section-header">
        <p className="nac-intelligence-mobile-kicker">Controls</p>
        <h2>Settings</h2>
        <p className="nac-intelligence-mobile-sub">
          Branch, time range, shift, and export controls for Intelligence dashboards and Ask NAC.
        </p>
      </header>

      <div className="nac-intelligence-mobile-settings__actions">
        <IntelligenceTrustStrip />
        {showExecutiveExport ? <ExecutiveExportButton /> : null}
      </div>

      <GlobalFilterBar variant="extended" />
      <IntelligenceDataStatus />
    </div>
  );
}
