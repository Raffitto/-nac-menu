import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info } from "lucide-react";

const TIERS = [
  { key: "bounce", label: "Bounce", color: "#6b4040", desc: "Left after 1–2 events, no real interaction" },
  { key: "casual", label: "Casual", color: "#8f7a57", desc: "Brief visit, viewed 1 item or less" },
  { key: "engaged", label: "Engaged", color: "#4a6d76", desc: "Actively browsed menu sections and items" },
  { key: "deep", label: "Deep", color: "#d7bc8a", desc: "Explored 3+ items, used search or add-ons" },
  { key: "power", label: "Power User", color: "#76d69f", desc: "12+ events, extensive menu exploration" },
];

export default function SessionQuality({ quality, totalSessions }) {
  const data = useMemo(() => quality || {}, [quality]);
  const total = totalSessions || Object.values(data).reduce((a, b) => a + (Number(b) || 0), 0) || 0;
  const [hoveredTier, setHoveredTier] = useState(null);

  const segments = useMemo(
    () =>
      TIERS.map((tier) => {
        const count = Number(data[tier.key]) || 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        return { ...tier, count, pct };
      }),
    [data, total]
  );

  return (
    <motion.div
      className="nac-bi-quality"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Session Quality</h4>
        <span className="nac-bi-infotip-wrap" style={{ position: "relative" }}>
          <Info size={14} className="nac-bi-infotip-icon" />
        </span>
      </div>

      <div className="nac-bi-quality-bar">
        {segments.map((seg) =>
          seg.pct > 0 ? (
            <motion.div
              key={seg.key}
              className="nac-bi-quality-segment"
              style={{
                background: seg.color,
                boxShadow: hoveredTier === seg.key ? `0 0 14px ${seg.color}60` : "none",
              }}
              initial={{ width: 0 }}
              animate={{ width: `${seg.pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              onMouseEnter={() => setHoveredTier(seg.key)}
              onMouseLeave={() => setHoveredTier(null)}
            />
          ) : null
        )}
        {total === 0 && (
          <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.06)", borderRadius: 18 }} />
        )}
      </div>

      <div className="nac-bi-quality-legend">
        {segments.map((seg) => (
          <motion.div
            key={seg.key}
            className="nac-bi-quality-row"
            onMouseEnter={() => setHoveredTier(seg.key)}
            onMouseLeave={() => setHoveredTier(null)}
            animate={{ opacity: hoveredTier && hoveredTier !== seg.key ? 0.4 : 1 }}
            transition={{ duration: 0.2 }}
          >
            <span className="nac-bi-quality-swatch" style={{ background: seg.color }} />
            <span className="nac-bi-quality-tier-name">{seg.label}</span>
            {hoveredTier === seg.key && (
              <motion.span
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                style={{ fontSize: 11, color: "rgba(249,249,247,0.5)", flex: 1 }}
              >
                {seg.desc}
              </motion.span>
            )}
            <span className="nac-bi-quality-tier-count">{seg.count.toLocaleString()}</span>
            <span className="nac-bi-quality-tier-pct">
              {total > 0 ? `${seg.pct.toFixed(0)}%` : "—"}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
