import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertCircle,
  BarChart3,
  FolderOpen,
  Languages,
  Layers,
  LogOut,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
  Lock,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { usePlatformFiltersOptional } from "./context/PlatformFiltersContext";
import { applyPlatformFilters } from "./utils/platformFilterApply";
import { rangeToSince, rangeToHours, getRangeBounds } from "./utils/rangeState";
import { mapBiToSessionAggregates, mapBiTopAddons } from "./utils/sessionAnalyticsMap";
import { businessDayExportNote, periodLabelFromHours } from "./utils/businessDay";
import { hasExtendedPlatformFilters } from "./utils/platformFilterHelpers";
import "./styles/analytics-dashboard.css";

const EXTENDED_FILTER_ROW_LIMIT = 2500;
const FEED_LIMIT = 50;

const CATEGORY_NAMES = {
  brunch: "Brunch",
  daytime: "Daytime",
  breakfast: "Breakfast",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

const CHART_GOLD = "#d7bc8a";
const CHART_TEAL = "#4a6d76";
const CHART_MUTED = "rgba(249,249,247,0.45)";

const tooltipStyle = {
  background: "rgba(8,10,12,0.94)",
  border: "1px solid rgba(143,122,87,0.28)",
  borderRadius: "14px",
  color: "#f9f9f7",
  fontSize: "12px",
};

function useAnimatedInt(target, active = true) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    setValue(0);
    let frame;
    const start = performance.now();
    const dur = 820;
    const end = Math.max(0, Math.round(Number(target) || 0));

    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(end * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return value;
}

function formatCategoryId(id) {
  if (!id) return "—";
  return CATEGORY_NAMES[id] || id.replace(/-/g, " ");
}

function formatHourLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(11, 16);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

function eventCount(byEventType, key) {
  if (!byEventType || typeof byEventType !== "object") return 0;
  const v = byEventType[key];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function aggregateTopAddonsFromRows(rows) {
  const m = {};
  (rows || []).forEach((r) => {
    const k = (r.add_on_name || "").trim();
    if (!k) return;
    m[k] = (m[k] || 0) + 1;
  });
  return Object.entries(m)
    .map(([name, clicks]) => ({ name, clicks }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 12);
}

function aggregateClientSide(rows, totalEventsExact, rangeBounds = null) {
  const sinceMs = rangeBounds?.since ? new Date(rangeBounds.since).getTime() : null;
  const untilMs = rangeBounds?.until ? new Date(rangeBounds.until).getTime() : null;
  const sessions = new Set();
  const byLang = {};
  const byType = {};
  const itemCounts = {};
  const catCounts = {};
  const sectionCounts = {};
  const tabCounts = {};
  let drinkOpens = 0;
  let foodItemOpens = 0;
  const hourly = {};

  rows.forEach((r) => {
    if (r.session_id) sessions.add(r.session_id);
    const lang = (r.language || "unknown").trim() || "unknown";
    byLang[lang] = (byLang[lang] || 0) + 1;
    const et = r.event_type || "unknown";
    byType[et] = (byType[et] || 0) + 1;
    if (et === "item_open" && r.item_name_en?.trim()) {
      const n = r.item_name_en.trim();
      itemCounts[n] = (itemCounts[n] || 0) + 1;
    }
    if (et === "category_open" && r.category_id) {
      const c = r.category_id;
      catCounts[c] = (catCounts[c] || 0) + 1;
    }
    if ((et === "section_open" || et === "section_view") && r.section_id) {
      const key = `${r.category_id || "?"}::${r.section_id}`;
      sectionCounts[key] = (sectionCounts[key] || 0) + 1;
    }
    if (et === "menu_tab_open") {
      const meta = r.metadata && typeof r.metadata === "object" ? r.metadata : {};
      const tabId = meta.tab_id || meta.source_category_id || "?";
      const key = `${r.category_id || "?"}::${tabId}`;
      tabCounts[key] = (tabCounts[key] || 0) + 1;
    }
    if (et === "item_open" && r.category_id === "drinks") {
      drinkOpens += 1;
    }
    if (et === "item_open" && r.category_id && r.category_id !== "drinks") {
      foodItemOpens += 1;
    }
    if (r.created_at) {
      const d = new Date(r.created_at);
      const t = d.getTime();
      if (!Number.isNaN(t)) {
        if (sinceMs != null && t < sinceMs) return;
        if (untilMs != null && t > untilMs) return;
        d.setMinutes(0, 0, 0);
        const key = d.toISOString();
        hourly[key] = (hourly[key] || 0) + 1;
      }
    }
  });

  const top_items = Object.entries(itemCounts)
    .map(([name, opens]) => ({ name, opens }))
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 12);

  const top_categories = Object.entries(catCounts)
    .map(([id, opens]) => ({ id, opens }))
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 10);

  const top_sections = Object.entries(sectionCounts)
    .map(([key, views]) => {
      const [cat, sec] = key.split("::");
      return { category: cat, section: sec, views };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

  const menu_tab_engagement = Object.entries(tabCounts)
    .map(([key, opens]) => {
      const [host, tab] = key.split("::");
      return { host, tab, opens };
    })
    .sort((a, b) => b.opens - a.opens)
    .slice(0, 10);

  const drinks_vs_food_pct =
    foodItemOpens + drinkOpens > 0
      ? Math.round((drinkOpens / (foodItemOpens + drinkOpens)) * 100)
      : 0;

  const by_hour = Object.entries(hourly)
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => new Date(a.hour) - new Date(b.hour));

  return {
    total_events: totalEventsExact ?? rows.length,
    total_sessions: sessions.size,
    by_language: byLang,
    by_event_type: byType,
    top_items,
    top_categories,
    top_sections,
    menu_tab_engagement,
    drinks_vs_food_pct,
    scroll_depth_events: byType.scroll_depth || 0,
    time_spent_events: byType.time_spent || 0,
    by_hour,
  };
}

export default function AnalyticsDashboard() {
  const filters = usePlatformFiltersOptional();
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aggregates, setAggregates] = useState(null);
  const [feed, setFeed] = useState([]);
  const [topAddons, setTopAddons] = useState([]);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    setError("");

    const selectedRange = filters?.selectedRange || "today";
    const since = rangeToSince(selectedRange);
    const rangeBounds = getRangeBounds(selectedRange);
    const branch = filters?.branch || null;
    const pHours = filters?.timeRangeHours ?? rangeToHours(selectedRange);
    const hasExtendedFilters = hasExtendedPlatformFilters(filters);

    const menuSelect =
      "session_id, language, event_type, category_id, section_id, item_name_en, add_on_name, created_at, metadata, branch_id, employee_role";

    try {
      const { data: bi, error: biErr } = await supabase.rpc("get_bi_dashboard", {
        p_branch: branch,
        p_hours: pHours,
      });

      if (biErr) throw biErr;

      const biPayload = Array.isArray(bi) ? bi[0] : bi;
      let agg = mapBiToSessionAggregates(biPayload);
      setTopAddons(mapBiTopAddons(biPayload));

      if (hasExtendedFilters) {
        let rowsQ = supabase
          .from("menu_events")
          .select(menuSelect)
          .order("created_at", { ascending: false })
          .limit(EXTENDED_FILTER_ROW_LIMIT);
        if (since) rowsQ = rowsQ.gte("created_at", since);
        if (branch) rowsQ = rowsQ.eq("branch_id", branch);
        const { data: rows, error: rowsErr } = await rowsQ;
        if (rowsErr) throw rowsErr;

        const filtered = applyPlatformFilters(rows || [], filters);
        agg = aggregateClientSide(filtered, null, rangeBounds);
        setTopAddons(
          aggregateTopAddonsFromRows(
            filtered.filter((r) => r.event_type === "add_on_click" && r.add_on_name),
          ),
        );
      }

      setAggregates(agg);

      let feedQ = supabase
        .from("menu_events")
        .select(
          "id, created_at, event_type, language, category_id, item_name_en, item_name_ar, search_query, add_on_name, branch_id, metadata, employee_role"
        )
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT);
      if (since) feedQ = feedQ.gte("created_at", since);
      if (branch) feedQ = feedQ.eq("branch_id", branch);
      const { data: recent, error: feedErr } = await feedQ;

      if (feedErr) throw feedErr;
      const feedRows = hasExtendedFilters ? applyPlatformFilters(recent || [], filters) : recent || [];
      setFeed(feedRows.slice(0, 45));
    } catch (e) {
      setError(e?.message || "Failed to load analytics.");
      setAggregates(null);
      setFeed([]);
      setTopAddons([]);
    } finally {
      setLoading(false);
    }
  }, [session, filters]);

  useEffect(() => {
    if (session) loadData();
    else {
      setAggregates(null);
      setFeed([]);
      setTopAddons([]);
    }
  }, [session, loadData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setLoginError("");
    setLoginLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoginLoading(false);
    if (err) setLoginError(err.message);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAggregates(null);
    setFeed([]);
    setTopAddons([]);
  };

  const langChartData = useMemo(() => {
    if (!aggregates?.by_language) return [];
    return Object.entries(aggregates.by_language).map(([name, value]) => ({
      name: name === "ar" ? "Arabic" : name === "en" ? "English" : name,
      value,
    }));
  }, [aggregates]);

  const eventTypeData = useMemo(() => {
    if (!aggregates?.by_event_type) return [];
    return Object.entries(aggregates.by_event_type)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 14);
  }, [aggregates]);

  const hourlyData = useMemo(() => {
    const raw = aggregates?.by_hour;
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => ({
      label: formatHourLabel(row.hour),
      count: Number(row.count) || 0,
    }));
  }, [aggregates]);

  const totalEvents = aggregates?.total_events ?? 0;
  const totalSessions = aggregates?.total_sessions ?? 0;
  const byEventType = aggregates?.by_event_type || {};
  const categoryOpenCount = eventCount(byEventType, "category_open");
  const itemOpenCount = eventCount(byEventType, "item_open");
  const addOnClickCount = eventCount(byEventType, "add_on_click");
  const languageChangeCount = eventCount(byEventType, "language_change");
  const qrSessionStarts = eventCount(byEventType, "qr_session_start");
  const todayQrSessions = Number(aggregates?.today_qr_sessions) || 0;

  // Advanced session intelligence
  const avgTimeSpent = Number(aggregates?.avg_time_spent) || 0;
  const avgItemsPerSession = Number(aggregates?.avg_items_per_session) || 0;
  const bounceSessions = Number(aggregates?.bounce_sessions) || 0;
  const deepSessions = Number(aggregates?.deep_sessions) || 0;
  const bouncePercent = totalSessions > 0 ? Math.round((bounceSessions / totalSessions) * 100) : 0;
  const deepPercent = totalSessions > 0 ? Math.round((deepSessions / totalSessions) * 100) : 0;
  const topSearches = aggregates?.top_searches || [];
  const returningSessions = Number(aggregates?.returning_sessions) || 0;
  const returningPercent = qrSessionStarts > 0 ? Math.round((returningSessions / qrSessionStarts) * 100) : 0;
  const modalEngagementEvents = Number(aggregates?.modal_engagement_events) || 0;
  const addOnConversionRate = itemOpenCount > 0 ? ((addOnClickCount / itemOpenCount) * 100).toFixed(1) : "0";
  const modalEngagementRate = itemOpenCount > 0 ? ((modalEngagementEvents / itemOpenCount) * 100).toFixed(1) : "0";

  const animEvents = useAnimatedInt(totalEvents, Boolean(aggregates) && !loading);
  const animSessions = useAnimatedInt(
    totalSessions,
    Boolean(aggregates) && !loading
  );

  const pieColors = [CHART_TEAL, CHART_GOLD, "#5c6b70", "#7a6048", "#3d4f54"];

  if (!configured) {
    return (
      <div className="nac-an relative min-h-60vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6">
          <div className="nac-an__error flex items-center gap-3">
            <AlertCircle size={20} />
            <span>
              Supabase is not configured. Add{" "}
              <code className="text-gold">REACT_APP_SUPABASE_URL</code> and{" "}
              <code className="text-gold">REACT_APP_SUPABASE_ANON_KEY</code> to{" "}
              <code className="text-gold">.env.local</code>.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return (
      <div className="nac-an relative min-h-40vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner p-6 flex justify-center">
          <div className="nac-an__card w-full max-w-md">
            <div className="nac-an__skeleton h-10 w-two-thirds mb-4" />
            <div className="nac-an__skeleton h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="nac-an relative min-h-70vh">
        <div className="nac-an__bg" />
        <div className="nac-an__inner flex justify-center py-10 px-4">
          <motion.div
            className="nac-an__card w-full max-w-md border"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl border"
                style={{
                  borderColor: "rgba(143,122,87,0.35)",
                  background: "rgba(48,72,78,0.35)",
                }}
              >
                <Lock size={22} className="text-gold" />
              </div>
              <div>
                <p className="text-xs text-gold mb-1 tracking-wide">NAC Analytics</p>
                <h2 className="text-lg font-semibold">Sign in</h2>
                <p className="text-sm text-white/50 mt-1">
                  Authorized team members only
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-white/50 mb-2 block">Email</label>
                <input
                  className="nac-an__input"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@nac.com"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-2 block">Password</label>
                <input
                  className="nac-an__input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              <AnimatePresence>
                {loginError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="nac-an__error text-sm"
                  >
                    {loginError}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="submit"
                className="nac-an__btn nac-an__btn--primary w-full py-3"
                disabled={loginLoading}
              >
                {loginLoading ? "Signing in…" : "Continue"}
              </button>
            </form>

            <p className="nac-an__hint">
              Run <code className="text-gold">supabase/analytics_dashboard_setup.sql</code>{" "}
              in the SQL editor, then create an Auth user under Authentication → Users.
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="nac-an relative min-h-80vh pb-12">
      <div className="nac-an__bg" />
      <div className="nac-an__inner">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-8 pt-2">
          <div>
            <p className="text-xs text-gold mb-2 tracking-wide">NAC KHOBAR</p>
            <h1 className="text-4xl font-semibold mb-2">Live analytics</h1>
            <p className="text-sm text-white/55 max-w-xl">
              Real-time guest behavior data
              {session?.user?.email && (
                <span className="text-white/40"> · {session.user.email}</span>
              )}
            </p>
            <p className="text-xs text-white/40 mt-2">
              {periodLabelFromHours(filters?.timeRangeHours ?? rangeToHours(filters?.selectedRange || "today"))}
              {" · "}
              {businessDayExportNote()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <span className="nac-an__pill">
              <Sparkles size={14} />
              Live
            </span>
            <button
              type="button"
              className="nac-an__btn"
              onClick={() => loadData()}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? "nac-an-spin" : ""} />
              Refresh
            </button>
            <button
              type="button"
              className="nac-an__btn"
              onClick={handleSignOut}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <div className="nac-an__error mb-6 flex items-start gap-2">
            <AlertCircle className="shrink-0 mt-05" size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading && !aggregates && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="nac-an__card">
                <div className="nac-an__skeleton h-4 w-24 mb-4" />
                <div className="nac-an__skeleton h-10 w-20" />
              </div>
            ))}
          </div>
        )}

        {aggregates && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.02 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Activity size={14} className="text-gold" />
                  Total events
                </div>
                <div className="nac-an__stat-value">{animEvents.toLocaleString()}</div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Users size={14} className="text-gold" />
                  Sessions
                </div>
                <div className="nac-an__stat-value">
                  {animSessions.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <FolderOpen size={14} className="text-gold" />
                  Category opens
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {categoryOpenCount.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Layers size={14} className="text-gold" />
                  Item opens
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {itemOpenCount.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <PlusCircle size={14} className="text-gold" />
                  Add-on clicks
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {addOnClickCount.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Languages size={14} className="text-gold" />
                  Language toggles
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {languageChangeCount.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.14 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Users size={14} className="text-gold" />
                  QR Sessions (all time)
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {qrSessionStarts.toLocaleString()}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Activity size={14} className="text-gold" />
                  Today's opens
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {todayQrSessions.toLocaleString()}
                </div>
                
              </motion.div>
            </div>

            {/* Session Intelligence */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Zap size={14} className="text-gold" />
                  Avg time spent
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {avgTimeSpent >= 60
                    ? `${Math.floor(avgTimeSpent / 60)}m ${avgTimeSpent % 60}s`
                    : avgTimeSpent > 0 ? `${avgTimeSpent}s` : "—"}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Layers size={14} className="text-gold" />
                  Avg items / session
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {avgItemsPerSession > 0 ? avgItemsPerSession : "—"}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <TrendingUp size={14} className="text-gold" />
                  Bounce sessions
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {bounceSessions > 0 ? `${bouncePercent}%` : "—"}
                </div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.24 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Sparkles size={14} className="text-gold" />
                  Deep engagement
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {deepSessions > 0 ? `${deepPercent}%` : "—"}
                </div>
                
              </motion.div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <PlusCircle size={14} className="text-gold" />
                  Add-on conversion
                </div>
                <div className="nac-an__stat-value text-3xl">{addOnConversionRate}%</div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Activity size={14} className="text-gold" />
                  Modal engagement
                </div>
                <div className="nac-an__stat-value text-3xl">{modalEngagementRate}%</div>
                
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 text-xs text-white/50 mb-3">
                  <Users size={14} className="text-gold" />
                  Returning sessions
                </div>
                <div className="nac-an__stat-value text-3xl">
                  {qrSessionStarts > 0 ? `${returningPercent}%` : "—"}
                </div>
                
              </motion.div>
            </div>

            {topSearches.length > 0 && (
              <motion.div
                className="nac-an__card mb-6"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.32 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Search size={18} className="text-gold" />
                  <h3 className="text-base font-semibold">Most searched keywords</h3>
                </div>
                <p className="text-sm text-white/50 mb-2">Top 10 search queries</p>
                <div className="nac-an__list">
                  {topSearches.map((row, i) => (
                    <div className="nac-an__row" key={row.query}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="nac-an__row-rank">{i + 1}</span>
                        <span className="text-sm font-medium truncate">&ldquo;{row.query}&rdquo;</span>
                      </div>
                      <span className="text-gold text-sm shrink-0">{row.count}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="grid gap-5 lg:grid-cols-2 mb-6">
              <motion.div
                className="nac-an__card lg:col-span-2"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-base font-semibold">Hourly activity</h3>
                  <span className="text-xs text-white/45">Last 24 hours</span>
                </div>
                <p className="text-sm text-white/50 mb-2">Event volume by hour (UTC)</p>
                <div className="nac-an__chart-wrap">
                  {hourlyData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/40">
                      No events in the last 24 hours
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: CHART_MUTED, fontSize: 10 }}
                          interval="preserveStartEnd"
                          angle={-35}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis tick={{ fill: CHART_MUTED, fontSize: 11 }} allowDecimals={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" radius={[8, 8, 0, 0]} fill={CHART_GOLD} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.16 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Languages size={18} className="text-gold" />
                  <h3 className="text-base font-semibold">Language usage</h3>
                </div>
                <p className="text-sm text-white/50 mb-2">English vs Arabic split</p>
                <div className="nac-an__chart-wrap" style={{ height: 240 }}>
                  {langChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/40">
                      No language data
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={langChartData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={2}
                        >
                          {langChartData.map((_, i) => (
                            <Cell key={i} fill={pieColors[i % pieColors.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend
                          wrapperStyle={{ fontSize: "12px", color: CHART_MUTED }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 size={18} className="text-gold" />
                  <h3 className="text-base font-semibold">Event type counts</h3>
                </div>
                <p className="text-sm text-white/50 mb-2">Events by type</p>
                <div className="nac-an__chart-wrap" style={{ height: 260 }}>
                  {eventTypeData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-white/40">
                      No events
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        layout="vertical"
                        data={eventTypeData}
                        margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: CHART_MUTED, fontSize: 11 }} allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="type"
                          width={120}
                          tick={{ fill: CHART_MUTED, fontSize: 10 }}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" radius={[0, 6, 6, 0]} fill={CHART_TEAL} barSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </motion.div>
            </div>

            <div className="grid gap-5 lg:grid-cols-3 mb-6">
              <motion.div className="nac-an__card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                <h3 className="text-base font-semibold mb-1">Menu depth</h3>
                <p className="text-sm text-white/50 mb-2">Engagement signals</p>
                <ul className="text-sm text-white/70 space-y-1.5 list-none p-0 m-0">
                  <li>Drinks vs food opens: {aggregates.drinks_vs_food_pct ?? 0}% drinks</li>
                  <li>Scroll depth events: {aggregates.scroll_depth_events ?? 0}</li>
                  <li>Time spent events: {aggregates.time_spent_events ?? 0}</li>
                </ul>
              </motion.div>
              <motion.div className="nac-an__card lg:col-span-2" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                <h3 className="text-base font-semibold mb-1">Menu tab engagement</h3>
                <p className="text-sm text-white/50 mb-2">Dinner · Desserts · Drinks</p>
                <div className="nac-an__list">
                  {(aggregates.menu_tab_engagement || []).length === 0 ? (
                    <p className="text-sm text-white/40">No tab opens yet</p>
                  ) : (
                    aggregates.menu_tab_engagement.map((row) => (
                      <div className="nac-an__row" key={`${row.host}-${row.tab}`}>
                        <span className="text-sm font-medium truncate">
                          {formatCategoryId(row.host)} → {formatCategoryId(row.tab)}
                        </span>
                        <span className="text-gold text-sm shrink-0">{row.opens}</span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>

            <motion.div className="grid gap-5 lg:grid-cols-2 mb-6">
              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                <h3 className="text-base font-semibold mb-1">Top viewed items</h3>
                <p className="text-sm text-white/50 mb-2">Most opened dishes</p>
                <div className="nac-an__list">
                  {(aggregates.top_items || []).length === 0 ? (
                    <p className="text-sm text-white/40">No item views yet</p>
                  ) : (
                    aggregates.top_items.map((row, i) => (
                      <div className="nac-an__row" key={row.name}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="nac-an__row-rank">{i + 1}</span>
                          <span className="text-sm font-medium truncate">{row.name}</span>
                        </div>
                        <span className="text-gold text-sm shrink-0">{row.opens}</span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>

              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26 }}
              >
                <h3 className="text-base font-semibold mb-1">Top categories</h3>
                <p className="text-sm text-white/50 mb-2">Most browsed sections</p>
                <div className="nac-an__list">
                  {(aggregates.top_categories || []).length === 0 ? (
                    <p className="text-sm text-white/40">No category opens yet</p>
                  ) : (
                    aggregates.top_categories.map((row, i) => (
                      <div className="nac-an__row" key={row.id}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="nac-an__row-rank">{i + 1}</span>
                          <span className="text-sm font-medium truncate">
                            {formatCategoryId(row.id)}
                          </span>
                        </div>
                        <span className="text-gold text-sm shrink-0">{row.opens}</span>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </motion.div>

            <motion.div
              className="nac-an__card mb-6"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.27 }}
            >
              <h3 className="text-base font-semibold mb-1">Top add-ons</h3>
              <p className="text-sm text-white/50 mb-2">Most clicked add-ons</p>
              <div className="nac-an__list">
                {topAddons.length === 0 ? (
                  <p className="text-sm text-white/40">No add-on clicks with a name yet</p>
                ) : (
                  topAddons.map((row, i) => (
                    <div className="nac-an__row" key={row.name}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="nac-an__row-rank">{i + 1}</span>
                        <span className="text-sm font-medium truncate">{row.name}</span>
                      </div>
                      <span className="text-gold text-sm shrink-0">{row.clicks}</span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            <motion.div
              className="nac-an__card"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.29 }}
            >
              <h3 className="text-base font-semibold mb-1">Recent activity</h3>
              <p className="text-sm text-white/50 mb-2">Latest guest interactions</p>
              <div className="nac-an__feed">
                {feed.length === 0 ? (
                  <p className="text-sm text-white/40">No rows returned</p>
                ) : (
                  feed.map((row) => (
                    <div className="nac-an__feed-item" key={row.id}>
                      <div className="nac-an__feed-type">{row.event_type}</div>
                      <div className="text-white/80">
                        {row.item_name_en && (
                          <span className="font-medium">{row.item_name_en}</span>
                        )}
                        {row.category_id && (
                          <span className="text-white/50">
                            {row.item_name_en ? " · " : ""}
                            {formatCategoryId(row.category_id)}
                          </span>
                        )}
                        {row.search_query && (
                          <span className="text-white/50">
                            {" "}
                            · search: &ldquo;{row.search_query}&rdquo;
                          </span>
                        )}
                        {row.add_on_name && (
                          <span className="text-white/50"> · add-on: {row.add_on_name}</span>
                        )}
                      </div>
                      <div className="text-xs text-white/35 mt-1">
                        {row.language && `${row.language.toUpperCase()} · `}
                        {row.created_at &&
                          new Date(row.created_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
