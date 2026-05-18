import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  UtensilsCrossed,
  BarChart3,
  Store,
  Star,
  Settings,
  RefreshCw,
  Activity,
  Users,
  FolderOpen,
  Layers,
  PlusCircle,
  Languages,
  Search,
  Timer,
  Zap,
  Sparkles,
  Brain,
  TrendingUp,
  AlertTriangle,
  Crown,
  Info,
} from "lucide-react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import MenuManager from "./MenuManager";
import { PlatformFiltersProvider, usePlatformFilters } from "./context/PlatformFiltersContext";
import GlobalFilterBar from "./components/GlobalFilterBar";
import { NAV_ITEMS, isScrollableView, OVERVIEW_TABS } from "./navigation";
import HubTabs from "./components/HubTabs";
import IntelligenceHub from "./views/IntelligenceHub";
import ReviewsHub from "./views/ReviewsHub";
import BranchesView from "./views/BranchesView";
import SettingsView from "./views/SettingsView";

import FunnelChart from "./components/FunnelChart";
import LiveActivity from "./components/LiveActivity";
import SessionQuality from "./components/SessionQuality";
import InsightEngine from "./components/InsightEngine";
import { CATEGORY_NAMES, formatDuration, formatHourLabel, exportCSV } from "./utils/formatters";
import { generateInsights } from "./utils/insights";
import "./styles/admin-dashboard.css";
import "./styles/platform-os.css";

const AnalyticsDashboard = lazy(() => import("./AnalyticsDashboard"));

