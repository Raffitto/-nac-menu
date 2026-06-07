import React, { useMemo } from "react";
import HubTabs from "../../components/HubTabs";
import IntelligenceTabPanels from "../IntelligenceTabPanels";
import { INTELLIGENCE_TABS } from "../../navigation";

export default function IntelligenceDashboardsTab({
  activeDashboardTab,
  onDashboardTabChange,
  visibleDashboardTabs,
  salesSection,
  restaurantSection,
  onAskNacFromSales,
}) {
  const tabs = useMemo(
    () => INTELLIGENCE_TABS.filter((tab) => tab.id !== "ask" && visibleDashboardTabs.includes(tab.id)),
    [visibleDashboardTabs],
  );

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
          Command center, restaurant, sales, menu, visual OS, and competitive watch.
        </p>
      </header>

      <HubTabs
        tabs={tabs}
        active={activeDashboardTab}
        onChange={onDashboardTabChange}
        className="nac-intelligence-mobile-dashboard-tabs"
      />

      <IntelligenceTabPanels
        activeTab={activeDashboardTab}
        salesSection={salesSection}
        restaurantSection={restaurantSection}
        onAskNacFromSales={onAskNacFromSales}
      />
    </div>
  );
}
