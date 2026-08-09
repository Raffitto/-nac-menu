import React, { useMemo } from "react";
import HubTabs from "../../components/HubTabs";
import IntelligenceTabPanels from "../IntelligenceTabPanels";
import {
  INTELLIGENCE_TABS,
  getIntelligenceSecondaryTabs,
} from "../../navigation";

export default function IntelligenceDashboardsTab({
  activeDashboardTab,
  onDashboardTabChange,
  visibleDashboardTabs,
  secondaryTab,
  onSecondaryTabChange,
  visibleSecondaryTabs,
  salesSection,
  onAskNacFromSales,
}) {
  const tabs = useMemo(
    () => INTELLIGENCE_TABS.filter((tab) => tab.id !== "ask" && visibleDashboardTabs.includes(tab.id)),
    [visibleDashboardTabs],
  );

  const secondaryTabs = useMemo(() => {
    const all = getIntelligenceSecondaryTabs(activeDashboardTab);
    if (!visibleSecondaryTabs?.length) return all;
    return all.filter((tab) => visibleSecondaryTabs.includes(tab.id));
  }, [activeDashboardTab, visibleSecondaryTabs]);

  if (!tabs.length) {
    return (
      <div className="nac-intelligence-mobile-empty">
        <p>No dashboard sections are available for your role.</p>
      </div>
    );
  }

  return (
    <div className="nac-intelligence-mobile-dashboards">
      <header className="nac-intelligence-mobile-section-header">
        <p className="nac-intelligence-mobile-kicker">Dashboards</p>
        <h2>Intelligence</h2>
        <p className="nac-intelligence-mobile-sub">
          Operations, commercial performance, and market intelligence.
        </p>
      </header>

      <HubTabs
        tabs={tabs}
        active={activeDashboardTab}
        onChange={onDashboardTabChange}
        className="nac-intelligence-mobile-dashboard-tabs nac-hub-tabs--primary"
      />

      {secondaryTabs.length ? (
        <HubTabs
          tabs={secondaryTabs}
          active={secondaryTab}
          onChange={onSecondaryTabChange}
          className="nac-intelligence-mobile-dashboard-tabs nac-hub-tabs--secondary"
        />
      ) : null}

      <IntelligenceTabPanels
        activeTab={activeDashboardTab}
        secondaryTab={secondaryTab}
        salesSection={salesSection}
        onAskNacFromSales={onAskNacFromSales}
      />
    </div>
  );
}
