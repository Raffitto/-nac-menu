import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Crown,
  FolderOpen,
  Languages,
  Layers,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { useOperationalDashboard } from "../hooks/useOperationalDashboard";
import PlatformStatusBanner from "../components/PlatformStatusBanner";
import OperationalTrustBadge from "../components/OperationalTrustBadge";
import SessionStabilizationDiagnostics from "../components/SessionStabilizationDiagnostics";
import LiveActivity from "../components/LiveActivity";
import FunnelChart from "../components/FunnelChart";
import SessionQuality from "../components/SessionQuality";
import InsightEngine from "../components/InsightEngine";
import { assessOperationalHealth } from "../engines/operationalHealthEngine";
import { CATEGORY_NAMES, formatDuration } from "../utils/formatters";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { generateOperationalDashboardInsights } from "../utils/operationalInsightsIntegrity";
import { humanizeActivityFeedRow } from "../utils/activityFeedHumanize";
import {
  operationalRangeContextNote,
  monthSevenDayIntegrityWarning,
  rememberSevenDayMenuQr,
  readCachedSevenDayMenuQr,
} from "../../lib/operationalRangeHelpers";
import { getMetricLabel, METRIC_IDS } from "../../intelligence/metrics/metricDefinitions";
import "../styles/operational-dashboard.css";

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

function InfoTip({ text }) {
  const [show, setShow] = React.useState(false);
  return (
    <span
      className="nac-bi-infotip-wrap"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow((s) => !s)}
      role="presentation"
    >
      <AlertTriangle size={14} className="nac-bi-infotip-icon" style={{ opacity: 0.5 }} />
      {show && <span className="nac-bi-infotip-bubble">{text}</span>}
    </span>
  );
}

