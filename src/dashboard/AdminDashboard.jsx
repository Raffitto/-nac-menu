import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Store,
  Star,
  Settings,
  RefreshCw,
  Brain,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
} from "lucide-react";
import useCollapsibleSidebar from "./hooks/useCollapsibleSidebar";
import useKeepAliveNav from "./hooks/useKeepAliveNav";
import { SIDEBAR_EVENTS, SIDEBAR_KEYS } from "../lib/sidebarPrefs";
import { isEditableTarget, isModKey } from "../lib/menuInteraction/platform";
import { isSupabaseConfigured } from "../lib/supabase";
import { isAdminPlatformMode } from "../lib/platformMode";
import { useMenuBiDashboard } from "./hooks/useMenuBiDashboard";
import { useOperationalDashboard } from "./hooks/useOperationalDashboard";
import { PlatformFiltersProvider, usePlatformFilters } from "./context/PlatformFiltersContext";
import { RbacProvider, RbacBranchConstraint, useRbac } from "./context/RbacContext";
import AccessDeniedPanel from "./components/AccessDeniedPanel";
import GlobalFilterBar from "./components/GlobalFilterBar";
import AdminBootShell from "./components/AdminBootShell";
import { NAV_ITEMS, isScrollableView, OVERVIEW_TABS, adminViewFromLocation, syncAdminViewLocation } from "./navigation";
import { isUnifiedOverviewEnabled } from "./config/unifiedOverview";
import { useMobileIntelligenceLayout } from "./hooks/useMobileIntelligenceLayout";
import HubTabs from "./components/HubTabs";
import MenuEditorAuth from "./components/MenuEditorAuth";
import NacAnalyticsSignIn from "./components/NacAnalyticsSignIn";
import NacPlatformAccessGate from "./components/NacPlatformAccessGate";
import { usePlatformSession } from "./hooks/usePlatformSession";
import { formatSupabaseSetupMessage, validateRbacUsersEnv } from "../lib/platformAuth";
import { CATEGORY_NAMES, formatDuration, exportCSV } from "./utils/formatters";
import { rangeToHours } from "./utils/rangeState";
import {
  buildHourlyChartData,
  buildHourlyDebugPayload,
  publishHourlyPipelineDebug,
} from "./utils/hourlyPipeline";
import { generateInsights } from "./utils/insights";
import { filterCustomerFacingCategories } from "../lib/customerFacingAnalytics";
import { filterDisplayInsights } from "../lib/operationalMetricsIntegrity";
import { generateOperationalDashboardInsights } from "./utils/operationalInsightsIntegrity";
import { markBoot } from "../lib/bootTelemetry";
import "./styles/admin-dashboard.css";
import "./styles/platform-os.css";
import "./styles/settings-view.css";

const AnalyticsDashboard = lazy(() => import("./AnalyticsDashboard"));
const IntelligenceHub = lazy(() => import("./views/IntelligenceHub"));
const ReviewsHub = lazy(() => import("./views/ReviewsHub"));
const BranchesView = lazy(() => import("./views/BranchesView"));
const SettingsView = lazy(() => import("./views/SettingsView"));
const MenuManager = lazy(() => import("./MenuManager"));
const FoodBibleOsView = lazy(() => import("./views/FoodBibleOsView"));
const OperationalDashboard = lazy(() => import("./views/OperationalDashboard"));
const LegacyOverviewPanel = lazy(() => import("./views/LegacyOverviewPanel"));

const VIEW_PREFETCHERS = {
  intelligence: () => import("./views/IntelligenceHub"),
  reviews: () => import("./views/ReviewsHub"),
  menu: () => import("./MenuManager"),
  "food-bible": () => import("./views/FoodBibleOsView"),
  branches: () => import("./views/BranchesView"),
  settings: () => import("./views/SettingsView"),
};

