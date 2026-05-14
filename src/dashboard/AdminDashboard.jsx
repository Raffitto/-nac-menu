import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  UtensilsCrossed,
  BarChart3,
  Store,
  Star,
  Bell,
  Settings,
} from "lucide-react";
import AnalyticsDashboard from "./AnalyticsDashboard";
import "./styles/admin-dashboard.css";



const sidebar = [
  { icon: <LayoutDashboard size={18} />, label: "Dashboard" },
  { icon: <UtensilsCrossed size={18} />, label: "Menu Manager" },
  { icon: <BarChart3 size={18} />, label: "Analytics" },
  { icon: <Store size={18} />, label: "Branches" },
  { icon: <Star size={18} />, label: "Reviews" },
  { icon: <Bell size={18} />, label: "AI Insights" },
  { icon: <Settings size={18} />, label: "Settings" },
];

export default function AdminDashboard({ onBack }) {
  const [adminView, setAdminView] = useState("overview");

    const realAnalytics = useMemo(() => {
  const saved = JSON.parse(localStorage.getItem("nacAnalytics")) || {};

  return Object.entries(saved)
    .map(([name, views]) => ({
      name,
      views,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
}, []);
const realCategoryAnalytics = useMemo(() => {
  const saved =
    JSON.parse(localStorage.getItem("nacCategoryAnalytics")) || {};

  return Object.entries(saved)
    .map(([name, views]) => ({
      name,
      views,
    }))
    .sort((a, b) => b.views - a.views);
}, []);

const realAddonAnalytics = useMemo(() => {
  const saved =
    JSON.parse(localStorage.getItem("nacAddonAnalytics")) || {};

  return Object.entries(saved)
    .map(([name, clicks]) => ({
      name,
      clicks,
    }))
    .sort((a, b) => b.clicks - a.clicks);
}, []);

const topAddon =
  realAddonAnalytics.length > 0 ? realAddonAnalytics[0] : null;

  const languageAnalytics =
  JSON.parse(localStorage.getItem("nacLanguageAnalytics")) || {
    en: 0,
    ar: 0,
  };

const totalLang =
  languageAnalytics.en + languageAnalytics.ar;

const arabicPercent =
  totalLang > 0
    ? Math.round((languageAnalytics.ar / totalLang) * 100)
    : 0;

const topCategory =
  realCategoryAnalytics.length > 0
    ? realCategoryAnalytics[0].name
    : "No data yet";
const dashboardTopItems = realAnalytics;

const hasLocalPreview =
  dashboardTopItems.length > 0 ||
  realCategoryAnalytics.length > 0 ||
  realAddonAnalytics.length > 0 ||
  totalLang > 0;

const stats = [
  {
    title: "Most opened category",
    subtitle: "This browser only",
    value: topCategory,
    detail:
      realCategoryAnalytics.length > 0
        ? `${realCategoryAnalytics.length} categories with taps`
        : "No category taps recorded here yet",
  },
  {
    title: "Top viewed item (local)",
    subtitle: "This browser only",
    value: dashboardTopItems[0]?.name || "—",
    detail:
      dashboardTopItems.length > 0
        ? `${dashboardTopItems[0]?.views || 0} opens on this device`
        : "Open the guest menu on this device to collect preview taps",
  },
  {
    title: "Top add-on (local)",
    subtitle: "This browser only",
    value: topAddon?.name || "—",
    detail:
      topAddon
        ? `${topAddon.clicks} taps on this device`
        : "No add-on taps on this device yet",
  },
  {
    title: "Language toggles (local)",
    subtitle: "This browser only",
    value: totalLang > 0 ? `${arabicPercent}% AR` : "—",
    detail:
      totalLang > 0
        ? `${languageAnalytics.ar} AR · ${languageAnalytics.en} EN`
        : "Switch EN/AR on this device to see split",
  },
];

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
            <h1>Admin</h1>
            <p
              style={{
                margin: "12px 0 0",
                maxWidth: "52rem",
                fontSize: "14px",
                lineHeight: 1.55,
                color: "rgba(249,249,247,0.62)",
              }}
            >
              Official analytics come from Supabase{" "}
              <code style={{ color: "#d7bc8a" }}>menu_events</code>. Open{" "}
              <strong style={{ color: "#f9f9f7" }}>Analytics</strong> in the
              sidebar, sign in, and use Refresh there. Cards below are an{" "}
              <em>optional on-device preview</em> from this browser only — not
              branch-wide.
            </p>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="glass-pill"
              onClick={() => {
                localStorage.removeItem("nacAnalytics");
                localStorage.removeItem("nacCategoryAnalytics");
                localStorage.removeItem("nacAddonAnalytics");
                localStorage.removeItem("nacLanguageAnalytics");
                localStorage.removeItem("nacSearchAnalytics");
                localStorage.removeItem("nacAddonConversions");
                window.location.reload();
              }}
            >
              Clear on-device cache
            </button>
          </div>
        </div>

        {!hasLocalPreview && (
          <motion.div
            className="big-glass-card"
            style={{ marginTop: "28px" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="card-header">
              <h3>No on-device preview yet</h3>
            </div>
            <p style={{ color: "rgba(249,249,247,0.55)", lineHeight: 1.6 }}>
              Use the guest menu on this machine, or go straight to{" "}
              <strong>Analytics</strong> for real Supabase totals, hourly
              activity, language split, and live feed.
            </p>
          </motion.div>
        )}

        {hasLocalPreview && (
        <section className="stats-grid">
          {stats.map((card, index) => (
            <motion.div
              key={card.title}
              className="glass-card"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, duration: 0.45 }}
              whileHover={{ y: -6 }}
            >
              <p style={{ fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(215,188,138,0.85)", marginBottom: "6px" }}>
                {card.subtitle}
              </p>
              <p>{card.title}</p>
              <h2>{card.value}</h2>
              <span style={{ color: "rgba(249,249,247,0.55)" }}>{card.detail}</span>
            </motion.div>
          ))}
        </section>
        )}

        {hasLocalPreview && dashboardTopItems.length > 0 && (
        <section className="dashboard-row" style={{ marginTop: "28px" }}>
          <motion.div
            className="activity-card"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ maxWidth: "100%" }}
          >
            <div className="card-header">
              <h3>Top items (this browser)</h3>
              <span>Local preview</span>
            </div>

            <div className="top-items-list">
              {dashboardTopItems.map((item, index) => (
                <div className="top-item" key={item.name}>
                  <div>
                    <b>{index + 1}</b>
                    <span>{item.name}</span>
                  </div>

                  <p>{item.views}</p>
                  <em>local</em>
                </div>
              ))}
            </div>
          </motion.div>
        </section>
        )}
          </>
        )}
      </main>
    </div>
  );
}