export default function OperationalDashboard({ session }) {
  const filters = usePlatformFiltersOptional();
  const {
    data,
    loading,
    error,
    platformStatus,
    operationalTrust,
    partial,
    note,
    activityFeed,
    activeGuestsNow,
    reload,
  } = useOperationalDashboard({
    enabled: Boolean(session),
    refreshIntervalMs: filters?.liveMode ? 30000 : 0,
  });

  const funnel = data?.funnel || {};
  const menuQrScans =
    Number(data?.menu_qr_scans) || Number(funnel.qr_scans) || 0;
  const totalSessions = Number(data?.total_sessions) || menuQrScans;
  const byType = data?.by_event_type || {};
  const itemOpenCount = Number(funnel.item_opens) || ev(byType, "item_open");
  const reviewQrScans = Number(data?.review_qr_scans) || 0;
  const addOnClickCount = ev(byType, "add_on_click") || ev(byType, "addon_interaction");
  const reviewRedirect = Number(funnel.review_redirect) || 0;
  const googleReviewOpen = Number(funnel.google_review_open) || 0;

  const langStats = data?.session_language || {};
  const arCount = Number(langStats.ar_sessions) || 0;
  const enCount = Number(langStats.en_sessions) || 0;
  const totalLangSessions = Number(langStats.total_sessions) || arCount + enCount;
  const arabicPct = Number(langStats.arabic_pct) || 0;
  const englishPct = Number(langStats.english_pct) || 0;

  const avgTimeSpent = Number(data?.avg_time_spent) || 0;
  const bounceSessions = Number(data?.bounce_sessions) || 0;
  const deepSessions = Number(data?.deep_sessions) || 0;
  const bouncePct = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const deepPct = totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0;
  const addOnRate = itemOpenCount > 0 ? ((addOnClickCount / itemOpenCount) * 100).toFixed(1) : "0";
  const returningSessions = Number(data?.returning_sessions) || 0;
  const returningPct = menuQrScans > 0 ? Math.round((returningSessions / menuQrScans) * 100) : 0;
  const reviewConversionPct = Number(data?.review_kpis?.review_conversion_pct) || 0;

  const scanChart = data?.scan_chart || { rows: [], title: "Menu QR scans", usesQrEventsOnly: false };
  const hourlyData = scanChart.rows || [];
  const scanChartTitle = scanChart.title || "Menu QR scans";

  const sessionQuality = data?.session_quality || {};
  const sessionDiagnostics = data?.session_diagnostics || null;
  const deadZones = data?.dead_zones || [];
  const lostSearches = data?.lost_searches || [];
  const topItems = data?.top_items || [];
  const topCategories = data?.top_categories || [];
  const topSearches = data?.top_searches || [];
  const topAddonPairs = data?.top_addon_pairs || [];
  const insights = useMemo(() => generateOperationalDashboardInsights(data), [data]);
  const funnelStageMetrics = data?.funnel_stage_metrics;
  const selectedRange = filters?.selectedRange || "today";

  React.useEffect(() => {
    if (selectedRange === "7d" && menuQrScans > 0) {
      rememberSevenDayMenuQr(menuQrScans);
    }
  }, [selectedRange, menuQrScans]);

  const rangeContextNote = operationalRangeContextNote(selectedRange);
  const monthIntegrityWarning = monthSevenDayIntegrityWarning({
    selectedRange,
    monthQr: menuQrScans,
    sevenDayQr: readCachedSevenDayMenuQr(),
  });

  const health = useMemo(
    () =>
      assessOperationalHealth({
        sessions: totalSessions,
        bouncePct,
        deepPct,
        addOnRate: Number(addOnRate),
        returningPct,
        reviewConversionPct,
        avgTimeSpent,
        itemOpens: itemOpenCount,
      }),
    [
      totalSessions,
      bouncePct,
      deepPct,
      addOnRate,
      returningPct,
      reviewConversionPct,
      avgTimeSpent,
      itemOpenCount,
    ],
  );

  if (!data && loading) {
    return (
      <section className="nac-ops-dash">
        <div className="stats-grid" style={{ marginTop: 28 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="nac-bi-skeleton" style={{ height: 140 }} />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <motion.div className="big-glass-card" style={{ marginTop: 28, borderColor: "rgba(220,80,80,0.3)" }}>
        <p style={{ color: "#f5c4c4" }}>{error}</p>
      </motion.div>
    );
  }

  if (!data) return null;

  return (
    <section className="nac-ops-dash">
      <div className="nac-ops-dash__toolbar">
        <div>
          <p className="topbar-label">LIVE OPERATIONS</p>
          <h2 className="nac-ops-dash__title">Operational Dashboard</h2>
        </div>
        <OperationalTrustBadge trust={operationalTrust} className="topbar-trust" />
        <div className="topbar-actions">
          <button type="button" className="glass-pill" onClick={reload} disabled={loading}>
            <RefreshCw
              size={14}
              style={{ marginRight: 6, animation: loading ? "nac-bi-spin 0.75s linear infinite" : undefined }}
            />
            Refresh
          </button>
          {filters?.liveMode && (
            <div className="glass-pill" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="nac-bi-live-pulse" style={{ width: 8, height: 8, display: "inline-block" }} />
              Live
            </div>
          )}
        </div>
      </div>

      <PlatformStatusBanner platformStatus={platformStatus} />
      {partial && note ? <p className="nac-ops-user-note">{note}</p> : null}
      {rangeContextNote ? (
        <p className="nac-ops-range-note" role="note">
          {rangeContextNote}
        </p>
      ) : null}
      {monthIntegrityWarning ? (
        <p className="nac-ops-range-note nac-ops-range-note--warn" role="note">
          {monthIntegrityWarning}
        </p>
      ) : null}

      <details className="nac-ops-diagnostics">
        <summary>System diagnostics</summary>
        <SessionStabilizationDiagnostics diagnostics={sessionDiagnostics} />
        <p className="nac-ops-audit-hint">
          Data trust audit: open devtools → <code>window.__NAC_DASHBOARD_AUDIT__</code>
        </p>
      </details>

      <p className="bi-section-title">
        <Crown size={14} /> Executive Summary
      </p>
      <div className="nac-bi-exec-grid nac-ops-exec-grid">
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="nac-bi-exec-label">
            <Users size={13} /> Menu QR Scans
          </p>
          <p className="nac-bi-exec-value">{menuQrScans.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">Menu experience entry</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          <p className="nac-bi-exec-label">
            <Users size={13} /> Review QR Scans
          </p>
          <p className="nac-bi-exec-value">{reviewQrScans.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">Review experience entry</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}>
          <p className="nac-bi-exec-label">
            <Activity size={13} /> {getMetricLabel(METRIC_IDS.SESSION)}
          </p>
          <p className="nac-bi-exec-value">{totalSessions.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">Canonical menu entry sessions</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <p className="nac-bi-exec-label">
            <Zap size={13} /> {getMetricLabel(METRIC_IDS.GOOGLE_REDIRECT)}
          </p>
          <p className="nac-bi-exec-value">{reviewRedirect.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">Not {getMetricLabel(METRIC_IDS.GOOGLE_REVIEW).toLowerCase()}</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.09 }}>
          <p className="nac-bi-exec-label">
            <TrendingUp size={13} /> Google review page open
          </p>
          <p className="nac-bi-exec-value">{googleReviewOpen.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">
            {reviewConversionPct > 0 ? `${reviewConversionPct}% tap-to-Google` : "Review funnel step — not public review count"}
          </p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <p className="nac-bi-exec-label">
            <Timer size={13} /> Avg Session
          </p>
          <p className="nac-bi-exec-value">{avgTimeSpent > 0 ? formatDuration(avgTimeSpent) : "—"}</p>
          <p className="nac-bi-exec-sub">Time on menu</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <p className="nac-bi-exec-label">
            <Languages size={13} /> Language
          </p>
          <p className="nac-bi-exec-value">
            {totalLangSessions > 0 ? (
              <>
                {englishPct}% EN · {arabicPct}% AR
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="nac-bi-exec-sub">{totalLangSessions.toLocaleString()} sessions (first language)</p>
        </motion.div>
        <motion.div className="nac-bi-exec-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <p className="nac-bi-exec-label">
            <Users size={13} /> Active Guests
          </p>
          <p className="nac-bi-exec-value">{activeGuestsNow.toLocaleString()}</p>
          <p className="nac-bi-exec-sub">Guests active now</p>
        </motion.div>
      </div>

      <div className={`nac-ops-health nac-ops-health--${health.status}`}>
        <span className="nac-ops-health__badge">{health.label}</span>
        <p className="nac-ops-health__text">{health.explanation}</p>
      </div>

      <p className="bi-section-title">
        <Activity size={14} /> Live Activity
      </p>
      <div className="bi-row-grid">
        <LiveActivity
          supabase={supabase}
          session={session}
          CATEGORY_NAMES={CATEGORY_NAMES}
          activeSessions={activeGuestsNow}
        />
        <motion.div className="bi-table nac-ops-feed">
          <h4>Recent Activity</h4>
          <p className="bi-table-sub">Latest guest interactions</p>
          <div className="nac-ops-feed-list">
            {activityFeed.length === 0 ? (
              <p className="bi-empty">No recent events</p>
            ) : (
              activityFeed.slice(0, 20).map((row) => (
                <div key={row.id || `${row.event_type}-${row.created_at}`} className="nac-ops-feed-row">
                  <span className="nac-ops-feed-detail">{humanizeActivityFeedRow(row)}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      <p className="bi-section-title">
        <Zap size={14} /> Customer Journey
      </p>
      <motion.div className="bi-table nac-ops-funnel-wrap" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <FunnelChart funnel={funnel} stageMetrics={funnelStageMetrics} />
      </motion.div>

      <SessionQuality
        quality={sessionQuality}
        totalSessions={totalSessions}
        selectedRange={selectedRange}
        fromLivePatch={Boolean(data?._sessionMetricsFromLivePatch)}
      />

      <p className="bi-section-title">
        <BarChart3 size={14} /> Menu Intelligence
      </p>
      <section className="dashboard-row">
        <motion.div className="big-glass-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="card-header">
            <h3>{scanChartTitle}</h3>
          </div>
          <div className="real-chart">
            {!scanChart.usesQrEventsOnly ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "rgba(249,249,247,0.4)", padding: 16, textAlign: "center" }}>
                {scanChart.emptyReason || "Hourly scan breakdown isn't available for this period yet."}
              </div>
            ) : hourlyData.length === 0 ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "rgba(249,249,247,0.4)" }}>
                No menu QR scans in range
              </div>
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
        <motion.div className="activity-card" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
          <div className="card-header">
            <h3>Top Items</h3>
            <span>Top 10</span>
          </div>
          <div className="top-items-list">
            {topItems.length === 0 ? (
              <p style={{ color: "rgba(249,249,247,0.45)" }}>No item opens yet</p>
            ) : (
              topItems.slice(0, 10).map((item, i) => (
                <div className="top-item" key={item.name}>
                  <div>
                    <b>{i + 1}</b>
                    <span>{item.name}</span>
                  </div>
                  <p>{item.opens}</p>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </section>

      <div className="bi-row-grid">
        <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h4>
            <FolderOpen size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />
            Top Categories
          </h4>
          <div className="bi-list">
            {topCategories.length === 0 ? (
              <p className="bi-empty">No data yet</p>
            ) : (
              topCategories.map((row, i) => (
                <div className="bi-list-item" key={row.id}>
                  <div className="bi-list-item-left">
                    <span className="bi-rank">{i + 1}</span>
                    <span className="bi-list-name">{CATEGORY_NAMES[row.id] || row.id}</span>
                  </div>
                  <span className="bi-list-count">{Number(row.opens).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>
        <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h4>
            <Search size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />
            Search Behavior
          </h4>
          <div className="bi-list">
            {topSearches.length === 0 ? (
              <p className="bi-empty">No searches yet</p>
            ) : (
              topSearches.map((row, i) => (
                <div className="bi-list-item" key={row.query}>
                  <div className="bi-list-item-left">
                    <span className="bi-rank">{i + 1}</span>
                    <span className="bi-list-name">&ldquo;{row.query}&rdquo;</span>
                  </div>
                  <span className="bi-list-count">{Number(row.count).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      <div className="bi-row-grid">
        <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h4>
            <PlusCircle size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />
            Add-on Engagement
          </h4>
          <p className="bi-table-sub">{addOnRate}% conversion · {addOnClickCount.toLocaleString()} interactions</p>
          <div className="bi-list">
            {topAddonPairs.length === 0 ? (
              <p className="bi-empty">No add-on data yet</p>
            ) : (
              topAddonPairs.map((row) => (
                <div className="bi-addon-row" key={`${row.item}-${row.addon}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="bi-addon-item">{row.item}</div>
                    <div className="bi-addon-addon">+ {row.addon}</div>
                  </div>
                  <span className="bi-list-count">{Number(row.clicks).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </motion.div>
        <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <h4>
            <Layers size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />
            Language Usage
          </h4>
          {totalLangSessions > 0 ? (
            <>
              <div className="bi-lang-bar">
                <div className="bi-lang-bar-en" style={{ width: `${englishPct}%` }}>
                  {englishPct > 10 ? `EN ${englishPct}%` : ""}
                </div>
                <div className="bi-lang-bar-ar" style={{ width: `${arabicPct}%` }}>
                  {arabicPct > 10 ? `AR ${arabicPct}%` : ""}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: "rgba(249,249,247,0.6)" }}>English</p>
                  <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700 }}>{enCount.toLocaleString()}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontSize: 13, color: "rgba(249,249,247,0.6)" }}>Arabic</p>
                  <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: "#d7bc8a" }}>
                    {arCount.toLocaleString()}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="bi-empty">No language data yet</p>
          )}
        </motion.div>
      </div>

      {(deadZones.length > 0 || lostSearches.length > 0) && (
        <>
          <p className="bi-section-title">
            <AlertTriangle size={14} /> Menu Signals
          </p>
          <div className="bi-row-grid">
            {deadZones.length > 0 && (
              <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h4>Menu Dead Zones</h4>
                  <InfoTip text="Low item exploration after category open — guests leave without browsing dishes." />
                </div>
                <div className="bi-list">
                  {deadZones.map((dz) => {
                    const ratio = Number(dz.engagement_ratio) || 0;
                    const colorHex = ratio < 20 ? "#b05050" : ratio < 50 ? "#d7a84a" : "#76d69f";
                    return (
                      <div className="nac-bi-deadzone-item" key={dz.category}>
                        <div style={{ minWidth: 0, flex: "0 0 auto" }}>
                          <div className="bi-list-name" style={{ fontWeight: 600 }}>
                            {CATEGORY_NAMES[dz.category] || dz.category}
                          </div>
                        </div>
                        <span style={{ fontSize: 13, color: colorHex, fontWeight: 700 }}>{ratio}%</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
            {lostSearches.length > 0 && (
              <motion.div className="bi-table" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <h4>Lost Search Intent</h4>
                <div className="bi-list">
                  {lostSearches.map((row, i) => (
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
            )}
          </div>
        </>
      )}

      {insights.length > 0 && (
        <>
          <p className="bi-section-title">
            <Sparkles size={14} /> AI Insights
          </p>
          <InsightEngine insights={insights} />
        </>
      )}
    </section>
  );
}
