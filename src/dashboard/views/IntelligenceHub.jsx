import React, { useMemo, useState, useCallback, useEffect } from "react";
import { GooglePlacesProvider } from "../context/GooglePlacesContext";
import { motion } from "framer-motion";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import ExecutiveExportButton from "../components/ExecutiveExportButton";
import IntelligenceDataStatus from "../components/IntelligenceDataStatus";
import {
  INTELLIGENCE_NAV_COMMANDS,
  INTELLIGENCE_TABS,
  getIntelligenceSecondaryTabs,
  isLegacyIntelligenceTabId,
  normalizeIntelligenceTabId,
  resolveIntelligenceDestination,
} from "../navigation";
import { MenuBiDashboardProvider, useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import { useRbac } from "../context/RbacContext";
import { PERMISSIONS } from "../config/rbac";
import IntelligenceTabPanels from "../intelligence/IntelligenceTabPanels";
import IntelligenceCommandPalette from "../intelligence/IntelligenceCommandPalette";
import IntelligenceMobileShell from "../intelligence/mobile/IntelligenceMobileShell";
import { useMobileIntelligenceLayout } from "../hooks/useMobileIntelligenceLayout";
import "../styles/platform-os.css";
import "../styles/review-intelligence.css";
import "../styles/intelligence-polish.css";

function IntelligenceTrustStrip() {
  const { operationalTrust } = useMenuBiDashboardContext();
  return <OperationalTrustBadge trust={operationalTrust} />;
}

function applySalesSectionHint(rawTab, setSalesSection) {
  const raw = String(rawTab || "").toLowerCase();
  if (raw === "imports" || raw === "foodics") setSalesSection("upload");
}

function IntelligenceHubDesktop() {
  const [tab, setTab] = useState("ask");
  const [secondaryByPrimary, setSecondaryByPrimary] = useState({
    operations: "overview",
    commercial: "sales",
    market: "visual",
  });
  const [salesSection, setSalesSection] = useState("upload");
  const [askNacPrefill, setAskNacPrefill] = useState("");
  const [askNacPrefillSeed, setAskNacPrefillSeed] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rbac = useRbac();

  const visibleTabs = useMemo(
    () => INTELLIGENCE_TABS.filter((t) => rbac.canAccessIntelligenceTab(t.id)),
    [rbac],
  );

  const activeTab = normalizeIntelligenceTabId(tab);
  const secondaryTabs = useMemo(() => {
    const tabs = getIntelligenceSecondaryTabs(activeTab);
    return tabs.filter((t) =>
      rbac.canAccessIntelligenceSecondary
        ? rbac.canAccessIntelligenceSecondary(activeTab, t.id)
        : true,
    );
  }, [activeTab, rbac]);

  const activeSecondary =
    secondaryTabs.find((t) => t.id === secondaryByPrimary[activeTab])?.id ||
    secondaryTabs[0]?.id ||
    null;

  useEffect(() => {
    if (!visibleTabs.length) return;
    applySalesSectionHint(tab, setSalesSection);
    const dest = resolveIntelligenceDestination(tab);
    if (!visibleTabs.some((t) => t.id === dest.primary)) {
      setTab(visibleTabs[0].id);
      return;
    }
    if (dest.primary !== tab) {
      setTab(dest.primary);
    }
    // Legacy deep links set secondary once; primary clicks preserve last secondary.
    if (isLegacyIntelligenceTabId(tab) && dest.secondary) {
      setSecondaryByPrimary((prev) => ({
        ...prev,
        [dest.primary]: dest.secondary,
      }));
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    if (!secondaryTabs.length || !activeSecondary) return;
    if (!secondaryTabs.some((t) => t.id === activeSecondary)) {
      setSecondaryByPrimary((prev) => ({
        ...prev,
        [activeTab]: secondaryTabs[0].id,
      }));
    }
  }, [activeTab, activeSecondary, secondaryTabs]);

  const navigateTo = useCallback((primary, secondary = null) => {
    const nextPrimary = normalizeIntelligenceTabId(primary);
    setTab(nextPrimary);
    if (secondary) {
      setSecondaryByPrimary((prev) => ({ ...prev, [nextPrimary]: secondary }));
    }
  }, []);

  const handleTabChange = (nextTab) => {
    const raw = String(nextTab || "").toLowerCase();
    applySalesSectionHint(raw, setSalesSection);
    if (INTELLIGENCE_TABS.some((t) => t.id === raw)) {
      setTab(raw);
      return;
    }
    const dest = resolveIntelligenceDestination(nextTab);
    navigateTo(dest.primary, dest.secondary);
  };

  const handleSecondaryChange = (nextSecondary) => {
    setSecondaryByPrimary((prev) => ({ ...prev, [activeTab]: nextSecondary }));
  };

  const handleAskNacFromSales = useCallback((question) => {
    setAskNacPrefill(String(question || "").trim());
    setAskNacPrefillSeed((seed) => seed + 1);
    setTab("ask");
  }, []);

  const handleAskNacPrefillConsumed = useCallback(() => {
    setAskNacPrefill("");
  }, []);

  const paletteCommands = useMemo(
    () =>
      INTELLIGENCE_NAV_COMMANDS.filter((cmd) => {
        if (!rbac.canAccessIntelligenceTab(cmd.primary)) return false;
        if (
          cmd.secondary &&
          rbac.canAccessIntelligenceSecondary &&
          !rbac.canAccessIntelligenceSecondary(cmd.primary, cmd.secondary)
        ) {
          return false;
        }
        return true;
      }),
    [rbac],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = event.key?.toLowerCase?.();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (key === "escape" && paletteOpen) {
        event.preventDefault();
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen]);

  const showExecutiveExport = rbac.hasPermission(PERMISSIONS.VIEW_EXECUTIVE_EXPORT);

  return (
    <motion.div className="nac-intelligence-hub" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <div className="nac-platform-header-row">
          <div>
            <p className="nac-platform-kicker">NAC Intelligence</p>
            <h1>Intelligence</h1>
            <p className="nac-platform-sub">
              Ask NAC, operations, commercial performance, and market intelligence
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

      <HubTabs
        tabs={visibleTabs}
        active={activeTab}
        onChange={handleTabChange}
        className="nac-hub-tabs--primary"
      />

      {secondaryTabs.length ? (
        <HubTabs
          tabs={secondaryTabs}
          active={activeSecondary}
          onChange={handleSecondaryChange}
          className="nac-hub-tabs--secondary"
        />
      ) : null}

      <IntelligenceTabPanels
        activeTab={activeTab}
        secondaryTab={activeSecondary}
        salesSection={salesSection}
        askNacPrefill={askNacPrefill}
        askNacPrefillSeed={askNacPrefillSeed}
        onAskNacPrefillConsumed={handleAskNacPrefillConsumed}
        onAskNacFromSales={handleAskNacFromSales}
      />

      <IntelligenceCommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onSelect={(cmd) => navigateTo(cmd.primary, cmd.secondary)}
      />
    </motion.div>
  );
}

function IntelligenceHubMobile() {
  const [salesSection, setSalesSection] = useState("upload");
  const [askNacPrefill, setAskNacPrefill] = useState("");
  const [askNacPrefillSeed, setAskNacPrefillSeed] = useState(0);

  const handleAskNacFromSales = useCallback((question) => {
    setAskNacPrefill(String(question || "").trim());
    setAskNacPrefillSeed((seed) => seed + 1);
  }, []);

  const handleAskNacPrefillConsumed = useCallback(() => {
    setAskNacPrefill("");
  }, []);

  return (
    <IntelligenceMobileShell
      askNacPrefill={askNacPrefill}
      askNacPrefillSeed={askNacPrefillSeed}
      onAskNacPrefillConsumed={handleAskNacPrefillConsumed}
      onAskNacFromSales={handleAskNacFromSales}
      salesSection={salesSection}
      setSalesSection={setSalesSection}
    />
  );
}

export default function IntelligenceHub() {
  const isMobile = useMobileIntelligenceLayout();

  return (
    <GooglePlacesProvider>
      <MenuBiDashboardProvider options={{ source: "IntelligenceHub" }}>
        {isMobile ? <IntelligenceHubMobile /> : <IntelligenceHubDesktop />}
      </MenuBiDashboardProvider>
    </GooglePlacesProvider>
  );
}