const NAV_ICONS = {
  overview: LayoutDashboard,
  intelligence: Brain,
  reviews: Star,
  menu: UtensilsCrossed,
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

function InfoTip({ text }) {
  const [show, setShow] = React.useState(false);
  return (
    <span className="nac-bi-infotip-wrap" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onClick={() => setShow((s) => !s)}>
      <Info size={14} className="nac-bi-infotip-icon" />
      {show && <span className="nac-bi-infotip-bubble">{text}</span>}
    </span>
  );
}

const TOOLTIP_STYLE = {
  background: "rgba(10,10,10,0.88)",
  border: "1px solid rgba(143,122,87,0.3)",
  borderRadius: "14px",
  color: "#f9f9f7",
  fontSize: "12px",
};

function ev(byType, key) {
  return Number(byType?.[key]) || 0;
}

export default function AdminDashboard(props) {
  return (
    <PlatformFiltersProvider>
      <AdminDashboardContent {...props} />
    </PlatformFiltersProvider>
  );
}

function AdminDashboardContent({ onBack }) {
  const [adminView, setAdminView] = useState("overview");
  const [overviewTab, setOverviewTab] = useState("operations");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

  const filters = usePlatformFilters();
  const branch = filters.branch;
  const timeRange = filters.timeRangeHours;
  const liveMode = filters.liveMode;

  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    setError("");
    try {
      const { data: rpc, error: rpcErr } = await supabase.rpc("get_bi_dashboard", {
        p_branch: branch,
        p_hours: timeRange,
      });

      if (rpcErr) {
        const { data: fallback, error: fallErr } = await supabase.rpc("get_dashboard_aggregates");
        if (fallErr) throw fallErr;
        setData(fallback);
      } else if (!rpc || typeof rpc !== "object") {
        throw new Error("Empty response from RPC");
      } else {
        setData(rpc);
      }
    } catch (e) {
      setError(e?.message || "Failed to load dashboard data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session, branch, timeRange]);

  useEffect(() => {
    if (session && adminView === "overview") loadDashboard();
  }, [session, adminView, loadDashboard]);

  // Live mode auto-refresh
  useEffect(() => {
    if (!liveMode || !session || adminView !== "overview") return;
    const id = setInterval(loadDashboard, 30000);
    return () => clearInterval(id);
  }, [liveMode, session, adminView, loadDashboard]);

  // Derived metrics
  const totalEvents = Number(data?.total_events) || 0;
  const totalSessions = Number(data?.total_sessions) || 0;
  const byType = data?.by_event_type || {};
  const itemOpenCount = ev(byType, "item_open");
  const qrSessionStarts = ev(byType, "qr_session_start");
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
  const topCategories = data?.top_categories || [];
  const topSearches = data?.top_searches || [];

  const avgTimeSpent = Number(data?.avg_time_spent) || 0;
  const bounceSessions = Number(data?.bounce_sessions) || 0;
  const deepSessions = Number(data?.deep_sessions) || 0;
  const bouncePct = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const deepPct = totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0;
  const addOnRate = itemOpenCount > 0 ? ((addOnClickCount / itemOpenCount) * 100).toFixed(1) : "0";
  const returningSessions = Number(data?.returning_sessions) || 0;
  const returningPct = qrSessionStarts > 0 ? Math.round((returningSessions / qrSessionStarts) * 100) : 0;

  const hourlyData = (data?.by_hour || []).map((row) => ({
    label: formatHourLabel(row.hour),
    count: Number(row.count) || 0,
  }));

  // Funnel, session quality, dead zones, lost searches, executive data
  const funnel = data?.funnel || {};
  const sessionQuality = data?.session_quality || {};
  const deadZones = data?.dead_zones || [];
  const lostSearches = data?.lost_searches || [];
  const langBehavior = data?.lang_behavior || {};
  const strongestHour = data?.strongest_hour;
  // topConvertingCat available via data?.top_converting_category

  const insights = useMemo(() => generateInsights(data), [data]);

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

  const needsAuth = configured && !session;

  const scrollable = isScrollableView(adminView);

  return (
    <motion.div
      className="admin-shell"
      style={scrollable ? { overflow: "auto", minHeight: "100vh" } : undefined}
    >
      <div className="admin-bg-glow" />

      <aside className="admin-sidebar">
        <div>
          <p className="sidebar-logo">NAC HOSPITALITY OS</p>
          <div className="sidebar-menu">
            {NAV_ITEMS.map((item) => {
              const Icon = NAV_ICONS[item.id];
              const isActive = adminView === item.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${isActive ? "active" : ""}`}
                  whileHover={{ x: 6 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setAdminView(item.id)}
                >
                  {Icon && <Icon size={18} />}
                  <span>{item.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>
        <button className="admin-back" onClick={onBack}>Back to Menu</button>
      </aside>

      <main
        className="admin-content"
        style={scrollable ? { flex: 1, minHeight: 0, overflowY: "auto", alignSelf: "stretch" } : undefined}
      >
        {adminView === "intelligence" ? (
          <IntelligenceHub />
        ) : adminView === "reviews" ? (
          <ReviewsHub />
        ) : adminView === "menu" ? (
          <MenuManager />
        ) : adminView === "branches" ? (
          <BranchesView />
        ) : adminView === "settings" ? (
          <SettingsView />
        ) : (
          <>
            <header className="nac-platform-header">
              <p className="nac-platform-kicker">NAC Hospitality OS</p>
              <h1>Overview</h1>
              <p className="nac-platform-sub">Operational pulse — menu, sessions, and live performance</p>
            </header>

            <HubTabs tabs={OVERVIEW_TABS} active={overviewTab} onChange={setOverviewTab} />

            {session && (
              <GlobalFilterBar
                variant="extended"
                onRefresh={loadDashboard}
                onExport={handleExport}
                loading={loading}
              />
            )}

            {overviewTab === "sessions" ? (
              <Suspense fallback={<ViewFallback label="Loading session analytics…" />}>
                <AnalyticsDashboard />
              </Suspense>
            ) : (
          <>
            <div className="topbar">
              <div>
                <p className="topbar-label">LIVE OPERATIONS</p>
                <h1 style={{ fontSize: "1.35rem" }}>Today at a glance</h1>
              </div>
              <div className="topbar-actions">
                {session && (
                  <button type="button" className="glass-pill" onClick={loadDashboard} disabled={loading}>
                    <RefreshCw size={14} style={{ marginRight: 6, animation: loading ? "nac-bi-spin 0.75s linear infinite" : undefined }} />
                    Refresh
                  </button>
                )}
                {liveMode && <div className="glass-pill" style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="nac-bi-live-pulse" style={{ width: 8, height: 8, display: "inline-block" }} />Live</div>}
              </div>
            </div>

            {/* STATE MESSAGES */}
            {!configured && (
              <motion.div className="big-glass-card" style={{ marginTop: 28 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div className="card-header"><h3>Supabase not configured</h3></div>
                <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
                  Add <code style={{ color: "#d7bc8a" }}>REACT_APP_SUPABASE_URL</code> and{" "}
                  <code style={{ color: "#d7bc8a" }}>REACT_APP_SUPABASE_ANON_KEY</code> to <code style={{ color: "#d7bc8a" }}>.env.local</code>.
                </p>
              </motion.div>
            )}

            {needsAuth && (
              <motion.div className="big-glass-card" style={{ marginTop: 28 }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div className="card-header"><h3>Sign in required</h3></div>
                <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
                  Open <strong style={{ color: "#f9f9f7" }}>Settings</strong> in the sidebar and sign in.
                </p>
              </motion.div>
            )}

            {error && (
              <motion.div className="big-glass-card" style={{ marginTop: 28, borderColor: "rgba(220,80,80,0.3)" }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <p style={{ color: "#f5c4c4" }}>{error}</p>
              </motion.div>
            )}

            {/* LOADING SKELETONS */}
            {loading && !data && (
              <section className="stats-grid" style={{ marginTop: 42 }}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="nac-bi-skeleton" style={{ height: 140 }} />
                ))}
              </section>
            )}

            {data && (
              <>
                {/* ── EXECUTIVE KPI ROW ── */}
                <p className="bi-section-title"><Crown size={14} /> Executive Summary</p>
                <div className="nac-bi-exec-grid">
                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                    <p className="nac-bi-exec-label"><Users size={13} /> QR Scans</p>
                    <p className="nac-bi-exec-value">{qrSessionStarts.toLocaleString()}</p>
                    <p className="nac-bi-exec-sub">{totalSessions.toLocaleString()} unique sessions</p>
                  </motion.div>

                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
                    <p className="nac-bi-exec-label"><Layers size={13} /> Item Opens</p>
                    <p className="nac-bi-exec-value">{itemOpenCount.toLocaleString()}</p>
                    <p className="nac-bi-exec-sub">{Number(data?.avg_items_per_session) > 0 ? `${data.avg_items_per_session} avg per session` : "—"}</p>
                  </motion.div>

                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                    <p className="nac-bi-exec-label"><TrendingUp size={13} /> Add-on Conversion</p>
                    <p className="nac-bi-exec-value"><span className="nac-bi-exec-highlight">{addOnRate}%</span></p>
                    <p className="nac-bi-exec-sub">{topAddon ? `Top: ${topAddon.addon}` : "No data yet"}</p>
                  </motion.div>

                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                    <p className="nac-bi-exec-label"><Timer size={13} /> Avg Session</p>
                    <p className="nac-bi-exec-value">{formatDuration(avgTimeSpent)}</p>
                    <p className="nac-bi-exec-sub">
                      {strongestHour != null ? `Peak at ${strongestHour > 12 ? strongestHour - 12 : strongestHour || 12} ${strongestHour >= 12 ? "PM" : "AM"}` : "—"}
                    </p>
                  </motion.div>

                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                    <p className="nac-bi-exec-label"><Users size={13} /> Returning Guests</p>
                    <p className="nac-bi-exec-value">{qrSessionStarts > 0 ? <><span className="nac-bi-exec-highlight">{returningPct}%</span></> : "—"}</p>
                    <p className="nac-bi-exec-sub">{returningSessions.toLocaleString()} returning</p>
                  </motion.div>

                  <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <p className="nac-bi-exec-label"><Languages size={13} /> Language</p>
                    <p className="nac-bi-exec-value">
                      {totalLangEvents > 0 ? <>{englishPct}% <span style={{ color: "rgba(249,249,247,0.4)", fontSize: 18 }}>EN</span> · {arabicPct}% <span style={{ color: "#d7bc8a", fontSize: 18 }}>AR</span></> : "—"}
                    </p>
                    <p className="nac-bi-exec-sub">
                      {langBehavior?.ar?.avg_events && langBehavior?.en?.avg_events
                        ? `AR ${langBehavior.ar.avg_events} avg · EN ${langBehavior.en.avg_events} avg events`
                        : `${totalLangEvents.toLocaleString()} events`}
                    </p>
                  </motion.div>
                </div>

                {/* ── LIVE ACTIVITY + FUNNEL ── */}
                <div className="bi-row-grid">
                  <div>
                    <LiveActivity supabase={supabase} session={session} CATEGORY_NAMES={CATEGORY_NAMES} />
                  </div>
                  <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <h4><Zap size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Customer Journey</h4>
                    <p className="bi-table-sub">Unique sessions at each funnel stage</p>
                    <FunnelChart funnel={funnel} />
                  </motion.div>
                </div>

                {/* ── SESSION QUALITY + INTELLIGENCE ── */}
                <p className="bi-section-title"><Zap size={14} /> Session Intelligence</p>
                <div className="bi-row-grid">
                  <SessionQuality quality={sessionQuality} totalSessions={totalSessions} />
                  <div>
                    <div className="bi-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                      <motion.div className="bi-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }}>
                        <p className="bi-card-label"><Timer size={13} /> Avg Duration</p>
                        <p className="bi-card-value">{formatDuration(avgTimeSpent)}</p>
                      </motion.div>
                      <motion.div className="bi-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }}>
                        <p className="bi-card-label"><Layers size={13} /> Items/Session</p>
                        <p className="bi-card-value">{Number(data?.avg_items_per_session) > 0 ? data.avg_items_per_session : "—"}</p>
                      </motion.div>
                      <motion.div className="bi-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }}>
                        <p className="bi-card-label"><Activity size={13} /> Bounce</p>
                        <p className="bi-card-value">{bounceSessions > 0 ? `${bouncePct}%` : "—"}</p>
                        <p className="bi-card-sub">{bounceSessions.toLocaleString()} sessions</p>
                      </motion.div>
                      <motion.div className="bi-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4 }}>
                        <p className="bi-card-label"><Sparkles size={13} /> Deep</p>
                        <p className="bi-card-value">{deepSessions > 0 ? `${deepPct}%` : "—"}</p>
                        <p className="bi-card-sub">{deepSessions.toLocaleString()} sessions</p>
                      </motion.div>
                    </div>
                  </div>
                </div>

                {/* ── HOURLY CHART + TOP ITEMS ── */}
                <section className="dashboard-row">
                  <motion.div className="big-glass-card" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="card-header">
                      <h3>Hourly Activity</h3>
                      <span>Last 24 hours</span>
                    </div>
                    <div className="real-chart">
                      {hourlyData.length === 0 ? (
                        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "rgba(249,249,247,0.4)" }}>No events in the last 24 hours</div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourlyData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis dataKey="label" tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 10 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 11 }} allowDecimals={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} />
                            <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#d7bc8a" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </motion.div>

                  <motion.div className="activity-card" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <div className="card-header"><h3>Top Dishes</h3><span>Top 10</span></div>
                    <div className="top-items-list">
                      {topItems.length === 0 ? (
                        <p style={{ color: "rgba(249,249,247,0.45)" }}>No item opens yet</p>
                      ) : (
                        topItems.slice(0, 10).map((item, i) => (
                          <div className="top-item" key={item.name}>
                            <div><b>{i + 1}</b><span>{item.name}</span></div>
                            <p>{item.opens}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </section>

                {/* ── BUSINESS INTELLIGENCE ── */}
                <p className="bi-section-title"><BarChart3 size={14} /> Business Intelligence</p>
                <div className="bi-row-grid">
                  <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <h4><FolderOpen size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Most Opened Categories</h4>
                    <p className="bi-table-sub">Ranked by guest interest</p>
                    <div className="bi-list">
                      {topCategories.length === 0 ? <p className="bi-empty">No data yet</p> : topCategories.map((row, i) => (
                        <div className="bi-list-item" key={row.id}>
                          <div className="bi-list-item-left">
                            <span className="bi-rank">{i + 1}</span>
                            <span className="bi-list-name">{CATEGORY_NAMES[row.id] || row.id}</span>
                          </div>
                          <span className="bi-list-count">{Number(row.opens).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <h4><Search size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Most Searched Keywords</h4>
                    <p className="bi-table-sub">Top 10 search queries</p>
                    <div className="bi-list">
                      {topSearches.length === 0 ? <p className="bi-empty">No searches yet</p> : topSearches.map((row, i) => (
                        <div className="bi-list-item" key={row.query}>
                          <div className="bi-list-item-left">
                            <span className="bi-rank">{i + 1}</span>
                            <span className="bi-list-name">&ldquo;{row.query}&rdquo;</span>
                          </div>
                          <span className="bi-list-count">{Number(row.count).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>

                <div className="bi-row-grid">
                  <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <h4><PlusCircle size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Add-on Conversion</h4>
                    <p className="bi-table-sub">{addOnRate}% overall — {addOnClickCount.toLocaleString()} clicks ÷ {itemOpenCount.toLocaleString()} opens</p>
                    <div className="bi-list">
                      {topAddonPairs.length === 0 ? <p className="bi-empty">No add-on data yet</p> : topAddonPairs.map((row) => (
                        <div className="bi-addon-row" key={`${row.item}-${row.addon}`}>
                          <div style={{ minWidth: 0 }}>
                            <div className="bi-addon-item">{row.item}</div>
                            <div className="bi-addon-addon">+ {row.addon}</div>
                          </div>
                          <span className="bi-list-count">{Number(row.clicks).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <h4><Languages size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Language Usage</h4>
                    <p className="bi-table-sub">{totalLangEvents.toLocaleString()} events</p>
                    {totalLangEvents > 0 ? (
                      <>
                        <div className="bi-lang-bar">
                          <div className="bi-lang-bar-en" style={{ width: `${englishPct}%` }}>{englishPct > 10 ? `EN ${englishPct}%` : ""}</div>
                          <div className="bi-lang-bar-ar" style={{ width: `${arabicPct}%` }}>{arabicPct > 10 ? `AR ${arabicPct}%` : ""}</div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                          <div>
                            <p style={{ margin: 0, fontSize: 13, color: "rgba(249,249,247,0.6)" }}>English</p>
                            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700 }}>{enCount.toLocaleString()}</p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <p style={{ margin: 0, fontSize: 13, color: "rgba(249,249,247,0.6)" }}>Arabic</p>
                            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#d7bc8a" }}>{arCount.toLocaleString()}</p>
                          </div>
                        </div>
                      </>
                    ) : <p className="bi-empty">No language data yet</p>}
                  </motion.div>
                </div>

                {/* ── DEAD ZONES + LOST SEARCHES ── */}
                {(deadZones.length > 0 || lostSearches.length > 0) && (
                  <>
                    <p className="bi-section-title"><AlertTriangle size={14} /> Menu Dead Zones & Lost Intent</p>
                    <div className="bi-row-grid">
                      {deadZones.length > 0 && (
                        <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <h4><AlertTriangle size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7a84a" }} />Menu Dead Zones</h4>
                            <InfoTip text="Measures how often guests open items after entering a category. Low % means guests leave without exploring." />
                          </div>
                          <p className="bi-table-sub">Category engagement breakdown</p>
                          <div className="bi-list">
                            {deadZones.map((dz) => {
                              const ratio = Number(dz.engagement_ratio) || 0;
                              const opens = Number(dz.opens) || 0;
                              const itemOpens = Number(dz.item_opens) || 0;
                              const colorClass = ratio < 20 ? "nac-bi-deadzone-critical" : ratio < 50 ? "nac-bi-deadzone-low" : "nac-bi-deadzone-ok";
                              const colorHex = ratio < 20 ? "#b05050" : ratio < 50 ? "#d7a84a" : "#76d69f";
                              return (
                                <div className="nac-bi-deadzone-item" key={dz.category}>
                                  <div style={{ minWidth: 0, flex: "0 0 auto" }}>
                                    <div className="bi-list-name" style={{ fontWeight: 600, marginBottom: 3 }}>{CATEGORY_NAMES[dz.category] || dz.category}</div>
                                    <div style={{ fontSize: 11, color: "rgba(249,249,247,0.45)" }}>
                                      {opens} opens · {itemOpens} item views
                                    </div>
                                  </div>
                                  <div className="nac-bi-deadzone-bar" style={{ flex: 1 }}>
                                    <div className={`nac-bi-deadzone-fill ${colorClass}`} style={{ width: `${Math.min(ratio, 100)}%` }} />
                                  </div>
                                  <span style={{ fontSize: 13, color: colorHex, fontWeight: 700, minWidth: 44, textAlign: "right" }}>
                                    {ratio}%
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}

                      {lostSearches.length > 0 && (
                        <motion.div className="bi-table" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                          <h4><Search size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#4a6d76" }} />Lost Search Intent</h4>
                          <p className="bi-table-sub">Searches with no item views — unmet guest needs</p>
                          <div className="bi-list">
                            {lostSearches.map((row, i) => (
                              <div className="bi-list-item" key={row.query} style={{ borderLeftColor: "#4a6d76", borderLeftWidth: 3 }}>
                                <div className="bi-list-item-left">
                                  <span className="bi-rank">{i + 1}</span>
                                  <div>
                                    <span className="bi-list-name">&ldquo;{row.query}&rdquo;</span>
                                    <div style={{ fontSize: 11, color: "rgba(249,249,247,0.4)", marginTop: 2 }}>
                                      {row.count} {Number(row.count) === 1 ? "session" : "sessions"} → no item opened
                                    </div>
                                  </div>
                                </div>
                                <span className="bi-list-count">{Number(row.count).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                          
                        </motion.div>
                      )}
                    </div>
                  </>
                )}

                {/* ── AI INSIGHTS ── */}
                {insights.length > 0 && (
                  <>
                    <p className="bi-section-title"><Sparkles size={14} /> AI Insights</p>
                    <InsightEngine insights={insights} />
                  </>
                )}
              </>
            )}
          </>
            )}
          </>
        )}
      </main>
    </motion.div>
  );
}
