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
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";

import { weeklyViews, topItems, actionItems } from "./data/mockData";
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
      trend: "Live",
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
const dashboardTopItems =
  realAnalytics.length > 0 ? realAnalytics : topItems;

const stats = [
  {
    title: "Most Opened Category",
    value: topCategory,
    growth: "Live data",
  },
  {
    title: "Top Viewed Item",
    value: dashboardTopItems[0]?.name || "No data",
    growth: `${dashboardTopItems[0]?.views || 0} views`,
  },
{
  title: "Top Add-on",
  value: topAddon?.name || "No data yet",
  growth: `${topAddon?.clicks || 0} clicks`,
},
  {
    title: "Arabic Users",
    value: `${arabicPercent}%`,
    growth: `${languageAnalytics.ar} · ${languageAnalytics.en} EN`,
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
            <h1>Dashboard Overview</h1>
          </div>

          <div className="topbar-actions">
            <button
  className="glass-pill"
  onClick={() => {
    localStorage.removeItem("nacAnalytics");
    localStorage.removeItem("nacCategoryAnalytics");
    localStorage.removeItem("nacAddonAnalytics");
    window.location.reload();
  }}
>
  Reset
</button>
            <div className="glass-pill">Today</div>
            <div className="glass-pill live-dot">Live</div>
          </div>
        </div>

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
              <p>{card.title}</p>
              <h2>{card.value}</h2>
              <span>{card.growth}</span>

              <div className="mini-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyViews}>
                    <Line
                      type="monotone"
                      dataKey="views"
                      stroke="#76d69f"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          ))}
        </section>

        <section className="dashboard-row">
          <motion.div
            className="big-glass-card"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="card-header">
              <h3>Performance Overview</h3>
              <span>This Week</span>
            </div>

            <div className="real-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyViews}>
                  <defs>
                    <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#76d69f" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#76d69f" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <Tooltip
                    contentStyle={{
                      background: "rgba(10,10,10,0.82)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "14px",
                      color: "#fff",
                    }}
                  />

                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="#76d69f"
                    strokeWidth={3}
                    fill="url(#viewsGradient)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div
            className="activity-card"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="card-header">
              <h3>Top Viewed Items</h3>
              <span>Live Rank</span>
            </div>

            <div className="top-items-list">
              {dashboardTopItems.map((item, index) => (
                <div className="top-item" key={item.name}>
                  <div>
                    <b>{index + 1}</b>
                    <span>{item.name}</span>
                  </div>

                  <p>{item.views}</p>
                  <em>{item.trend}</em>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        <section className="action-grid">
          {actionItems.map((item, index) => (
            <motion.div
              className="action-card"
              key={item.title}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + index * 0.07 }}
            >
              <p>{item.title}</p>
              <h3>{item.value}</h3>
              <span>View details</span>
            </motion.div>
          ))}
        </section>
          </>
        )}
      </main>
    </div>
  );
}