const NAV_ICONS = {
  overview: LayoutDashboard,
  intelligence: Brain,
  reviews: Star,
  menu: UtensilsCrossed,
  "food-bible": BookOpen,
  branches: Store,
  settings: Settings,
};

function ViewFallback({ label }) {
  return (
    <motion.div
      className="nac-bi-loading"
      style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <RefreshCw size={20} className="nac-bi-spin" />
      <span style={{ marginLeft: 8 }}>{label}</span>
    </motion.div>
  );
}

function ev(byType, key) {
  return Number(byType?.[key]) || 0;
}

export default function AdminDashboard(props) {
  const { session, checked: authChecked, issue: authIssue } = usePlatformSession();
  const rbacEnv = useMemo(() => validateRbacUsersEnv(), []);

  useEffect(() => {
    markBoot("admin_dashboard_mount");
  }, []);

  if (isAdminPlatformMode()) {
    if (!authChecked) {
      return <AdminBootShell message="Restoring your session…" />;
    }
    if (!isSupabaseConfigured()) {
      return (
        <NacAnalyticsSignIn
          kicker="NAC Hospitality OS"
          title="NAC Hospitality OS"
          subtitle={formatSupabaseSetupMessage()}
        />
      );
    }
    if (!session) {
      return (
        <NacAnalyticsSignIn
          kicker="NAC Hospitality OS"
          title="Sign in"
          subtitle="Sign in with your NAC staff account"
          sessionIssue={authIssue}
        />
      );
    }
  }

  return (
    <PlatformFiltersProvider>
      <RbacProvider session={session}>
        <AdminDashboardContent
          {...props}
          session={session}
          authChecked={authChecked}
          rbacEnvInvalid={!rbacEnv.ok}
        />
      </RbacProvider>
    </PlatformFiltersProvider>
  );
}

