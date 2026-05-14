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
  Sparkles,
  Users,
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
import "./styles/analytics-dashboard.css";

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

function aggregateClientSide(rows, totalEventsExact) {
  const sessions = new Set();
  const byLang = {};
  const byType = {};
  const itemCounts = {};
  const catCounts = {};
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
    if (r.created_at) {
      const d = new Date(r.created_at);
      if (!Number.isNaN(d.getTime())) {
        const age = Date.now() - d.getTime();
        if (age >= 0 && age < 24 * 60 * 60 * 1000) {
          d.setMinutes(0, 0, 0);
          const key = d.toISOString();
          hourly[key] = (hourly[key] || 0) + 1;
        }
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
    by_hour,
  };
}

export default function AnalyticsDashboard() {
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
  const [usedRpc, setUsedRpc] = useState(true);
  const [sampleNote, setSampleNote] = useState("");

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
    setSampleNote("");

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_dashboard_aggregates"
      );

      let agg = null;
      if (!rpcError && rpcData && typeof rpcData === "object") {
        agg = rpcData;
        setUsedRpc(true);
      } else {
        setUsedRpc(false);
        const { count: headCount, error: countErr } = await supabase
          .from("menu_events")
          .select("*", { count: "exact", head: true });
        if (countErr) throw countErr;

        const { data: rows, error: rowsErr } = await supabase
          .from("menu_events")
          .select(
            "session_id, language, event_type, category_id, item_name_en, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(12000);

        if (rowsErr) throw rowsErr;
        agg = aggregateClientSide(rows || [], headCount ?? undefined);
        if ((headCount ?? 0) > (rows?.length || 0)) {
          setSampleNote(
            "Some charts use a recent sample of events; run the SQL RPC for exact aggregates."
          );
        }
      }

      setAggregates(agg);

      const { data: addRows, error: addOnErr } = await supabase
        .from("menu_events")
        .select("add_on_name")
        .eq("event_type", "add_on_click")
        .not("add_on_name", "is", null)
        .limit(25000);

      if (addOnErr) {
        setTopAddons([]);
      } else {
        setTopAddons(aggregateTopAddonsFromRows(addRows));
      }

      const { data: recent, error: feedErr } = await supabase
        .from("menu_events")
        .select(
          "id, created_at, event_type, language, category_id, item_name_en, item_name_ar, search_query, add_on_name"
        )
        .order("created_at", { ascending: false })
        .limit(45);

      if (feedErr) throw feedErr;
      setFeed(recent || []);
    } catch (e) {
      setError(e?.message || "Failed to load analytics.");
      setAggregates(null);
      setFeed([]);
      setTopAddons([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

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
  const todayUniqueSessions = Number(aggregates?.today_unique_sessions) || 0;
  const todayQrSessions = Number(aggregates?.today_qr_sessions) || 0;

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
                  Use a Supabase Auth user with read access to{" "}
                  <code className="text-gold">menu_events</code>.
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
              Supabase <code className="text-gold">menu_events</code>
              {usedRpc ? " · server aggregates" : " · client sample"}
              {session?.user?.email && (
                <span className="text-white/40"> · {session.user.email}</span>
              )}
            </p>
            {sampleNote && (
              <p className="nac-an__hint max-w-xl">{sampleNote}</p>
            )}
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
                <p className="text-xs text-white/40 mt-2">All rows in menu_events</p>
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
                <p className="text-xs text-white/40 mt-2">Distinct session_id</p>
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
                <p className="text-xs text-white/40 mt-2">event_type = category_open</p>
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
                <p className="text-xs text-white/40 mt-2">event_type = item_open</p>
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
                <p className="text-xs text-white/40 mt-2">event_type = add_on_click</p>
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
                <p className="text-xs text-white/40 mt-2">event_type = language_change</p>
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
                <p className="text-xs text-white/40 mt-2">Approximate QR scans / unique opens</p>
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
                <p className="text-xs text-white/40 mt-2">
                  {todayUniqueSessions} unique sessions today
                </p>
              </motion.div>
            </div>

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
                <p className="text-sm text-white/50 mb-2">
                  Each event’s <code className="text-gold">language</code> field (all
                  event types).
                </p>
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
                <p className="text-sm text-white/50 mb-2">
                  Rows in <code className="text-gold">menu_events</code> grouped by{" "}
                  <code className="text-gold">event_type</code>.
                </p>
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

            <div className="grid gap-5 lg:grid-cols-2 mb-6">
              <motion.div
                className="nac-an__card"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                <h3 className="text-base font-semibold mb-1">Top viewed items</h3>
                <p className="text-sm text-white/50 mb-2">From item_open events</p>
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
                <p className="text-sm text-white/50 mb-2">From category_open events</p>
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
            </div>

            <motion.div
              className="nac-an__card mb-6"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.27 }}
            >
              <h3 className="text-base font-semibold mb-1">Top add-ons</h3>
              <p className="text-sm text-white/50 mb-2">
                From <code className="text-gold">add_on_click</code> events with{" "}
                <code className="text-gold">add_on_name</code> (ranked from up to 25k
                matching rows).
              </p>
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
              <p className="text-sm text-white/50 mb-2">
                Latest rows from <code className="text-gold">menu_events</code> (newest
                45).
              </p>
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
