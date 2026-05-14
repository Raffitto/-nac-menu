import React, { useMemo } from "react";
import { motion } from "framer-motion";

const STAGES = [
  { key: "qr_scans", label: "QR Scan", icon: "📱" },
  { key: "category_opens", label: "Category", icon: "📂" },
  { key: "item_opens", label: "Item View", icon: "🍽" },
  { key: "addon_clicks", label: "Add-on", icon: "➕" },
  { key: "time_spent", label: "Time Spent", icon: "⏱" },
  { key: "exits", label: "Exit", icon: "👋" },
];

const BAR_COLORS = [
  "#4a6d76", "#5a7f85", "#7a9a7e",
  "#a3ad7a", "#c4b07f", "#d7bc8a",
];

export default function FunnelChart({ funnel }) {
  const data = useMemo(() => funnel || {}, [funnel]);

  const stages = useMemo(() => {
    const raw = STAGES.map((s) => ({
      ...s,
      value: Number(data[s.key]) || 0,
    }));
    const maxVal = Math.max(...raw.map((v) => v.value), 1);

    return raw.map((stage, i) => {
      const prev = i > 0 ? raw[i - 1].value : null;
      let convPct = null;
      let dropPct = null;
      if (prev != null && prev > 0) {
        convPct = Math.min((stage.value / prev) * 100, 100);
        dropPct = Math.max(100 - convPct, 0);
      }
      const widthPct = (stage.value / maxVal) * 100;
      return { ...stage, widthPct, convPct, dropPct };
    });
  }, [data]);

  const allZero = stages.every((s) => s.value === 0);

  if (allZero) {
    return (
      <div style={{ padding: "24px 0", color: "rgba(249,249,247,0.4)", fontSize: 13, textAlign: "center" }}>
        No funnel data yet
      </div>
    );
  }

  return (
    <div className="nac-bi-funnel-v2">
      {stages.map((stage, i) => (
        <React.Fragment key={stage.key}>
          <motion.div
            className="nac-bi-fv2-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
            whileHover={{ y: -3, boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}
          >
            <div className="nac-bi-fv2-top">
              <span className="nac-bi-fv2-icon">{stage.icon}</span>
              <span className="nac-bi-fv2-label">{stage.label}</span>
            </div>
            <div className="nac-bi-fv2-count">{stage.value.toLocaleString()}</div>
            <div className="nac-bi-fv2-bar-track">
              <motion.div
                className="nac-bi-fv2-bar-fill"
                style={{ background: BAR_COLORS[i] }}
                initial={{ width: 0 }}
                animate={{ width: `${stage.widthPct}%` }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              />
            </div>
            {stage.convPct != null && (
              <div className="nac-bi-fv2-pcts">
                <span style={{ color: "#76d69f" }}>{stage.convPct.toFixed(0)}%</span>
                <span style={{ color: "rgba(249,249,247,0.3)" }}> · </span>
                <span style={{ color: "rgba(249,249,247,0.4)" }}>↓{stage.dropPct.toFixed(0)}%</span>
              </div>
            )}
            {stage.convPct == null && (
              <div className="nac-bi-fv2-pcts"><span style={{ color: "rgba(249,249,247,0.35)" }}>entry</span></div>
            )}
          </motion.div>
          {i < stages.length - 1 && (
            <div className="nac-bi-fv2-arrow">
              <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
                <path d="M1 7h14M12 2l5 5-5 5" stroke="rgba(249,249,247,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