function AdminDashboardContent({ onBack, session = null, authChecked = true, rbacEnvInvalid = false }) {
  const {
    activeView: adminView,
    setActiveView: setAdminView,
    isMounted,
    schedulePrefetch,
    cancelPrefetch,
  } = useKeepAliveNav(adminViewFromLocation());
  const {
    collapsed: globalSidebarCollapsed,
    toggle: toggleGlobalSidebar,
  } = useCollapsibleSidebar(SIDEBAR_KEYS.global, {
    toggleEvent: SIDEBAR_EVENTS.globalToggle,
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      if (isModKey(event) && event.key.toLowerCase() === "b" && !event.shiftKey) {
        event.preventDefault();
        toggleGlobalSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleGlobalSidebar]);

  const unifiedOverview = isUnifiedOverviewEnabled();
  const [overviewTab, setOverviewTab] = useState("operations");
  const rbac = useRbac();

  const filters = usePlatformFilters();
  const liveMode = filters.liveMode;
  const overviewActive = adminView === "overview";
  const overviewMounted = isMounted("overview");

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter((item) => rbac.canAccessNav(item.id)),
    [rbac],
  );

  useEffect(() => {
    if (!visibleNav.length) return;
    if (!rbac.canAccessNav(adminView)) {
      setAdminView(visibleNav[0].id);
    }
  }, [adminView, rbac, visibleNav, setAdminView]);

  useEffect(() => {
    syncAdminViewLocation(adminView);
  }, [adminView]);

  const configured = isSupabaseConfigured();

  const menuBi = useMenuBiDashboard({
    enabled: Boolean(session) && overviewMounted && !unifiedOverview,
    refreshIntervalMs: liveMode && session && overviewActive ? 30000 : 0,
    source: "AdminDashboard",
  });

  const operationalBi = useOperationalDashboard({
    enabled: Boolean(session) && overviewMounted && unifiedOverview,
    refreshIntervalMs: liveMode && session && overviewActive ? 30000 : 0,
    source: "AdminDashboard",
  });

  const dashboardLoader = unifiedOverview ? operationalBi : menuBi;
  const {
    data,
    loading,
    error,
    platformStatus,
    operationalTrust,
    reload: loadDashboard,
  } = dashboardLoader;

  useEffect(() => {
    if (data) markBoot("overview_tier1_ready");
  }, [data]);

  // Prefetch AFTER Overview Tier-1 — never compete with cold-boot RPCs / parse.
  // Heavy hubs (Menu / Intelligence) are last; Settings/Reviews are cheaper.
  useEffect(() => {
    if (!overviewActive || loading) return undefined;
    if (!data && session) return undefined;
    let cancelled = false;
    const timers = [];
    const schedule = (id, delay) => {
      const fn = VIEW_PREFETCHERS[id];
      if (!fn) return;
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          schedulePrefetch(id, fn, 0);
        }, delay),
      );
    };
    const start = () => {
      if (cancelled) return;
      const idle = (cb) =>
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(cb, { timeout: 4000 })
          : window.setTimeout(cb, 500);
      idle(() => {
        schedule("settings", 0);
        schedule("reviews", 2000);
        schedule("branches", 4000);
        schedule("intelligence", 8000);
        schedule("menu", 12000);
      });
    };
    timers.push(window.setTimeout(start, 2500));
    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [overviewActive, loading, data, session, schedulePrefetch]);

  // Derived metrics
  const totalEvents = Number(data?.total_events) || 0;
  const totalSessions = Number(data?.total_sessions) || 0;
  const byType = data?.by_event_type || {};
  const funnel = data?.funnel || {};
  const itemOpenCount = ev(byType, "item_open");
  const qrSessionStarts =
    Number(funnel.qr_scans) || totalSessions || ev(byType, "qr_session_start");
  const addOnClickCount = ev(byType, "add_on_click");
  // categoryOpenCount available for future use via ev(byType, "category_open")

  const byLanguage = data?.by_language || {};
  const arCount = Number(byLanguage.ar) || 0;
  const enCount = Number(byLanguage.en) || 0;
  const totalLangEvents = arCount + enCount;
  const arabicPct = totalLangEvents > 0 ? Math.round((arCount / totalLangEvents) * 100) : 0;
  const englishPct = totalLangEvents > 0 ? 100 - arabicPct : 0;

  const topItem = (data?.top_items || [])[0];
  const topCategory = (data?.top_categories || [])[0];
  const topAddonPairs = data?.top_addon_pairs || [];
  const topAddon = topAddonPairs[0];
  const topItems = useMemo(() => data?.top_items || [], [data]);
  const topCategories = useMemo(
    () => filterCustomerFacingCategories(data?.top_categories || []),
    [data?.top_categories],
  );
  const topSearches = data?.top_searches || [];

  const avgTimeSpent = Number(data?.avg_time_spent) || 0;
  const bounceSessions = Number(data?.bounce_sessions) || 0;
  const deepSessions = Number(data?.deep_sessions) || 0;
  const bouncePct = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const deepPct = totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0;
  const addOnRate = itemOpenCount > 0 ? ((addOnClickCount / itemOpenCount) * 100).toFixed(1) : "0";
  const returningSessions = Number(data?.returning_sessions) || 0;
  const returningPct = qrSessionStarts > 0 ? Math.round((returningSessions / qrSessionStarts) * 100) : 0;

  const hourlyHours = filters?.timeRangeHours ?? rangeToHours(filters?.selectedRange || "today");
  const hourlyChart = useMemo(
    () => buildHourlyChartData(data?.by_hour || [], hourlyHours),
    [data?.by_hour, hourlyHours],
  );
  const hourlyGranularity = hourlyChart.granularity;
  const hourlyData = hourlyChart.rows;

  useEffect(() => {
    if (!data?.by_hour) return;
    publishHourlyPipelineDebug(
      buildHourlyDebugPayload({
        hours: hourlyHours,
        selectedRange: filters?.selectedRange,
        branch: filters?.branch,
        source: "AdminDashboard",
        byHourRaw: data.by_hour,
        byHourNormalized: data.by_hour,
        chartRows: hourlyData,
      }),
    );
  }, [data?.by_hour, hourlyData, hourlyHours, filters?.selectedRange, filters?.branch]);

  // Session quality, dead zones, lost searches, executive data
  const sessionQuality = data?.session_quality || {};
  const sessionDiagnostics = data?.session_diagnostics || null;
  const deadZones = data?.dead_zones || [];
  const lostSearches = data?.lost_searches || [];
  const langBehavior = data?.lang_behavior || {};
  const strongestHour = data?.strongest_hour;
  // topConvertingCat available via data?.top_converting_category

  const insights = useMemo(() => {
    if (!data) return [];
    if (unifiedOverview) return [];
    const fromOps = filterDisplayInsights(generateOperationalDashboardInsights(data));
    if (fromOps.length > 0) return fromOps;
    return generateInsights(data);
  }, [data, unifiedOverview]);

  const handleExport = useCallback(() => {
    if (!data) return;
    const headers = ["Metric", "Value"];
    const rows = [
      ["Total Events", totalEvents],
      ["Total Sessions", totalSessions],
      ["QR Sessions", qrSessionStarts],
      ["Bounce Rate", `${bouncePct}%`],
      ["Deep Engagement", `${deepPct}%`],
      ["Avg Time Spent", formatDuration(avgTimeSpent)],
      ["Add-on Conversion", `${addOnRate}%`],
      ["Arabic Usage", `${arabicPct}%`],
      ["Returning Sessions", `${returningPct}%`],
      ["Top Item", topItem?.name || "—"],
      ["Top Category", topCategory ? (CATEGORY_NAMES[topCategory.id] || topCategory.id) : "—"],
    ];
    (topItems || []).forEach((item, i) => {
      rows.push([`Top Item #${i + 1}`, `${item.name} (${item.opens})`]);
    });
    exportCSV("nac-dashboard-export.csv", headers, rows);
  }, [data, totalEvents, totalSessions, qrSessionStarts, bouncePct, deepPct, avgTimeSpent, addOnRate, arabicPct, returningPct, topItem, topCategory, topItems]);

  const needsAuth = configured && !session && !isAdminPlatformMode();

  const scrollable = isScrollableView(adminView);
  const isMobileIntelligence = useMobileIntelligenceLayout();
  const intelligenceFullscreen = isMobileIntelligence && adminView === "intelligence";
  const isMenuPage = adminView === "menu" || adminView === "menu-manager";

  if (isAdminPlatformMode() && session && rbac.profile?.unmapped) {
    return <NacPlatformAccessGate email={rbac.profile.email} />;
  }

  return (
    <motion.div
      className={`admin-shell ${intelligenceFullscreen ? "admin-shell--intelligence-fullscreen" : ""} ${globalSidebarCollapsed ? "admin-shell--nav-collapsed" : ""} ${isMenuPage ? "admin-shell--menu-page" : ""}`.trim()}
      style={scrollable && !intelligenceFullscreen ? { overflow: "auto", minHeight: "100vh" } : undefined}
    >
      <RbacBranchConstraint activeView={adminView} />
      <div className="admin-bg-glow" />

      {!intelligenceFullscreen ? (
      <aside
        className={`admin-sidebar ${globalSidebarCollapsed ? "is-collapsed" : ""}`}
        data-testid="global-app-sidebar"
        aria-label="Primary navigation"
        data-collapsed={globalSidebarCollapsed ? "true" : "false"}
      >
        <div>
          <div className="sidebar-header-row">
            <p className="sidebar-logo" title="NAC HOSPITALITY OS">
              {globalSidebarCollapsed ? "NAC" : "NAC HOSPITALITY OS"}
            </p>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleGlobalSidebar}
              aria-label={globalSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              aria-controls="nac-global-sidebar-menu"
              aria-expanded={!globalSidebarCollapsed}
              data-testid="global-sidebar-toggle"
              title={globalSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {globalSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <div className="sidebar-menu" id="nac-global-sidebar-menu">
            {visibleNav.map((item) => {
              const Icon = NAV_ICONS[item.id];
              const isActive = adminView === item.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${isActive ? "active" : ""}`}
                  whileHover={globalSidebarCollapsed ? undefined : { x: 6 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setAdminView(item.id)}
                  onMouseEnter={() => {
                    const prefetch = VIEW_PREFETCHERS[item.id];
                    if (prefetch) schedulePrefetch(item.id, prefetch);
                  }}
                  onFocus={() => {
                    const prefetch = VIEW_PREFETCHERS[item.id];
                    if (prefetch) schedulePrefetch(item.id, prefetch, 60);
                  }}
                  onMouseLeave={() => cancelPrefetch(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  data-nav-id={item.id}
                  data-testid={`nacos-nav-${item.id}`}
                >
                  {Icon && <Icon size={18} aria-hidden="true" />}
                  <span>{item.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>
        {!isAdminPlatformMode() && onBack && (
          <button type="button" className="admin-back" onClick={onBack} title="Back to Menu">
            {globalSidebarCollapsed ? "Back" : "Back to Menu"}
          </button>
        )}
      </aside>
      ) : null}

      {intelligenceFullscreen || !globalSidebarCollapsed ? null : (
        <button
          type="button"
          className="admin-sidebar-mobile-reveal"
          onClick={toggleGlobalSidebar}
          data-testid="global-sidebar-mobile-reveal"
          aria-label="Show navigation"
        >
          <PanelLeftOpen size={16} />
          Nav
        </button>
      )}

      <main
        className="admin-content"
        style={
          scrollable && !intelligenceFullscreen
            ? { flex: 1, minHeight: 0, overflowY: "auto", alignSelf: "stretch" }
            : undefined
        }
      >
        {isMounted("intelligence") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "intelligence"}
            data-testid="pane-intelligence"
          >
            <Suspense fallback={<ViewFallback label="Opening Intelligence…" />}>
              {rbac.canAccessNav("intelligence") ? (
                <IntelligenceHub />
              ) : (
                <AccessDeniedPanel message="Intelligence access is not enabled for your NAC OS role." />
              )}
            </Suspense>
          </div>
        ) : null}

        {isMounted("reviews") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "reviews"}
            data-testid="pane-reviews"
          >
            <Suspense fallback={<ViewFallback label="Opening Reviews…" />}>
              {rbac.canAccessNav("reviews") ? (
                <ReviewsHub />
              ) : (
                <AccessDeniedPanel message="Reviews access is not enabled for your NAC OS role." />
              )}
            </Suspense>
          </div>
        ) : null}

        {isMounted("menu") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "menu"}
            data-testid="pane-menu"
          >
            <Suspense fallback={<ViewFallback label="Opening Menu Manager…" />}>
              {rbac.canAccessNav("menu") ? (
                <MenuEditorAuth>
                  <MenuManager />
                </MenuEditorAuth>
              ) : (
                <AccessDeniedPanel message="Menu management is not enabled for your NAC OS role." />
              )}
            </Suspense>
          </div>
        ) : null}

        {isMounted("food-bible") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "food-bible"}
            data-testid="pane-food-bible"
          >
            <Suspense fallback={<ViewFallback label="Opening Food Bible…" />}>
              {rbac.canAccessNav("food-bible") ? (
                <FoodBibleOsView />
              ) : (
                <AccessDeniedPanel message="Food Bible access is not enabled for your NAC OS role." />
              )}
            </Suspense>
          </div>
        ) : null}

        {isMounted("branches") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "branches"}
            data-testid="pane-branches"
          >
            <Suspense fallback={<ViewFallback label="Opening Branches…" />}>
              {rbac.canAccessNav("branches") ? (
                <BranchesView />
              ) : (
                <AccessDeniedPanel message="Cross-branch network views are reserved for executive roles." />
              )}
            </Suspense>
          </div>
        ) : null}

        {isMounted("settings") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "settings"}
            data-testid="pane-settings"
          >
            <Suspense fallback={<ViewFallback label="Opening Settings…" />}>
              <SettingsView session={session} />
            </Suspense>
          </div>
        ) : null}

        {isMounted("overview") ? (
          <div
            className="admin-keepalive-pane"
            hidden={adminView !== "overview"}
            data-testid="pane-overview"
          >
          <>
            <header className="nac-platform-header">
              <p className="nac-platform-kicker">NAC Hospitality OS</p>
              <h1>{unifiedOverview ? "Operational Dashboard" : "Overview"}</h1>
              <p className="nac-platform-sub">
                {unifiedOverview
                  ? "One source of truth — live guests, journey, and menu intelligence"
                  : "Operational pulse — menu, sessions, and live performance"}
              </p>
            </header>

            {OVERVIEW_TABS.length > 0 ? (
              <HubTabs tabs={OVERVIEW_TABS} active={overviewTab} onChange={setOverviewTab} />
            ) : null}

            {session && (
              <GlobalFilterBar
                variant="extended"
                onRefresh={loadDashboard}
                onExport={handleExport}
                loading={loading}
              />
            )}

            {unifiedOverview ? (
              <Suspense fallback={<ViewFallback label="Loading operational dashboard…" />}>
                <OperationalDashboard
                  session={session}
                  dashboard={operationalBi}
                  active={overviewActive}
                />
              </Suspense>
            ) : overviewTab === "sessions" ? (
              <Suspense fallback={<ViewFallback label="Loading session analytics…" />}>
                <AnalyticsDashboard
                  key={`${filters.selectedRange}-${filters.timeRangeHours}-${filters.branch || "all"}-${filters.language}-${filters.shift}-${filters.eventType}-${filters.dayType}-${filters.role}`}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<ViewFallback label="Loading overview…" />}>
                <LegacyOverviewPanel
                  session={session}
                  configured={configured}
                  rbacEnvInvalid={rbacEnvInvalid}
                  needsAuth={needsAuth}
                  error={error}
                  platformStatus={platformStatus}
                  sessionDiagnostics={sessionDiagnostics}
                  operationalTrust={operationalTrust}
                  loading={loading}
                  data={data}
                  loadDashboard={loadDashboard}
                  liveMode={liveMode}
                  qrSessionStarts={qrSessionStarts}
                  totalSessions={totalSessions}
                  itemOpenCount={itemOpenCount}
                  addOnRate={addOnRate}
                  topAddon={topAddon}
                  avgTimeSpent={avgTimeSpent}
                  strongestHour={strongestHour}
                  returningPct={returningPct}
                  returningSessions={returningSessions}
                  bouncePct={bouncePct}
                  bounceSessions={bounceSessions}
                  deepPct={deepPct}
                  deepSessions={deepSessions}
                  funnel={funnel}
                  sessionQuality={sessionQuality}
                  hourlyData={hourlyData}
                  hourlyGranularity={hourlyGranularity}
                  topItems={topItems}
                  topCategories={topCategories}
                  topSearches={topSearches}
                  topAddonPairs={topAddonPairs}
                  addOnClickCount={addOnClickCount}
                  totalLangEvents={totalLangEvents}
                  englishPct={englishPct}
                  arabicPct={arabicPct}
                  enCount={enCount}
                  arCount={arCount}
                  deadZones={deadZones}
                  lostSearches={lostSearches}
                  insights={insights}
                  langBehavior={langBehavior}
                />
              </Suspense>
            )}
          </>
          </div>
        ) : null}
      </main>
    </motion.div>
  );
}