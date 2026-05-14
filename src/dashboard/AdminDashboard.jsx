import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  UtensilsCrossed,
  BarChart3,
  Store,
  Star,
  Bell,
  Settings,
  RefreshCw,
  Activity,
  Users,
  FolderOpen,
  Layers,
  PlusCircle,
  Languages,
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
import AnalyticsDashboard from "./AnalyticsDashboard";
import "./styles/admin-dashboard.css";

const CATEGORY_NAMES = {
  brunch: "Brunch",
  daytime: "Daytime",
  breakfast: "Breakfast",
  evening: "Evening",
  desserts: "Desserts",
  drinks: "Drinks",
};

const sidebar = [
  { icon: <LayoutDashboard size={18} />, label: "Dashboard" },
  { icon: <UtensilsCrossed size={18} />, label: "Menu Manager" },
  { icon: <BarChart3 size={18} />, label: "Analytics" },
  { icon: <Store size={18} />, label: "Branches" },
  { icon: <Star size={18} />, label: "Reviews" },
  { icon: <Bell size={18} />, label: "AI Insights" },
  { icon: <Settings size={18} />, label: "Settings" },
];

function formatHour(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { hour: "numeric", hour12: true });
}

export default function AdminDashboard({ onBack }) {
  const [adminView, setAdminView] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

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
      const { data: rpc, error: rpcErr } = await supabase.rpc("get_dashboard_aggregates");
      if (rpcErr) throw rpcErr;
      if (!rpc || typeof rpc !== "object") throw new Error("Empty response from RPC");

      const { data: addRows } = await supabase
        .from("menu_events")
        .select("add_on_name")
        .eq("event_type", "add_on_click")
        .not("add_on_name", "is", null)
        .limit(25000);

      const addonMap = {};
      (addRows || []).forEach((r) => {
        const k = (r.add_on_name || "").trim();
        if (k) addonMap[k] = (addonMap[k] || 0) + 1;
      });
      const topAddons = Object.entries(addonMap)
        .map(([name, clicks]) => ({ name, clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 8);

      setData({ ...rpc, topAddons });
    } catch (e) {
      setError(e?.message || "Failed to load dashboard data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session && adminView === "overview") loadDashboard();
  }, [session, adminView, loadDashboard]);

  const totalEvents = Number(data?.total_events) || 0;
  const totalSessions = Number(data?.total_sessions) || 0;
  const byEventType = data?.by_event_type || {};
  const itemOpenCount = Number(byEventType.item_open) || 0;
  const qrSessionStarts = Number(byEventType.qr_session_start) || 0;

  const byLanguage = data?.by_language || {};
  const arCount = Number(byLanguage.ar) || 0;
  const enCount = Number(byLanguage.en) || 0;
  const totalLangEvents = arCount + enCount;
  const arabicPercent = totalLangEvents > 0 ? Math.round((arCount / totalLangEvents) * 100) : 0;

  const topItem = (data?.top_items || [])[0];
  const topCategory = (data?.top_categories || [])[0];
  const topAddon = (data?.topAddons || [])[0];

  const hourlyData = (data?.by_hour || []).map((row) => ({
    label: formatHour(row.hour),
    count: Number(row.count) || 0,
  }));

  const needsAuth = configured && !session;

  return (
    <div
      className="admin-shell"
      style={
        adminView === "analytics"
          ? { overflow: "auto", minHeight: "100vh" }
          : undefined
      }
    >
      <div className="admin-bg-glow"></div>

      <aside className="admin-sidebar">
        <div>
          <p className="sidebar-logo">NAC MENU OS</p>

          <div className="sidebar-menu">
            {sidebar.map((item) => {
              const isActive =
                (adminView === "overview" && item.label === "Dashboard") ||
                (adminView === "analytics" && item.label === "Analytics");
              return (
                <motion.button
                  key={item.label}
                  type="button"
                  className={`sidebar-item ${isActive ? "active" : ""}`}
                  whileHover={{ x: 6 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    if (item.label === "Dashboard") setAdminView("overview");
                    else if (item.label === "Analytics") setAdminView("analytics");
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <button className="admin-back" onClick={onBack}>
          Back to Menu
        </button>
      </aside>

      <main
        className="admin-content"
        style={
          adminView === "analytics"
            ? { flex: 1, minHeight: 0, overflowY: "auto", alignSelf: "stretch" }
            : undefined
        }
      >
        {adminView === "analytics" ? (
          <AnalyticsDashboard />
        ) : (
          <>
            <div className="topbar">
              <div>
                <p className="topbar-label">NAC KHOBAR</p>
                <h1>Dashboard</h1>
              </div>

              <div className="topbar-actions">
                {session && (
                  <button
                    type="button"
                    className="glass-pill"
                    onClick={loadDashboard}
                    disabled={loading}
                  >
                    <RefreshCw
                      size={14}
                      style={{
                        marginRight: 6,
                        animation: loading ? "spin 0.75s linear infinite" : undefined,
                      }}
                    />
                    Refresh
                  </button>
                )}
                <div className="glass-pill live-dot">Live</div>
              </div>
            </div>

            {!configured && (
              <motion.div
                className="big-glass-card"
                style={{ marginTop: "28px" }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="card-header">
                  <h3>Supabase not configured</h3>
                </div>
                <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
                  Add <code style={{ color: "#d7bc8a" }}>REACT_APP_SUPABASE_URL</code> and{" "}
                  <code style={{ color: "#d7bc8a" }}>REACT_APP_SUPABASE_ANON_KEY</code> to{" "}
                  <code style={{ color: "#d7bc8a" }}>.env.local</code> and restart the dev server.
                </p>
              </motion.div>
            )}

            {needsAuth && (
              <motion.div
                className="big-glass-card"
                style={{ marginTop: "28px" }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="card-header">
                  <h3>Sign in required</h3>
                </div>
                <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
                  Open <strong style={{ color: "#f9f9f7" }}>Analytics</strong> in the sidebar
                  and sign in with your Supabase Auth user. The dashboard will load real data
                  from <code style={{ color: "#d7bc8a" }}>menu_events</code> once authenticated.
                </p>
              </motion.div>
            )}

            {error && (
              <motion.div
                className="big-glass-card"
                style={{ marginTop: "28px", borderColor: "rgba(220,80,80,0.3)" }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p style={{ color: "#f5c4c4" }}>{error}</p>
              </motion.div>
            )}

            {loading && !data && (
              <section className="stats-grid" style={{ marginTop: "42px" }}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="glass-card" style={{ height: 140, opacity: 0.4 }} />
                ))}
              </section>
            )}

            {data && (
              <>
                <section className="stats-grid">
                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><Activity size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Total events</p>
                    <h2>{totalEvents.toLocaleString()}</h2>
                    <span>{totalSessions.toLocaleString()} sessions</span>
                  </motion.div>

                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><FolderOpen size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Most opened category</p>
                    <h2>{topCategory ? (CATEGORY_NAMES[topCategory.id] || topCategory.id) : "—"}</h2>
                    <span>{topCategory ? `${topCategory.opens} opens` : "No data"}</span>
                  </motion.div>

                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><Layers size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Top viewed item</p>
                    <h2 style={{ fontSize: topItem?.name?.length > 18 ? "22px" : undefined }}>{topItem?.name || "—"}</h2>
                    <span>{topItem ? `${topItem.opens} opens` : "No data"}</span>
                  </motion.div>

                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><PlusCircle size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Top add-on</p>
                    <h2 style={{ fontSize: topAddon?.name?.length > 18 ? "22px" : undefined }}>{topAddon?.name || "—"}</h2>
                    <span>{topAddon ? `${topAddon.clicks} clicks` : "No data"}</span>
                  </motion.div>

                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.24, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><Languages size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />Arabic usage</p>
                    <h2>{totalLangEvents > 0 ? `${arabicPercent}%` : "—"}</h2>
                    <span>{totalLangEvents > 0 ? `${arCount.toLocaleString()} AR · ${enCount.toLocaleString()} EN` : "No data"}</span>
                  </motion.div>

                  <motion.div
                    className="glass-card"
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.45 }}
                    whileHover={{ y: -6 }}
                  >
                    <p><Users size={14} style={{ marginRight: 6, verticalAlign: "-2px", color: "#d7bc8a" }} />QR Sessions</p>
                    <h2>{qrSessionStarts.toLocaleString()}</h2>
                    <span>{totalSessions.toLocaleString()} unique · {itemOpenCount.toLocaleString()} item opens</span>
                  </motion.div>
                </section>

                <section className="dashboard-row">
                  <motion.div
                    className="big-glass-card"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="card-header">
                      <h3>Hourly Activity</h3>
                      <span>Last 24 hours</span>
                    </div>

                    <div className="real-chart">
                      {hourlyData.length === 0 ? (
                        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "rgba(249,249,247,0.4)" }}>
                          No events in the last 24 hours
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hourlyData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis
                              dataKey="label"
                              tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 10 }}
                              interval="preserveStartEnd"
                            />
                            <YAxis tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 11 }} allowDecimals={false} />
                            <Tooltip
                              contentStyle={{
                                background: "rgba(10,10,10,0.88)",
                                border: "1px solid rgba(143,122,87,0.3)",
                                borderRadius: "14px",
                                color: "#f9f9f7",
                                fontSize: "12px",
                              }}
                            />
                            <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#d7bc8a" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </motion.div>

                  <motion.div
                    className="activity-card"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                  >
                    <div className="card-header">
                      <h3>Top Items</h3>
                      <span>All time</span>
                    </div>

                    <div className="top-items-list">
                      {(data.top_items || []).length === 0 ? (
                        <p style={{ color: "rgba(249,249,247,0.45)" }}>No item opens yet</p>
                      ) : (
                        (data.top_items || []).slice(0, 8).map((item, index) => (
                          <div className="top-item" key={item.name}>
                            <div>
                              <b>{index + 1}</b>
                              <span>{item.name}</span>
                            </div>
                            <p>{item.opens}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
